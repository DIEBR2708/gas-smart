import {
  planCorridorSearch,
  sampleCorridorCenters,
} from "@/lib/domain/corridor";
import { haversineM } from "@/lib/domain/geo";
import type { FuelKind, Route, Station } from "@/lib/domain/types";
import { OPINET_PROD_CODE } from "@/lib/domain/types";
import { fetchOutbound, mapPool } from "@/lib/http";
import { kstDateKey } from "./daily-catalog";
import { startOpinetDailyPrefetch } from "./fetch-queue";
import type { StationProvider, StationQuery } from "../types";

/**
 * 오피넷(한국석유공사) 유가정보 오픈 API 프로바이더.
 *
 * 당일 유가는 백그라운드에서 전국 휘발유 격자를 천천히 모아 둔다.
 * 경로 검색은 그 목록을 읽되, 경로 칸은 항상 사용자 우선으로 먼저 받는다.
 * 실패한 조회는 받은 칸으로 치지 않는다.
 */

const BASE_URL = "https://www.opinet.co.kr/api";

interface DetailRow {
  UNI_ID: string;
  SELF_YN?: string;
  GPOLL_DIV_CO?: string;
  VAN_ADR?: string;
  NEW_ADR?: string;
  CAR_WASH_YN?: string;
  OIL_PRICE?: { PRODCD: string; PRICE: string | number }[];
}

export class OpinetStationProvider implements StationProvider {
  readonly id = "opinet";
  readonly label = "오피넷 실시간 유가";
  readonly isLive = true;

  constructor(private readonly certKey: string) {
    void startOpinetDailyPrefetch(certKey);
  }

  async findAlongRoute(route: Route, query: StationQuery): Promise<Station[]> {
    const { catalog, queue } = await startOpinetDailyPrefetch(this.certKey);
    const plan = planCorridorSearch(route.polyline, query.corridorHalfWidthM);
    const radiusM = Math.round(plan.searchRadiusM);
    const samples = sampleCorridorCenters(
      route.polyline,
      plan.coveredHalfWidthM,
      plan.searchRadiusM,
    );
    const points = samples.map((s) => s.point);
    const missing = catalog.missingAmong(points, query.fuelKind, 800);
    if (missing.length > 0) {
      await queue.ensureMany(missing, query.fuelKind, "user");
    }

    const asOf = startOfKstDay();
    let stations = catalog.stationsNear(points, radiusM, query.fuelKind, asOf);
    if (stations.length === 0 && points.length > 0) {
      await queue.refetchMany(points, query.fuelKind);
      stations = catalog.stationsNear(points, radiusM, query.fuelKind, asOf);
    }
    if (stations.length === 0 && points.length > 0) {
      const nearby = catalog.nearestAlong(points, radiusM, asOf, 40);
      stations = await this.hydrateFuel(nearby, query.fuelKind);
      for (const station of stations) {
        const price = station.prices[query.fuelKind];
        if (price !== undefined) catalog.setFuelPrice(station.id, query.fuelKind, price);
      }
      if (stations.length > 0) catalog.scheduleSave();
    }
    return stations;
  }

  /**
   * 후보를 좁힌 뒤에만 호출해야 하는 상세 조회.
   * 셀프 여부, 주소, 세차장, 그리고 유종별 전체 가격을 채워 넣는다.
   */
  async enrich(stations: Station[]): Promise<Station[]> {
    const out: Station[] = [];
    for (const station of stations) {
      const detail = await this.fetchDetail(station.id);
      if (!detail) {
        out.push(station);
        continue;
      }
      const prices = { ...station.prices };
      for (const entry of detail.OIL_PRICE ?? []) {
        const kind = (Object.keys(OPINET_PROD_CODE) as FuelKind[]).find(
          (k) => OPINET_PROD_CODE[k] === entry.PRODCD,
        );
        if (kind) prices[kind] = Number(entry.PRICE);
      }
      out.push({
        ...station,
        prices,
        isSelfService: detail.SELF_YN === "Y",
        address: detail.NEW_ADR ?? detail.VAN_ADR ?? station.address,
        hasCarWash: detail.CAR_WASH_YN === "Y",
      });
    }
    return out;
  }

  private async hydrateFuel(
    stations: Station[],
    fuelKind: FuelKind,
  ): Promise<Station[]> {
    const filled = await mapPool(stations, 8, async (station) => {
      if (station.prices[fuelKind] !== undefined) return station;
      const detail = await this.fetchDetail(station.id);
      if (!detail) return null;
      const entry = (detail.OIL_PRICE ?? []).find(
        (item) => OPINET_PROD_CODE[fuelKind] === item.PRODCD,
      );
      const price = Number(entry?.PRICE);
      if (!Number.isFinite(price) || price <= 0) return null;
      return {
        ...station,
        prices: { ...station.prices, [fuelKind]: price },
      };
    });
    return filled.filter((station): station is Station => station !== null);
  }

  private async fetchDetail(uniId: string): Promise<DetailRow | null> {
    const url = new URL(`${BASE_URL}/detailById.do`);
    url.searchParams.set("out", "json");
    url.searchParams.set("certkey", this.certKey);
    url.searchParams.set("id", uniId);
    const res = await fetchOutbound(url, { timeoutMs: 5_000 });
    if (!res.ok) return null;
    try {
      const json = (await res.json()) as { RESULT?: { OIL?: DetailRow[] } };
      return json.RESULT?.OIL?.[0] ?? null;
    } catch {
      return null;
    }
  }
}

function startOfKstDay(): Date {
  return new Date(`${kstDateKey()}T00:00:00+09:00`);
}

export { haversineM };
