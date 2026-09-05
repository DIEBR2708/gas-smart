import type { Projection } from "./geo";
import { viaRoutePolyline } from "./geo";
import type { Detour, Route, Station } from "./types";

/**
 * 길찾기를 치지 않고 기하학만으로 우회를 추정한다.
 *
 * 왕복 이탈거리에 접근 특성별 계수를 곱하고 회차·램프 지연을 더한다. 실제
 * 도로에서는 강, 중앙분리대, 일방통행 때문에 이 추정이 크게 틀릴 수 있어서
 * 결과에는 반드시 `geometric-estimate` 표시가 남는다.
 *
 * 쓰이는 곳이 둘이다. 인증키가 없을 때의 샘플 경로 프로바이더, 그리고 실제
 * 경유 길찾기가 도착하기 전에 순위를 먼저 띄우는 1차 계산이다. 둘이 서로 다른
 * 어림값을 쓰면 화면이 두 번 크게 흔들리므로 모델은 하나만 둔다.
 */

/** 우회 구간 주행 속도 가정 (km/h) */
const SPEED = {
  urban: 30,
  turnaround: 24,
  ramp: 52,
};

/** 좌회전·유턴·신호 대기 등 거리로 환산되지 않는 시간 손실 (초) */
const FIXED_DELAY_S = {
  plain: 45,
  oppositeSide: 130,
  highwayExit: 260,
  restArea: 70,
};

/** 고속도로를 진출·재진입할 때 추가로 달려야 하는 램프 구간 (m) */
const RAMP_EXTRA_M = 2400;

/** 진출 후 재진입에 따른 통행료 증분 가정 (원) */
const REENTRY_TOLL_KRW = 900;

export function estimateDetour(
  route: Route,
  station: Station,
  proj: Projection,
  options: {
    /** 거리에 곱할 계수. 샘플 데이터에 결을 주기 위한 흔들림에 쓴다. */
    distanceFactor?: number;
    /** 지도에 그릴 우회 형상까지 만들지 */
    withShape?: boolean;
  } = {},
): Detour {
  const hint = station.accessHint;

  let extraDistanceM: number;
  let speedKmh: number;
  let delayS: number;
  let extraTollKrw = 0;

  if (hint?.onHighway) {
    // 본선 휴게소. 진출이 필요 없어 사실상 우회가 없다.
    extraDistanceM = 260 + proj.offsetM * 0.6;
    speedKmh = SPEED.ramp;
    delayS = FIXED_DELAY_S.restArea;
  } else if (hint?.requiresHighwayExit) {
    extraDistanceM = proj.offsetM * 2 * 1.35 + RAMP_EXTRA_M;
    speedKmh = SPEED.ramp;
    delayS = FIXED_DELAY_S.highwayExit;
    extraTollKrw = REENTRY_TOLL_KRW;
  } else if (hint?.oppositeSide) {
    // 반대편 차선이면 회차 구간까지 갔다 와야 한다.
    extraDistanceM = proj.offsetM * 2 * 1.55 + 700;
    speedKmh = SPEED.turnaround;
    delayS = FIXED_DELAY_S.oppositeSide;
  } else {
    extraDistanceM = proj.offsetM * 2 * 1.25;
    speedKmh = SPEED.urban;
    delayS = FIXED_DELAY_S.plain;
  }

  extraDistanceM *= options.distanceFactor ?? 1;

  return {
    extraDistanceM,
    extraDurationS: (extraDistanceM / 1000 / speedKmh) * 3600 + delayS,
    extraTollKrw,
    alongRouteM: proj.alongM,
    offRouteM: proj.offsetM,
    joinPoint: proj.point,
    source: "geometric-estimate",
    viaPolyline: options.withShape
      ? viaRoutePolyline(route.polyline, station, proj.point, proj.alongM)
      : undefined,
  };
}

/** 샘플 데이터가 한 줄로 늘어서 보이지 않도록 주유소마다 고정된 흔들림을 준다. */
export function stableJitter(id: string): number {
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return 0.88 + (((hash >>> 8) % 1000) / 1000) * 0.24;
}
