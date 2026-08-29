import type { NamedPlace } from "./domain/types";

/**
 * 외부 내비게이션으로 안내를 넘기는 링크.
 *
 * 이 앱은 직접 길안내를 하지 않는다. 운전 중 화면 조작을 유도하지 않기 위해
 * 주유소 선택은 출발 전에 끝내고, 실제 안내는 검증된 내비 앱에 맡긴다.
 * 앱이 설치되어 있지 않을 때를 대비해 웹 링크를 함께 제공한다.
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

/** 카카오맵 웹 길찾기. 출발지에서 주유소를 경유해 목적지까지. */
export function kakaoMapRouteUrl(
  origin: NamedPlace,
  waypoint: NamedPlace,
  destination: NamedPlace,
): string {
  const leg = (p: NamedPlace) =>
    `${encodeURIComponent(p.name)},${p.lat},${p.lng}`;
  return `https://map.kakao.com/?map_type=TYPE_MAP&target=car&rt=${leg(origin)}&rt1=${leg(waypoint)}&rt2=${leg(destination)}`;
}

/** 주유소 위치를 지도에서 바로 확인하는 링크 */
export function kakaoMapPlaceUrl(place: NamedPlace): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}
