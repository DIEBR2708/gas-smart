import type { FuelKind } from "@/lib/domain/types";
import { KakaoRouteProvider } from "./kakao/route-provider";
import { MockRouteProvider } from "./mock/route-provider";
import { MockStationProvider } from "./mock/station-provider";
import { OpinetStationProvider } from "./opinet/station-provider";
import type { RouteProvider, StationProvider } from "./types";

/**
 * 키가 있으면 실데이터, 없으면 샘플 데이터.
 *
 * 앱이 키 없이도 끝까지 동작해야 한다. 그래야 비용 모델을 검증할 수 있고,
 * 쿼터가 마르거나 API가 죽어도 화면이 백지가 되지 않는다.
 */

export interface ProviderSet {
  stations: StationProvider;
  routes: RouteProvider;
  /** 하나라도 실데이터를 쓰고 있는가 */
  anyLive: boolean;
}

class LiveStationsWithSampleFallback implements StationProvider {
  readonly id: string;
  readonly label: string;
  readonly isLive = true;
  usedFallback = false;

  constructor(
    private readonly live: StationProvider,
    private readonly sample: StationProvider,
  ) {
    this.id = live.id;
    this.label = live.label;
  }

  async findAlongRoute(
    route: Parameters<StationProvider["findAlongRoute"]>[0],
    query: Parameters<StationProvider["findAlongRoute"]>[1],
  ) {
    this.usedFallback = false;
    const live = await this.live.findAlongRoute(route, query);
    if (live.length > 0) return live;
    this.usedFallback = true;
    return this.sample.findAlongRoute(route, query);
  }
}

export function resolveProviders(
  fuelKind: FuelKind,
  departAt?: Date,
): ProviderSet {
  const opinetKey = process.env.OPINET_CERT_KEY?.trim();
  const kakaoKey = process.env.KAKAO_REST_API_KEY?.trim();

  const liveStations = opinetKey
    ? new OpinetStationProvider(opinetKey)
    : null;
  const stations: StationProvider = liveStations
    ? new LiveStationsWithSampleFallback(liveStations, new MockStationProvider())
    : new MockStationProvider();

  const routes: RouteProvider = kakaoKey
    ? new KakaoRouteProvider(kakaoKey, { fuelKind, departAt })
    : new MockRouteProvider();

  return { stations, routes, anyLive: stations.isLive || routes.isLive };
}

export function stationsUsedSampleFallback(stations: StationProvider): boolean {
  return (
    stations instanceof LiveStationsWithSampleFallback && stations.usedFallback
  );
}

export { MockRouteProvider, MockStationProvider };
export type { RouteProvider, StationProvider };
