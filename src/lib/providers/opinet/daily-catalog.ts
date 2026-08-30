import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { haversineM } from "@/lib/domain/geo";
import type { Brand, FuelKind, LatLng, Station } from "@/lib/domain/types";
import { displayStationName } from "@/lib/format";
import {
  type AroundAllRow,
  katecToWgs84,
  toBrand,
} from "./around-all";

export const FUEL_PREFETCH_ORDER: FuelKind[] = [
  "gasoline",
  "diesel",
  "premium",
  "lpg",
];

/** 실패 칸을 성공으로 저장하던 예전 파일을 버리고 다시 받기 위한 버전. */
export const CATALOG_SCHEMA_VERSION = 2;

export interface CatalogStation {
  id: string;
  name: string;
  brand: Brand;
  lat: number;
  lng: number;
  prices: Partial<Record<FuelKind, number>>;
}

export interface CatalogSnapshot {
  date: string;
  version?: number;
  cells: string[];
  stations: CatalogStation[];
}

export function kstDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function cellId(center: LatLng, fuelKind: FuelKind): string {
  return `${center.lat.toFixed(3)}:${center.lng.toFixed(3)}:${fuelKind}`;
}

export function catalogFilePath(date = kstDateKey()): string {
  return path.join(process.cwd(), ".data", `opinet-prices-${date}.json`);
}

export class DailyPriceCatalog {
  readonly date: string;
  private readonly cells = new Set<string>();
  private readonly fetchCenters: { point: LatLng; fuelKind: FuelKind }[] = [];
  private readonly stations = new Map<string, CatalogStation>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly persistToDisk: boolean;

  constructor(date = kstDateKey(), persistToDisk = true) {
    this.date = date;
    this.persistToDisk = persistToDisk;
  }

  get stationCount(): number {
    return this.stations.size;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  cellCountForFuel(fuelKind: FuelKind): number {
    let n = 0;
    for (const id of this.cells) {
      if (id.endsWith(`:${fuelKind}`)) n += 1;
    }
    return n;
  }

  priceCountForFuel(fuelKind: FuelKind): number {
    let n = 0;
    for (const station of this.stations.values()) {
      if (station.prices[fuelKind] !== undefined) n += 1;
    }
    return n;
  }

  setFuelPrice(id: string, fuelKind: FuelKind, price: number): void {
    const prev = this.stations.get(id);
    if (!prev || !Number.isFinite(price) || price <= 0) return;
    this.stations.set(id, {
      ...prev,
      prices: { ...prev.prices, [fuelKind]: price },
    });
  }

  hasCell(id: string): boolean {
    return this.cells.has(id);
  }

  covers(point: LatLng, fuelKind: FuelKind, withinM: number): boolean {
    const exact = cellId(point, fuelKind);
    if (this.cells.has(exact)) return true;
    for (const center of this.fetchCenters) {
      if (center.fuelKind !== fuelKind) continue;
      if (haversineM(point, center.point) <= withinM) return true;
    }
    return false;
  }

  markFetched(center: LatLng, fuelKind: FuelKind): void {
    const id = cellId(center, fuelKind);
    if (this.cells.has(id)) return;
    this.cells.add(id);
    this.fetchCenters.push({ point: center, fuelKind });
  }

  forgetCell(id: string): void {
    if (!this.cells.delete(id)) return;
    const index = this.fetchCenters.findIndex(
      (center) => cellId(center.point, center.fuelKind) === id,
    );
    if (index >= 0) this.fetchCenters.splice(index, 1);
  }

  ingest(rows: AroundAllRow[], fuelKind: FuelKind): void {
    for (const row of rows) {
      const price = Number(row.PRICE);
      if (!Number.isFinite(price) || price <= 0) continue;
      const coord = katecToWgs84(Number(row.GIS_X_COOR), Number(row.GIS_Y_COOR));
      if (!Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) continue;
      const id = String(row.UNI_ID ?? "").trim();
      if (!id) continue;
      const prev = this.stations.get(id);
      this.stations.set(id, {
        id,
        name: displayStationName(String(row.OS_NM ?? prev?.name ?? "")),
        brand: toBrand(String(row.POLL_DIV_CD ?? row.POLL_DIV_CO ?? prev?.brand ?? "ETC")),
        lat: coord.lat,
        lng: coord.lng,
        prices: { ...prev?.prices, [fuelKind]: price },
      });
    }
  }

  stationsNear(
    centers: LatLng[],
    radiusM: number,
    fuelKind: FuelKind,
    priceDay: Date,
  ): Station[] {
    const out: Station[] = [];
    const updatedAt = priceDay.toISOString();
    for (const item of this.stations.values()) {
      const price = item.prices[fuelKind];
      if (price === undefined) continue;
      const near = centers.some((c) => haversineM(c, item) <= radiusM);
      if (!near) continue;
      out.push({
        id: item.id,
        name: item.name,
        brand: item.brand,
        isSelfService: false,
        lat: item.lat,
        lng: item.lng,
        prices: { [fuelKind]: price },
        priceUpdatedAt: updatedAt,
        openingHours: { allDay: true },
      });
    }
    return out;
  }

  nearestAlong(
    centers: LatLng[],
    radiusM: number,
    priceDay: Date,
    limit: number,
  ): Station[] {
    const updatedAt = priceDay.toISOString();
    const scored: { d: number; station: Station }[] = [];
    for (const item of this.stations.values()) {
      let best = Infinity;
      for (const center of centers) {
        const d = haversineM(center, item);
        if (d < best) best = d;
      }
      if (best > radiusM) continue;
      scored.push({
        d: best,
        station: {
          id: item.id,
          name: item.name,
          brand: item.brand,
          isSelfService: false,
          lat: item.lat,
          lng: item.lng,
          prices: { ...item.prices },
          priceUpdatedAt: updatedAt,
          openingHours: { allDay: true },
        },
      });
    }
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, limit).map((item) => item.station);
  }

  missingAmong(
    centers: LatLng[],
    fuelKind: FuelKind,
    coverM: number,
  ): LatLng[] {
    return centers.filter((point) => !this.covers(point, fuelKind, coverM));
  }

  applySnapshot(snapshot: CatalogSnapshot): void {
    if (snapshot.date !== this.date) return;
    for (const station of snapshot.stations) {
      this.stations.set(station.id, station);
    }
    // 예전 파일은 타임아웃·오류도 받은 칸으로 남겨 경로 조회를 건너뛰었다.
    if ((snapshot.version ?? 1) < CATALOG_SCHEMA_VERSION) return;
    for (const id of snapshot.cells) {
      this.cells.add(id);
      const [lat, lng, fuel] = id.split(":");
      const fuelKind = fuel as FuelKind;
      if (!lat || !lng || !fuelKind) continue;
      this.fetchCenters.push({
        point: { lat: Number(lat), lng: Number(lng) },
        fuelKind,
      });
    }
  }

  snapshot(): CatalogSnapshot {
    return {
      date: this.date,
      version: CATALOG_SCHEMA_VERSION,
      cells: [...this.cells],
      stations: [...this.stations.values()],
    };
  }

  scheduleSave(): void {
    if (!this.persistToDisk) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.saveNow();
    }, 4_000);
  }

  async saveNow(): Promise<void> {
    if (!this.persistToDisk) return;
    const file = catalogFilePath(this.date);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(this.snapshot()), "utf8");
  }
}

export async function loadCatalogForToday(
  persistToDisk = true,
): Promise<DailyPriceCatalog> {
  const date = kstDateKey();
  const catalog = new DailyPriceCatalog(date, persistToDisk);
  if (!persistToDisk) return catalog;
  try {
    const raw = await readFile(catalogFilePath(date), "utf8");
    const parsed = JSON.parse(raw) as CatalogSnapshot;
    catalog.applySnapshot(parsed);
  } catch {
    // 오늘 파일이 없으면 빈 목록으로 시작한다.
  }
  return catalog;
}
