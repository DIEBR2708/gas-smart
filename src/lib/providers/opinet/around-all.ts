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

export async function fetchAroundAll(
  certKey: string,
  center: LatLng,
  fuelKind: FuelKind,
  radiusM = 5000,
): Promise<AroundAllRow[]> {
  const { x, y } = wgs84ToKatec(center);
  const url = new URL(`${BASE_URL}/aroundAll.do`);
  url.searchParams.set("out", "json");
  url.searchParams.set("certkey", certKey);
  url.searchParams.set("x", x.toFixed(1));
  url.searchParams.set("y", y.toFixed(1));
  url.searchParams.set("radius", String(radiusM));
  url.searchParams.set("sort", "1");
  url.searchParams.set("prodcd", OPINET_PROD_CODE[fuelKind]);

  const res = await fetchOutbound(url, { timeoutMs: 6_000 });
  if (!res.ok) return [];
  try {
    const json = (await res.json()) as { RESULT?: { OIL?: AroundAllRow[] } };
    return json.RESULT?.OIL ?? [];
  } catch {
    return [];
  }
}
