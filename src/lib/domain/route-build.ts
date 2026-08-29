import { polylineLengthM } from "./geo";
import type { LatLng, NamedPlace, Route } from "./types";

/**
 * 두 지점을 잇는 근사 경로.
 * 카카오 길찾기 키가 없을 때 사용자가 고른 출발·도착을 버리기보다
 * 직선 보간으로라도 회랑 검색이 돌아가게 한다. 화면에도 추정치임을 밝힌다.
 */
export function interpolateRoute(origin: NamedPlace, destination: NamedPlace): Route {
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
  };
}
