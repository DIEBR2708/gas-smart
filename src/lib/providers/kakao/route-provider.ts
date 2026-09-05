import {
  cumulativeDistances,
  projectOntoPolyline,
  viaRoutePolyline,
} from "@/lib/domain/geo";
import type {
  Detour,
  FuelKind,
  LatLng,
  NamedPlace,
  Route,
  Station,
} from "@/lib/domain/types";
import { fetchOutbound, mapPool, raceAbort } from "@/lib/http";
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

const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
const routeCache = new Map<string, { at: number; route: Route }>();
const routeInflight = new Map<string, Promise<Route>>();
const detourCache = new Map<string, { at: number; detour: Detour }>();
const detourInflight = new Map<string, Promise<Detour | null>>();

function pruneTimedCache<T extends { at: number }>(
  map: Map<string, T>,
  ttlMs: number,
  maxSize: number,
): void {
  if (map.size <= maxSize) return;
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.at >= ttlMs) map.delete(key);
  }
  if (map.size <= maxSize) return;
  const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < oldest.length - maxSize; i += 1) {
    map.delete(oldest[i][0]);
  }
}

const DIRECTIONS_URL = "https://apis-navi.kakaomobility.com/v1/directions";
const FUTURE_DIRECTIONS_URL =
  "https://apis-navi.kakaomobility.com/v1/future/directions";

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
  /**
   * 출발 시각. 지금으로부터 10분~48시간 안이면 미래운행정보 길찾기를 먼저 친다.
   * 실패하면 일반 길찾기로 내려간다.
   */
  departAt?: Date;
}

export class KakaoRouteProvider implements RouteProvider {
  readonly id = "kakao-mobility";
  readonly label = "카카오모빌리티 길찾기";
  readonly isLive = true;

  constructor(
    private readonly restApiKey: string,
    private readonly options: KakaoRouteOptions,
  ) {}

  private lastFailure: string | null = null;

  private futureDepartureParam(): string | null {
    const departAt = this.options.departAt;
    if (!departAt) return null;
    const minutesAhead = (departAt.getTime() - Date.now()) / 60_000;
    if (minutesAhead < 10 || minutesAhead > 48 * 60) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(departAt);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "00";
    return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}`;
  }

  /**
   * 미래길찾기가 한 번이라도 실패하면 이 프로세스에서는 다시 시도하지 않는다.
   * 경유 후보마다 미래→일반을 순차로 치면 우회 계산만 두 배가 된다.
   */
  private static futureDisabled = false;

  private async request(
    origin: LatLng,
    destination: LatLng,
    waypoint?: LatLng,
  ): Promise<{
    distanceM: number;
    durationS: number;
    tollKrw: number;
    polyline: LatLng[];
    includesTraffic: boolean;
  } | null> {
    if (waypoint) {
      const via = await this.requestOnce({
        origin,
        destination,
        waypoint,
        roadDetails: false,
        timeoutMs: 6_000,
      });
      return via ? { ...via, includesTraffic: false } : null;
    }

    // 본선은 일반 길찾기를 먼저 친다. 미래길찾기를 먼저 치면 권한·시간 초과만
    // 나고 실도로를 직선으로 바꿔 버린다.
    let live =
      (await this.requestOnce({
        origin,
        destination,
        roadDetails: true,
        timeoutMs: 15_000,
      })) ??
      (await this.requestOnce({
        origin,
        destination,
        roadDetails: false,
        timeoutMs: 12_000,
      }));
    if (!live) return null;

    const departure =
      KakaoRouteProvider.futureDisabled ? null : this.futureDepartureParam();
    if (!departure) return { ...live, includesTraffic: false };

    const future = await this.requestOnce({
      origin,
      destination,
      roadDetails: true,
      timeoutMs: 8_000,
      departureTime: departure,
      base: FUTURE_DIRECTIONS_URL,
    });
    if (future) return { ...future, includesTraffic: true };
    KakaoRouteProvider.futureDisabled = true;
    return { ...live, includesTraffic: false };
  }

  private async requestOnce(input: {
    origin: LatLng;
    destination: LatLng;
    waypoint?: LatLng;
    roadDetails: boolean;
    timeoutMs: number;
    departureTime?: string;
    base?: string;
  }): Promise<{
    distanceM: number;
    durationS: number;
    tollKrw: number;
    polyline: LatLng[];
  } | null> {
    const url = new URL(input.base ?? DIRECTIONS_URL);
    url.searchParams.set("origin", `${input.origin.lng},${input.origin.lat}`);
    url.searchParams.set(
      "destination",
      `${input.destination.lng},${input.destination.lat}`,
    );
    if (input.waypoint) {
      url.searchParams.set(
        "waypoints",
        `${input.waypoint.lng},${input.waypoint.lat}`,
      );
    }
    url.searchParams.set("priority", this.options.priority ?? "RECOMMEND");
    url.searchParams.set("car_fuel", FUEL_PARAM[this.options.fuelKind]);
    url.searchParams.set("car_hipass", String(this.options.hipass ?? true));
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("road_details", input.roadDetails ? "true" : "false");
    if (input.departureTime) {
      url.searchParams.set("departure_time", input.departureTime);
    }

    const res = await fetchOutbound(url, {
      headers: { Authorization: `KakaoAK ${this.restApiKey}` },
      timeoutMs: input.timeoutMs,
    });
    if (!res.ok) {
      this.lastFailure = `http-${res.status}`;
      return null;
    }
    let json: KakaoRouteResponse;
    try {
      json = (await res.json()) as KakaoRouteResponse;
    } catch {
      this.lastFailure = "parse";
      return null;
    }
    const route = json.routes?.[0];
    if (!route || route.result_code !== 0 || !route.summary) {
      this.lastFailure = `code-${route?.result_code ?? "empty"}`;
      return null;
    }
    this.lastFailure = null;

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
    const cacheKey = [
      origin.lat.toFixed(4),
      origin.lng.toFixed(4),
      destination.lat.toFixed(4),
      destination.lng.toFixed(4),
      this.options.fuelKind,
      this.options.priority ?? "RECOMMEND",
      this.futureDepartureParam() ?? "",
    ].join("|");
    const cached = routeCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ROUTE_CACHE_TTL_MS) {
      return {
        ...cached.route,
        origin,
        destination,
        id: `kakao-${origin.name}-${destination.name}`,
      };
    }
    const running = routeInflight.get(cacheKey);
    if (running) {
      const route = await running;
      return {
        ...route,
        origin,
        destination,
        id: `kakao-${origin.name}-${destination.name}`,
      };
    }

    const pending = (async () => {
      const result = await this.request(origin, destination);
      if (!result) {
        throw new Error(`KAKAO:${this.lastFailure ?? "no-response"}`);
      }
      const route: Route = {
        id: `kakao-${origin.name}-${destination.name}`,
        origin,
        destination,
        polyline:
          result.polyline.length > 1 ? result.polyline : [origin, destination],
        distanceM: result.distanceM,
        durationS: result.durationS,
        tollKrw: result.tollKrw,
        summary: result.includesTraffic
          ? "카카오 추천 경로 (출발 시각 정체 반영)"
          : "카카오 추천 경로",
        durationIncludesTraffic: result.includesTraffic,
      };
      pruneTimedCache(routeCache, ROUTE_CACHE_TTL_MS, 40);
      routeCache.set(cacheKey, { at: Date.now(), route });
      return route;
    })().finally(() => {
      routeInflight.delete(cacheKey);
    });
    routeInflight.set(cacheKey, pending);
    return pending;
  }

  /**
   * 후보마다 경유지 1개를 넣은 경로를 따로 요청해 기본 경로와의 차이를 구한다.
   * 후보 수만큼 쿼터를 쓰기 때문에 호출 전에 반드시 후보를 줄여야 한다.
   */
  async computeDetours(
    route: Route,
    stations: Station[],
    signal?: AbortSignal,
  ): Promise<Map<string, Detour>> {
    const cum = cumulativeDistances(route.polyline);
    const out = new Map<string, Detour>();
    const routeKey = [
      route.origin.lat.toFixed(4),
      route.origin.lng.toFixed(4),
      route.destination.lat.toFixed(4),
      route.destination.lng.toFixed(4),
      this.options.fuelKind,
      this.options.priority ?? "RECOMMEND",
      this.futureDepartureParam() ?? "",
    ].join("|");

    const pending: Station[] = [];
    for (const station of stations) {
      const key = `${routeKey}|${station.id}`;
      const hit = detourCache.get(key);
      if (hit && Date.now() - hit.at < ROUTE_CACHE_TTL_MS) {
        out.set(station.id, hit.detour);
      } else {
        pending.push(station);
      }
    }

    const results = await raceAbort(
      mapPool(pending, 12, async (station) => {
        const key = `${routeKey}|${station.id}`;
        const running = detourInflight.get(key);
        if (running) return { station, detour: await running };

        const promise = this.request(route.origin, route.destination, station)
          .then((viaStation) => {
            if (!viaStation) return null;
            const proj = projectOntoPolyline(station, route.polyline, cum);
            const detour: Detour = {
              extraDistanceM: Math.max(
                0,
                viaStation.distanceM - route.distanceM,
              ),
              extraDurationS: Math.max(
                0,
                viaStation.durationS - route.durationS,
              ),
              extraTollKrw: viaStation.tollKrw - route.tollKrw,
              alongRouteM: proj.alongM,
              offRouteM: proj.offsetM,
              joinPoint: proj.point,
              source: "routing-api",
              viaPolyline:
                viaStation.polyline.length > 1
                  ? viaStation.polyline
                  : viaRoutePolyline(
                      route.polyline,
                      station,
                      proj.point,
                      proj.alongM,
                    ),
            };
            detourCache.set(key, { at: Date.now(), detour });
            return detour;
          })
          .finally(() => {
            detourInflight.delete(key);
          });
        detourInflight.set(key, promise);
        return { station, detour: await promise };
      }),
      signal,
    );

    for (const { station, detour } of results) {
      if (detour) out.set(station.id, detour);
    }
    pruneTimedCache(detourCache, ROUTE_CACHE_TTL_MS, 400);
    return out;
  }

  detourShape(route: Route, station: Station, joinPoint: LatLng): LatLng[] {
    const cum = cumulativeDistances(route.polyline);
    const proj = projectOntoPolyline(station, route.polyline, cum);
    return viaRoutePolyline(route.polyline, station, joinPoint, proj.alongM);
  }
}