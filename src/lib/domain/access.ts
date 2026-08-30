import { pointAtDistance, viaRoutePolyline, type Projection } from "./geo";
import type { AccessHint, Detour, LatLng, Route, Station } from "./types";

/** 나들목까지 갔다가 반대편으로 붙는 최소 왕복 (m). */
const HIGHWAY_TURNAROUND_M = 4_200;
const HIGHWAY_TURNAROUND_AHEAD_M = 2_800;
const HIGHWAY_TURNAROUND_SPEED_KMH = 50;
const HIGHWAY_TURNAROUND_DELAY_S = 240;
const HIGHWAY_REENTRY_TOLL_KRW = 900;

export function routeLooksDivided(route: Route): boolean {
  if (route.summary?.includes("고속")) return true;
  const hours = route.durationS / 3600;
  if (hours <= 0) return false;
  return route.distanceM / 1000 / hours >= 68;
}

/**
 * 경로 왼쪽·본선 이탈로 접근 힌트를 채운다.
 * 카카오 실측이 있어도 중앙분리대 유턴을 허용하는 경우가 있어, 힌트는 따로 둔다.
 */
export function inferAccessHint(
  proj: Projection,
  route: Route,
  existing?: AccessHint,
): AccessHint {
  const divided = routeLooksDivided(route);
  const oppositeSide =
    existing?.oppositeSide ??
    (proj.side > 0 && proj.offsetM >= 25 && proj.offsetM <= 380);
  const onHighway =
    existing?.onHighway ?? (divided && proj.offsetM < 260 && !oppositeSide);
  const requiresHighwayExit =
    existing?.requiresHighwayExit ??
    (divided && (oppositeSide || (!onHighway && proj.offsetM > 320)));
  return { oppositeSide, requiresHighwayExit, onHighway };
}

export function withAccessHint(
  station: Station,
  proj: Projection,
  route: Route,
): Station {
  return {
    ...station,
    accessHint: inferAccessHint(proj, route, station.accessHint),
  };
}

/**
 * 반대편인데 우회가 왕복 이탈거리 수준이면, 길찾기가 유턴을 넣은 것이다.
 * 고속·자동차전용처럼 중앙분리대가 있는 도로에서는 그 유턴을 쓸 수 없다.
 */
export function looksLikeIllegalUturn(
  detour: Detour,
  proj: Projection,
  hint: AccessHint | undefined,
  route: Route,
): boolean {
  if (!hint?.oppositeSide) return false;
  if (!hint.requiresHighwayExit && !routeLooksDivided(route)) return false;
  const medianHopM = proj.offsetM * 2 + 700;
  return detour.extraDistanceM <= medianHopM;
}

export function highwayTurnaroundDetour(
  proj: Projection,
  route: Route,
  station: LatLng,
): Detour {
  const extraDistanceM = proj.offsetM * 2 * 1.35 + HIGHWAY_TURNAROUND_M;
  const extraDurationS =
    (extraDistanceM / 1000 / HIGHWAY_TURNAROUND_SPEED_KMH) * 3600 +
    HIGHWAY_TURNAROUND_DELAY_S;
  const turnaroundAlongM = Math.min(
    route.distanceM,
    proj.alongM + HIGHWAY_TURNAROUND_AHEAD_M,
  );
  const joinPoint = pointAtDistance(route.polyline, turnaroundAlongM);
  return {
    extraDistanceM,
    extraDurationS,
    extraTollKrw: HIGHWAY_REENTRY_TOLL_KRW,
    alongRouteM: proj.alongM,
    offRouteM: proj.offsetM,
    joinPoint,
    source: "geometric-estimate",
    viaPolyline: viaRoutePolyline(
      route.polyline,
      station,
      joinPoint,
      turnaroundAlongM,
    ),
  };
}

export function rejectIllegalUturn(
  detour: Detour,
  proj: Projection,
  station: Station,
  route: Route,
): Detour {
  const hint = station.accessHint;
  if (!looksLikeIllegalUturn(detour, proj, hint, route)) return detour;
  return highwayTurnaroundDetour(proj, route, station);
}
