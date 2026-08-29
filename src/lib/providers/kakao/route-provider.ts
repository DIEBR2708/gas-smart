import { curveBetween, cumulativeDistances, projectOntoPolyline } from "@/lib/domain/geo";
import type {
  Detour,
  FuelKind,
  LatLng,
  NamedPlace,
  Route,
  Station,
} from "@/lib/domain/types";
import type { RouteProvider } from "../types";

/**
 * 카카오모빌리티 길찾기 API 프로바이더.
 *
 * 알아둘 제약:
 *  1. 자동차 길찾기는 1일 10,000건, 다중 경유지는 1일 5,000건이다. 무료 한도를
 *     넘기면 응답이 끊긴다. 사용자 한 명의 한 번 조회가 후보 N개만큼의 호출을
 *     발생시키므로, 후보를 반드시 줄여서 넘겨야 한다.
 *  2. 경유지는 자동차 길찾기 최대 5개, 다중 경유지 API 최대 30개다. 후보를
 *     한 요청에 몰아넣으면 "모든 후보를 다 도는 경로"가 나와 버리므로,
 *     우회 증분은 후보마다 별도 요청으로 구해야 한다.
 *  3. 좌표는 WGS84 경도(x)/위도(y) 순서다. 위경도 순서를 헷갈리면 조용히 틀린다.
 */

const DIRECTIONS_URL = "https://apis-navi.kakaomobility.com/v1/directions";

const FUEL_PARAM: Record<FuelKind, string> = {
  gasoline: "GASOLINE",
  premium: "GASOLINE",
  diesel: "DIESEL",
  lpg: "LPG",
};

interface KakaoRouteResponse {
  routes?: {
    result_code: number;
    result_msg?: string;
    summary?: {
      distance: number;
      duration: number;
      fare?: { toll?: number; taxi?: number };
    };
    sections?: {
      distance: number;
      duration: number;
      roads?: { vertexes: number[] }[];
    }[];
  }[];
}

export interface KakaoRouteOptions {
  fuelKind: FuelKind;
  /** 카카오 priority 옵션 */
  priority?: "RECOMMEND" | "TIME" | "DISTANCE";
  /** 하이패스 장착 여부. 통행료 계산에 영향을 준다. */
  hipass?: boolean;
}

export class KakaoRouteProvider implements RouteProvider {
  readonly id = "kakao-mobility";
  readonly label = "카카오모빌리티 길찾기";
  readonly isLive = true;

  constructor(
    private readonly restApiKey: string,
    private readonly options: KakaoRouteOptions,
  ) {}

  private headers(): HeadersInit {
    return {
      Authorization: `KakaoAK ${this.restApiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request(
    origin: LatLng,
    destination: LatLng,
    waypoint?: LatLng,
  ): Promise<{
    distanceM: number;
    durationS: number;
    tollKrw: number;
    polyline: LatLng[];
  } | null> {
    const url = new URL(DIRECTIONS_URL);
    url.searchParams.set("origin", `${origin.lng},${origin.lat}`);
    url.searchParams.set("destination", `${destination.lng},${destination.lat}`);
    if (waypoint) {
      url.searchParams.set("waypoints", `${waypoint.lng},${waypoint.lat}`);
    }
    url.searchParams.set("priority", this.options.priority ?? "RECOMMEND");
    url.searchParams.set("car_fuel", FUEL_PARAM[this.options.fuelKind]);
    url.searchParams.set("car_hipass", String(this.options.hipass ?? true));
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("road_details", "true");

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) return null;
    const json = (await res.json()) as KakaoRouteResponse;
    const route = json.routes?.[0];
    if (!route || route.result_code !== 0 || !route.summary) return null;

    const polyline: LatLng[] = [];
    for (const section of route.sections ?? []) {
      for (const road of section.roads ?? []) {
        for (let i = 0; i + 1 < road.vertexes.length; i += 2) {
          polyline.push({ lng: road.vertexes[i], lat: road.vertexes[i + 1] });
        }
      }
    }

    return {
      distanceM: route.summary.distance,
      durationS: route.summary.duration,
      tollKrw: route.summary.fare?.toll ?? 0,
      polyline,
    };
  }

  async findRoute(origin: NamedPlace, destination: NamedPlace): Promise<Route> {
    const result = await this.request(origin, destination);
    if (!result) {
      throw new Error("카카오 길찾기 응답을 받지 못했습니다.");
    }
    return {
      id: `kakao-${origin.name}-${destination.name}`,
      origin,
      destination,
      polyline: result.polyline.length > 1 ? result.polyline : [origin, destination],
      distanceM: result.distanceM,
      durationS: result.durationS,
      tollKrw: result.tollKrw,
      summary: "카카오 추천 경로",
    };
  }

  /**
   * 후보마다 경유지 1개를 넣은 경로를 따로 요청해 기본 경로와의 차이를 구한다.
   * 후보 수만큼 쿼터를 쓰기 때문에 호출 전에 반드시 후보를 줄여야 한다.
   */
  async computeDetours(
    route: Route,
    stations: Station[],
  ): Promise<Map<string, Detour>> {
    const cum = cumulativeDistances(route.polyline);
    const out = new Map<string, Detour>();
    const concurrency = 4;

    for (let i = 0; i < stations.length; i += concurrency) {
      const batch = stations.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (station) => {
          const viaStation = await this.request(
            route.origin,
            route.destination,
            station,
          );
          return { station, viaStation };
        }),
      );

      for (const { station, viaStation } of results) {
        const proj = projectOntoPolyline(station, route.polyline, cum);
        if (!viaStation) continue;
        out.set(station.id, {
          extraDistanceM: Math.max(0, viaStation.distanceM - route.distanceM),
          extraDurationS: Math.max(0, viaStation.durationS - route.durationS),
          extraTollKrw: viaStation.tollKrw - route.tollKrw,
          alongRouteM: proj.alongM,
          offRouteM: proj.offsetM,
          joinPoint: proj.point,
          source: "routing-api",
        });
      }
    }

    return out;
  }

  detourShape(_route: Route, station: Station, joinPoint: LatLng): LatLng[] {
    return curveBetween(joinPoint, station);
  }
}

/**
 * 카카오내비 앱으로 길안내를 넘기는 딥링크.
 * 앱이 없으면 동작하지 않으므로 웹 지도 링크를 대체 수단으로 함께 제공해야 한다.
 */
export function kakaoNaviDeepLink(destination: NamedPlace): string {
  const params = new URLSearchParams({
    name: destination.name,
    x: String(destination.lng),
    y: String(destination.lat),
    coord_type: "wgs84",
  });
  return `kakaonavi://navigate?${params.toString()}`;
}

/** 카카오맵 웹 길찾기 (앱 미설치 대비) */
export function kakaoMapDirectionsUrl(
  origin: NamedPlace,
  destination: NamedPlace,
): string {
  return `https://map.kakao.com/?sName=${encodeURIComponent(origin.name)}&eName=${encodeURIComponent(destination.name)}`;
}
