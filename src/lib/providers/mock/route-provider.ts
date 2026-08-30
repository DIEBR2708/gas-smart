import {
  knownCorridorRoute,
  SAMPLE_ROUTE_SEEDS,
  seedToRoute,
} from "@/lib/data/sample-routes";
import { interpolateRoute } from "@/lib/domain/route-build";
import {
  cumulativeDistances,
  projectOntoPolyline,
  viaRoutePolyline,
} from "@/lib/domain/geo";
import type { Detour, LatLng, NamedPlace, Route, Station } from "@/lib/domain/types";
import type { RouteProvider } from "../types";

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

function stableJitter(id: string): number {
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return 0.88 + ((hash >>> 8) % 1000) / 1000 * 0.24;
}

/**
 * 샘플 경로 프로바이더.
 *
 * 우회 비용을 도로망이 아니라 기하학으로 추정한다. 왕복 이탈거리에
 * 접근 특성별 계수를 곱하고 회차·램프 지연을 더한다. 실제 도로에서는
 * 강, 중앙분리대, 일방통행 때문에 이 추정이 크게 틀릴 수 있어서
 * 결과에 `geometric-estimate` 표시를 반드시 남긴다.
 */
export class MockRouteProvider implements RouteProvider {
  readonly id = "mock-routes";
  readonly label = "샘플 경로 데이터";
  readonly isLive = false;

  async findRoute(origin: NamedPlace, destination: NamedPlace): Promise<Route> {
    const match = SAMPLE_ROUTE_SEEDS.find(
      (seed) =>
        seed.originName === origin.name && seed.destinationName === destination.name,
    );
    if (match) return seedToRoute(match);
    const corridor = knownCorridorRoute(origin, destination);
    if (corridor) return corridor;
    // 모르는 출발·도착을 서울–대전으로 바꾸면 사용자가 고른 좌표가 사라진다.
    return interpolateRoute(origin, destination);
  }

  async computeDetours(
    route: Route,
    stations: Station[],
  ): Promise<Map<string, Detour>> {
    const cum = cumulativeDistances(route.polyline);
    const out = new Map<string, Detour>();

    for (const station of stations) {
      const proj = projectOntoPolyline(station, route.polyline, cum);
      const hint = station.accessHint;
      const jitter = stableJitter(station.id);

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

      extraDistanceM *= jitter;

      out.set(station.id, {
        extraDistanceM,
        extraDurationS: (extraDistanceM / 1000 / speedKmh) * 3600 + delayS,
        extraTollKrw,
        alongRouteM: proj.alongM,
        offRouteM: proj.offsetM,
        joinPoint: proj.point,
        source: "geometric-estimate",
        viaPolyline: viaRoutePolyline(
          route.polyline,
          station,
          proj.point,
          proj.alongM,
        ),
      });
    }

    return out;
  }

  detourShape(route: Route, station: Station, joinPoint: LatLng): LatLng[] {
    const cum = cumulativeDistances(route.polyline);
    const proj = projectOntoPolyline(station, route.polyline, cum);
    return viaRoutePolyline(route.polyline, station, joinPoint, proj.alongM);
  }
}
