"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 미디어 쿼리를 리액트 상태처럼 읽는다.
 *
 * 배치는 되도록 CSS(`lg:` 같은 접두사)로 가른다. 여기까지 올려야 하는 것은
 * 보이고 안 보이고를 넘어 **동작이 달라지는** 경우다. 예를 들어 폰에서는
 * 아래 패널에 세 쪽이 들어가고 데스크톱에서는 두 쪽만 들어가는데, 쪽 수는
 * 스와이프가 어디까지 넘어가는지를 정하므로 CSS로는 표현할 수 없다.
 *
 * 그래서 JS가 보는 경계와 CSS가 보는 경계가 어긋나면 안 된다.
 * PHONE_LAYOUT 은 Tailwind `lg`(1024px)의 바로 아래를 가리킨다.
 */
export const PHONE_LAYOUT = "(max-width: 1023.98px)";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    /*
      서버에서는 화면 크기를 알 수 없다. 이 앱의 Planner는 ssr:false 로 실어서
      서버가 이 값을 볼 일이 없지만, 값을 하나 정해 두지 않으면 프리렌더가
      터진다. 넓은 쪽을 기본으로 두면 폰에서 첫 프레임에 데스크톱 배치가
      스치는데, 좁은 쪽을 기본으로 두면 그 반대가 된다. 실제로 렌더되지 않는
      경로이므로 어느 쪽이든 같지만, 이 앱의 주 사용처를 따라 폰으로 둔다.
    */
    () => true,
  );
}
