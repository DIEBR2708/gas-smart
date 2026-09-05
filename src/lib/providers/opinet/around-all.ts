import proj4 from "proj4";
import type { Brand, FuelKind, LatLng } from "@/lib/domain/types";
import { OPINET_PROD_CODE } from "@/lib/domain/types";
import { fetchOutbound } from "@/lib/http";

const KATEC =
  "+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 " +
  "+ellps=bessel +units=m +no_defs " +
  "+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";

const WGS84 = "EPSG:4326";
const BASE_URL = "https://www.opinet.co.kr/api";

/**
 * 인증키를 넘기는 파라미터 이름은 `code`다. `certkey`가 아니다.
 *
 * 오피넷은 이름이 틀린 요청을 거절하지 않는다. HTTP 200에 `{"RESULT":{"OIL":[]}}`,
 * 즉 "그 근처에 주유소가 없다"와 완전히 같은 응답을 준다. 그래서 이름을 잘못
 * 쓰면 전국 어디를 찍어도 결과가 0건이고, 앱은 조용히 합성 데이터로 내려앉는다.
 * 실제로 그 상태로 한동안 굴러갔다.
 */
export const CERT_KEY_PARAM = "code";

export function wgs84ToKatec(p: LatLng): { x: number; y: number } {
  const [x, y] = proj4(WGS84, KATEC, [p.lng, p.lat]);
  return { x, y };
}

export function katecToWgs84(x: number, y: number): LatLng {
  const [lng, lat] = proj4(KATEC, WGS84, [x, y]);
  return { lat, lng };
}

export interface AroundAllRow {
  UNI_ID: string;
  POLL_DIV_CD?: string;
  POLL_DIV_CO?: string;
  OS_NM: string;
  PRICE: string | number;
  DISTANCE?: string | number;
  GIS_X_COOR: string | number;
  GIS_Y_COOR: string | number;
}

export function toBrand(code: string): Brand {
  const known: Brand[] = ["SKE", "GSC", "HDO", "SOL", "RTE", "RTX", "NHO", "ETC"];
  return (known as string[]).includes(code) ? (code as Brand) : "ETC";
}

export interface AroundAllResult {
  ok: boolean;
  rows: AroundAllRow[];
}

function isSuccessCode(code: string | number | undefined): boolean {
  if (code === undefined || code === "") return true;
  const normalized = String(code).trim();
  return normalized === "200" || normalized === "00" || normalized === "0";
}

export async function fetchAroundAll(
  certKey: string,
  center: LatLng,
  fuelKind: FuelKind,
  radiusM = 5000,
): Promise<AroundAllResult> {
  const { x, y } = wgs84ToKatec(center);
  const url = new URL(`${BASE_URL}/aroundAll.do`);
  url.searchParams.set("out", "json");
  url.searchParams.set(CERT_KEY_PARAM, certKey);
  url.searchParams.set("x", x.toFixed(1));
  url.searchParams.set("y", y.toFixed(1));
  url.searchParams.set("radius", String(radiusM));
  url.searchParams.set("sort", "1");
  url.searchParams.set("prodcd", OPINET_PROD_CODE[fuelKind]);

  const res = await fetchOutbound(url, { timeoutMs: 6_000 });
  if (!res.ok) return { ok: false, rows: [] };
  try {
    const json = (await res.json()) as {
      RESULT?: { OIL?: AroundAllRow[]; RESULTCODE?: string | number };
      RESULTCODE?: string | number;
    };
    const code = json.RESULT?.RESULTCODE ?? json.RESULTCODE;
    if (!isSuccessCode(code)) return { ok: false, rows: [] };
    return { ok: true, rows: json.RESULT?.OIL ?? [] };
  } catch {
    return { ok: false, rows: [] };
  }
}
