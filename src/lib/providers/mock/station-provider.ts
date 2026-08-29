import { getSampleStations, getStationsForRoute } from "@/lib/data/sample-stations";
import { planCorridorSearch } from "@/lib/domain/corridor";
import {
  cumulativeDistances,
  haversineM,
  sampleAlongRoute,
} from "@/lib/domain/geo";
import type { Route, Station } from "@/lib/domain/types";
import type { StationProvider, StationQuery } from "../types";

/**
 * 샘플 데이터 기반 주유소 프로바이더.
 *
 * 오피넷의 제약을 일부러 재현한다. 경로를 일정 간격으로 샘플링하고 각 지점에서
 * 반경 검색을 한 뒤 중복을 제거하는 방식이다. 실제 API로 갈아탈 때
 * 호출 횟수와 사각지대 문제가 그대로 드러나야 설계가 무너지지 않는다.
 */
export class MockStationProvider implements StationProvider {
  readonly id = "mock-stations";
  readonly label = "샘플 주유소 데이터";
  readonly isLive = false;

  async findAlongRoute(route: Route, query: StationQuery): Promise<Station[]> {
    const all = [...getSampleStations(), ...getStationsForRoute(route)];
    const cum = cumulativeDistances(route.polyline);
    const plan = planCorridorSearch(route.polyline, query.corridorHalfWidthM);
    const samples = sampleAlongRoute(route.polyline, plan.intervalM, cum);

    const found = new Map<string, Station>();
    for (const sample of samples) {
      for (const station of all) {
        if (found.has(station.id)) continue;
        if (haversineM(sample.point, station) <= plan.searchRadiusM) {
          found.set(station.id, station);
        }
      }
    }
    return [...found.values()];
  }
}
