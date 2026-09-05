import {
  knownCorridorRoute,
  SAMPLE_ROUTE_SEEDS,
  seedToRoute,
} from "@/lib/data/sample-routes";
import { interpolateRoute } from "@/lib/domain/route-build";
import {
  estimateDetour,
  stableJitter,
} from "@/lib/domain/detour-estimate";
import {
  cumulativeDistances,
  projectOntoPolyline,
  viaRoutePolyline,
} from "@/lib/domain/geo";
import type { Detour, LatLng, NamedPlace, Route, Station } from "@/lib/domain/types";
import type { RouteProvider } from "../types";

/**
 * 샘플 경로 프로바이더.
 *
 * 우회 비용은 도로망이 아니라 기하학으로 추정한다(`estimateDetour`).
 * 주유소마다 고정된 흔들림을 곱해 샘플이 한 줄로 늘어서 보이지 않게 한다.
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
      out.set(
        station.id,
        estimateDetour(route, station, proj, {
          distanceFactor: stableJitter(station.id),
          withShape: true,
        }),
      );
    }

    return out;
  }

  detourShape(route: Route, station: Station, joinPoint: LatLng): LatLng[] {
    const cum = cumulativeDistances(route.polyline);
    const proj = projectOntoPolyline(station, route.polyline, cum);
    return viaRoutePolyline(route.polyline, station, joinPoint, proj.alongM);
  }
}
