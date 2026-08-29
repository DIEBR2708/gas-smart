import { carUnreachableReason } from "./driving-region";
import { polylineLengthM } from "./geo";
import type { LatLng, NamedPlace, Route } from "./types";

/**
 * 두 지점을 잇는 근사 경로.
 * 카카오 길찾기 키가 없을 때 사용자가 고른 출발·도착을 버리기보다
 * 직선 보간으로라도 회랑 검색이 돌아가게 한다. 화면에도 추정치임을 밝힌다.
 * 배로만 이어진 구간(제주 등)은 직선으로 잇지 않는다.
 */
export function interpolateRoute(origin: NamedPlace, destination: NamedPlace): Route {
  const blocked = carUnreachableReason(origin, destination);
  if (blocked) throw new Error(blocked);
  const steps = 24;
  const polyline: LatLng[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    polyline.push({
      lat: origin.lat + (destination.lat - origin.lat) * t,
      lng: origin.lng + (destination.lng - origin.lng) * t,
    });
  }
  const distanceM = polylineLengthM(polyline);
  const avgSpeedKmh = 70;
  return {
    id: `custom:${origin.name}->${destination.name}`,
    origin,
    destination,
    polyline,
    distanceM,
    durationS: (distanceM / 1000 / avgSpeedKmh) * 3600,
    tollKrw: 0,
    summary: "직선 근사 경로 (실도로 아님)",
    driveable: true,
  };
}

/** 바다로 끊긴 출발·도착. 지도에는 점만 찍고 선은 그리지 않는다. */
export function disconnectedEndpointsRoute(
  origin: NamedPlace,
  destination: NamedPlace,
): Route {
  return {
    id: `unreachable:${origin.name}->${destination.name}`,
    origin,
    destination,
    polyline: [origin, destination],
    distanceM: 0,
    durationS: 0,
    tollKrw: 0,
    summary: "자동차 경로 없음",
    driveable: false,
  };
}
