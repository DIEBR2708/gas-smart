import type { Detour, FuelKind, LatLng, NamedPlace, Route, Station } from "@/lib/domain/types";

export interface StationQuery {
  fuelKind: FuelKind;
  /**
   * 경로 중심선에서 이 수직 거리(m) 안쪽을 빈틈 없이 덮어야 한다.
   *
   * 검색 반경이 아니라 회랑의 반폭이다. 프로바이더는 이 값에서 샘플 간격을
   * 역산해(`planCorridorSearch`) 호출 횟수를 정한다. 오피넷 반경 상한이
   * 5,000m이므로 그보다 넓은 회랑은 덮을 수 없다.
   */
  corridorHalfWidthM: number;
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
  computeDetours(
    route: Route,
    stations: Station[],
    signal?: AbortSignal,
  ): Promise<Map<string, Detour>>;
  /**
   * 목적지 없이 이 자리에서 각 주유소까지 가는 편도 실도로 경로.
   *
   * 주변 검색에는 본선이 없으므로 "경유했을 때의 증분"을 물을 대상이 없다.
   * 대신 가는 길 자체가 비용이고 지도에 그릴 형상이다. 실도로를 모르는
   * 프로바이더는 빈 Map을 돌려주고, 부르는 쪽이 직선 어림값으로 메운다.
   */
  computeLegs(
    origin: NamedPlace,
    stations: Station[],
    signal?: AbortSignal,
  ): Promise<Map<string, Detour>>;
  /** 지도에 그릴 우회 구간 형상 */
  detourShape(route: Route, station: Station, joinPoint: LatLng): LatLng[];
}
