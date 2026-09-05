import type { NamedPlace } from "./domain/types";

/**
 * 외부 지도로 경로를 넘기는 링크.
 *
 * 이 앱은 직접 길안내를 하지 않는다. 운전 중 화면 조작을 유도하지 않기 위해
 * 주유소 선택은 출발 전에 끝내는 것을 전제로 한다.
 */

/** 다회 주유 일정을 카카오맵 웹 경로로 넘긴다. */
export function kakaoMapMultiStopUrl(stops: NamedPlace[]): string {
  const leg = (p: NamedPlace) =>
    `${encodeURIComponent(p.name)},${p.lat},${p.lng}`;
  const params = stops.map((stop, index) =>
    index === 0 ? `rt=${leg(stop)}` : `rt${index}=${leg(stop)}`,
  );
  return `https://map.kakao.com/?map_type=TYPE_MAP&target=car&${params.join("&")}`;
}
