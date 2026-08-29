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

export function resolveProviders(fuelKind: FuelKind): ProviderSet {
  const opinetKey = process.env.OPINET_CERT_KEY?.trim();
  const kakaoKey = process.env.KAKAO_REST_API_KEY?.trim();

  const stations: StationProvider = opinetKey
    ? new OpinetStationProvider(opinetKey)
    : new MockStationProvider();

  const routes: RouteProvider = kakaoKey
    ? new KakaoRouteProvider(kakaoKey, { fuelKind })
    : new MockRouteProvider();

  return { stations, routes, anyLive: stations.isLive || routes.isLive };
}

export { MockRouteProvider, MockStationProvider };
export type { RouteProvider, StationProvider };
