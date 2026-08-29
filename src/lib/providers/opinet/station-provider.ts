import proj4 from "proj4";
import { planCorridorSearch } from "@/lib/domain/corridor";
import {
  cumulativeDistances,
  haversineM,
  sampleAlongRoute,
} from "@/lib/domain/geo";
import type {
  Brand,
  FuelKind,
  LatLng,
  Route,
  Station,
} from "@/lib/domain/types";
import { OPINET_PROD_CODE } from "@/lib/domain/types";
import { displayStationName } from "@/lib/format";
import type { StationProvider, StationQuery } from "../types";

/**
 * 오피넷(한국석유공사) 유가정보 오픈 API 프로바이더.
 *
 * 알아둘 제약:
 *  1. `aroundAll.do`는 반경 최대 5,000m다. 장거리 경로를 덮으려면 경로를 잘게
 *     샘플링해 여러 번 호출해야 하고, 그만큼 일일 호출 한도를 잡아먹는다.
 *  2. 좌표계가 KATEC이다. WGS84를 그냥 넣으면 엉뚱한 지역이 나온다.
 *     towgs84 파라미터를 빼면 약 70m가 밀린다.
 *  3. `aroundAll.do` 응답에는 셀프 여부·영업시간이 없다. 필요하면 후보를 줄인 뒤
 *     `detailById.do`로 개별 조회해야 한다. 여기서는 상위 후보만 보강한다.
 *  4. 가격은 주유소가 신고한 값이라 현장 가격과 다를 수 있다. 화면에 반드시
 *     신고 시각과 참고용 표시를 남겨야 한다.
 */

const KATEC =
  "+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 " +
  "+ellps=bessel +units=m +no_defs " +
  "+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";

const WGS84 = "EPSG:4326";

export function wgs84ToKatec(p: LatLng): { x: number; y: number } {
  const [x, y] = proj4(WGS84, KATEC, [p.lng, p.lat]);
  return { x, y };
}

export function katecToWgs84(x: number, y: number): LatLng {
  const [lng, lat] = proj4(KATEC, WGS84, [x, y]);
  return { lat, lng };
}

const BASE_URL = "https://www.opinet.co.kr/api";

/** 오피넷 상표 코드는 도메인 Brand와 거의 같지만 가스 전용 코드가 더 있다. */
function toBrand(code: string): Brand {
  const known: Brand[] = ["SKE", "GSC", "HDO", "SOL", "RTE", "RTX", "NHO", "ETC"];
  return (known as string[]).includes(code) ? (code as Brand) : "ETC";
}

interface AroundAllRow {
  UNI_ID: string;
  POLL_DIV_CD?: string;
  POLL_DIV_CO?: string;
  OS_NM: string;
  PRICE: string | number;
  DISTANCE: string | number;
  GIS_X_COOR: string | number;
  GIS_Y_COOR: string | number;
}

interface DetailRow {
  UNI_ID: string;
  SELF_YN?: string;
  GPOLL_DIV_CO?: string;
  VAN_ADR?: string;
  NEW_ADR?: string;
  CAR_WASH_YN?: string;
  OIL_PRICE?: { PRODCD: string; PRICE: string | number }[];
}

/** 가격 데이터는 하루 단위로 갱신되므로 짧게라도 캐시하지 않으면 한도가 금방 마른다. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; rows: AroundAllRow[] }>();

export class OpinetStationProvider implements StationProvider {
  readonly id = "opinet";
  readonly label = "오피넷 실시간 유가";
  readonly isLive = true;

  constructor(private readonly certKey: string) {}

  async findAlongRoute(route: Route, query: StationQuery): Promise<Station[]> {
    const cum = cumulativeDistances(route.polyline);
    // 호출 비용은 반경과 무관하므로 항상 상한 반경으로 요청하고,
    // 원하는 회랑 폭에서 샘플 간격을 역산한다. 호출도 적고 빈틈도 없다.
    const plan = planCorridorSearch(route.polyline, query.corridorHalfWidthM);
    const radiusM = Math.round(plan.searchRadiusM);
    const samples = sampleAlongRoute(route.polyline, plan.intervalM, cum);

    const rows = new Map<string, AroundAllRow>();
    // 호출 폭주를 막기 위해 동시 요청 수를 제한한다.
    const concurrency = 4;
    for (let i = 0; i < samples.length; i += concurrency) {
      const batch = samples.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((s) => this.fetchAround(s.point, radiusM, query.fuelKind)),
      );
      for (const list of results) {
        for (const row of list) rows.set(row.UNI_ID, row);
      }
    }

    const stations: Station[] = [];
    for (const row of rows.values()) {
      const coord = katecToWgs84(Number(row.GIS_X_COOR), Number(row.GIS_Y_COOR));
      const price = Number(row.PRICE);
      if (!Number.isFinite(price) || price <= 0) continue;
      stations.push({
        id: row.UNI_ID,
        name: displayStationName(String(row.OS_NM ?? "")),
        brand: toBrand(String(row.POLL_DIV_CD ?? row.POLL_DIV_CO ?? "ETC")),
        // aroundAll 응답에 셀프 여부가 없어 상세 조회 전에는 알 수 없다.
        isSelfService: false,
        lat: coord.lat,
        lng: coord.lng,
        prices: { [query.fuelKind]: price },
        // 오피넷은 개별 신고 시각을 주지 않는다. 일별 갱신을 가정한다.
        priceUpdatedAt: startOfToday().toISOString(),
        openingHours: { allDay: true },
      });
    }

    return stations;
  }

  private async fetchAround(
    center: LatLng,
    radiusM: number,
    fuelKind: FuelKind,
  ): Promise<AroundAllRow[]> {
    const { x, y } = wgs84ToKatec(center);
    const key = `${x.toFixed(0)}:${y.toFixed(0)}:${radiusM}:${fuelKind}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

    const url = new URL(`${BASE_URL}/aroundAll.do`);
    url.searchParams.set("out", "json");
    url.searchParams.set("certkey", this.certKey);
    url.searchParams.set("x", x.toFixed(1));
    url.searchParams.set("y", y.toFixed(1));
    url.searchParams.set("radius", String(radiusM));
    url.searchParams.set("sort", "1");
    url.searchParams.set("prodcd", OPINET_PROD_CODE[fuelKind]);

    try {
      const res = await fetch(url, { next: { revalidate: 1800 } });
      if (!res.ok) return [];
      const json = (await res.json()) as { RESULT?: { OIL?: AroundAllRow[] } };
      const rows = json.RESULT?.OIL ?? [];
      cache.set(key, { at: Date.now(), rows });
      return rows;
    } catch {
      return [];
    }
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

  private async fetchDetail(uniId: string): Promise<DetailRow | null> {
    const url = new URL(`${BASE_URL}/detailById.do`);
    url.searchParams.set("out", "json");
    url.searchParams.set("certkey", this.certKey);
    url.searchParams.set("id", uniId);
    try {
      const res = await fetch(url, { next: { revalidate: 1800 } });
      if (!res.ok) return null;
      const json = (await res.json()) as { RESULT?: { OIL?: DetailRow[] } };
      return json.RESULT?.OIL?.[0] ?? null;
    } catch {
      return null;
    }
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export { haversineM };
