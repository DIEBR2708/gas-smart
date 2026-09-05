import { haversineM, type Projection } from "./geo";
import type { Detour, LatLng, NamedPlace, Route, Station } from "./types";

/** 이 자리에서 주유소까지 가는 도시부 우회 계수 */
const URBAN_FACTOR = 1.25;
/** 주변 검색 때 쓰는 평균 속도 (km/h) */
const NEARBY_SPEED_KMH = 28;

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
