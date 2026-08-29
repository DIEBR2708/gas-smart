import type { Detour, FuelKind, LatLng, NamedPlace, Route, Station } from "@/lib/domain/types";

export interface StationQuery {
  fuelKind: FuelKind;
  /**
   * 경로 중심선에서 이 거리(m) 안쪽의 주유소만 요청한다.
   * 오피넷 `aroundAll.do`는 반경 5,000m가 상한이므로 그보다 크게 잡아도 소용없다.
   */
  corridorRadiusM: number;
}

export interface StationProvider {
  readonly id: string;
  readonly label: string;
  /** 이 프로바이더가 실데이터를 쓰는지 (UI에 샘플 데이터 배너를 띄우기 위함) */
  readonly isLive: boolean;
  findAlongRoute(route: Route, query: StationQuery): Promise<Station[]>;
}

export interface RouteProvider {
  readonly id: string;
  readonly label: string;
  readonly isLive: boolean;
  /** 저장된 샘플 경로 또는 실시간 경로 탐색 */
  findRoute(origin: NamedPlace, destination: NamedPlace): Promise<Route>;
  /**
   * 각 주유소를 경유지로 넣었을 때의 우회 증분을 계산한다.
   * 호출 비용이 큰 연산이므로(경유지 길찾기 1건 = 쿼터 1건) 후보를 미리 줄여서 넘긴다.
   */
  computeDetours(route: Route, stations: Station[]): Promise<Map<string, Detour>>;
  /** 지도에 그릴 우회 구간 형상 */
  detourShape(route: Route, station: Station, joinPoint: LatLng): LatLng[];
}
