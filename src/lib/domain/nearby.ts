import { haversineM, type Projection } from "./geo";
import type { Detour, LatLng, NamedPlace, Route, Station } from "./types";

/** 이 자리에서 주유소까지 가는 도시부 우회 계수 */
const URBAN_FACTOR = 1.25;
/** 주변 검색 때 쓰는 평균 속도 (km/h) */
const NEARBY_SPEED_KMH = 28;
/**
 * 하한값을 잡을 때 쓰는 속도 (km/h).
 *
 * 실제보다 빠르게 잡아야 시간 비용이 실제 이하로 남는다. 도시부에서 이보다
 * 빠르게 가는 일은 없으므로 하한이 깨지지 않는다.
 */
const NEARBY_FREEFLOW_KMH = 60;

export function nearbySearchRoute(origin: NamedPlace): Route {
  const tip: LatLng = {
    lat: origin.lat + 0.00002,
    lng: origin.lng,
  };
  return {
    id: `nearby:${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}`,
    origin,
    destination: { ...origin, name: origin.name },
    polyline: [origin, tip],
    distanceM: 0,
    durationS: 0,
    tollKrw: 0,
    summary: "이 자리 주변",
    driveable: true,
  };
}

export function isNearbySearchRoute(route: { id?: string; summary?: string }): boolean {
  return (
    Boolean(route.id?.startsWith("nearby:")) || route.summary === "이 자리 주변"
  );
}

/**
 * 편도 실도로 경로를 묻기 전, 그 주유소가 도달할 수 있는 가장 낮은 비용.
 *
 * 도로는 직선보다 짧을 수 없고 통행료는 0 이상이므로, 직선 거리와 자유
 * 흐름 속도로 잡은 값은 실제 비용을 넘지 않는다. 어림 계수(`URBAN_FACTOR`)를
 * 곱한 값은 하한이 아니다. 실제로 곧게 뻗은 길이면 그 값이 실제보다 커져
 * 가지치기가 진짜 최적안을 잘라낼 수 있다.
 */
export function nearbyDetourLowerBound(
  origin: LatLng,
  station: Station,
  proj: Projection,
): Detour {
  const straightM = proj.offsetM > 0 ? proj.offsetM : haversineM(origin, station);
  return {
    extraDistanceM: straightM,
    extraDurationS: (straightM / 1000 / NEARBY_FREEFLOW_KMH) * 3600,
    extraTollKrw: 0,
    alongRouteM: 0,
    offRouteM: straightM,
    joinPoint: origin,
    source: "geometric-estimate",
  };
}

export function nearbyGeometricDetour(
  origin: LatLng,
  station: Station,
  proj: Projection,
): Detour {
  const offsetM = proj.offsetM > 0 ? proj.offsetM : haversineM(origin, station);
  const extraDistanceM = offsetM * URBAN_FACTOR;
  return {
    extraDistanceM,
    extraDurationS: (extraDistanceM / 1000 / NEARBY_SPEED_KMH) * 3600,
    extraTollKrw: 0,
    alongRouteM: 0,
    offRouteM: offsetM,
    joinPoint: origin,
    source: "geometric-estimate",
    viaPolyline: [origin, { lat: station.lat, lng: station.lng }],
  };
}
