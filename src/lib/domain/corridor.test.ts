import { describe, expect, it } from "vitest";
import { SAMPLE_ROUTES } from "@/lib/data/sample-routes";
import {
  STATION_SEARCH_MAX_RADIUS_M,
  corridorSampleIntervalM,
  maxTurnAngleRad,
  planCorridorSearch,
} from "./corridor";
import {
  cumulativeDistances,
  haversineM,
  pointAtDistance,
  projectOntoPolyline,
  sampleAlongRoute,
} from "./geo";
import type { LatLng } from "./types";

const STRAIGHT: LatLng[] = [
  { lat: 36, lng: 127 },
  { lat: 37, lng: 127 },
  { lat: 38, lng: 127 },
];

describe("maxTurnAngleRad", () => {
  it("직선 경로는 0이다", () => {
    expect(maxTurnAngleRad(STRAIGHT)).toBeLessThan(1e-3);
  });

  it("직각으로 꺾이면 90도에 가깝다", () => {
    const corner: LatLng[] = [
      { lat: 36, lng: 127 },
      { lat: 37, lng: 127 },
      { lat: 37, lng: 128 },
    ];
    const deg = (maxTurnAngleRad(corner) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(85);
    expect(deg).toBeLessThan(95);
  });
});

describe("corridorSampleIntervalM", () => {
  it("직선에서는 현 공식을 따른다", () => {
    // r=5000, w=4000 -> 2*sqrt(25e6-16e6) = 6000, 안전계수 0.9 적용
    expect(corridorSampleIntervalM(5000, 4000, 0)).toBeCloseTo(6000 * 0.9, 4);
  });

  it("꺾임이 급하면 간격이 좁아진다", () => {
    const straight = corridorSampleIntervalM(5000, 4000, 0);
    const gentle = corridorSampleIntervalM(5000, 4000, Math.PI / 6);
    const sharp = corridorSampleIntervalM(5000, 4000, Math.PI / 2);
    expect(gentle).toBeLessThan(straight);
    expect(sharp).toBeLessThan(gentle);
  });

  it("유턴에서는 삼각부등식 한계로 수렴한다", () => {
    // theta=180도면 2*(r-w) = 2000, 안전계수 적용
    expect(corridorSampleIntervalM(5000, 4000, Math.PI)).toBeCloseTo(
      2000 * 0.9,
      4,
    );
  });

  it("회랑 반폭이 넓어지면 간격이 좁아진다", () => {
    expect(corridorSampleIntervalM(5000, 4500, 0)).toBeLessThan(
      corridorSampleIntervalM(5000, 1000, 0),
    );
  });

  it("반폭이 반경 이상이어도 간격이 0이 되지 않는다", () => {
    expect(corridorSampleIntervalM(5000, 5000, 0)).toBeGreaterThan(0);
    expect(corridorSampleIntervalM(5000, 99_999, Math.PI)).toBeGreaterThan(0);
  });
});

describe("planCorridorSearch", () => {
  it("항상 API 상한 반경으로 요청한다", () => {
    // 호출 한 번의 비용은 반경과 무관하므로 반경을 줄일 이유가 없다.
    const plan = planCorridorSearch(SAMPLE_ROUTES[0].polyline, 1500);
    expect(plan.searchRadiusM).toBe(STATION_SEARCH_MAX_RADIUS_M);
  });

  it("반경 상한보다 넓은 회랑은 잘렸다고 표시한다", () => {
    const plan = planCorridorSearch(SAMPLE_ROUTES[0].polyline, 9000);
    expect(plan.coveredHalfWidthM).toBeLessThan(9000);
    expect(plan.truncated).toBe(true);
  });

  it("회랑이 좁으면 호출 수가 줄어든다", () => {
    const narrow = planCorridorSearch(SAMPLE_ROUTES[0].polyline, 1500);
    const wide = planCorridorSearch(SAMPLE_ROUTES[0].polyline, 4500);
    expect(narrow.callCount).toBeLessThan(wide.callCount);
  });
});

/**
 * 회랑 커버리지 회귀 테스트.
 *
 * 이전 구현은 간격을 반경의 1.4배로 고정했다. 그러면 인접한 두 원 사이의
 * "허리"에서 회랑 폭을 다 덮지 못해, 경로에서 3~4km 떨어진 지점의 약 27%가
 * 어떤 검색 원에도 들어가지 않았다. 실데이터라면 그 자리의 주유소가 조용히
 * 사라진다. 이 테스트가 그 회귀를 막는다.
 */
describe("경로 회랑에 사각지대가 없다", () => {
  for (const route of SAMPLE_ROUTES) {
    for (const requestedHalfWidthM of [1200, 2500, 4000, 6000]) {
      it(`${route.origin.name}-${route.destination.name}, 요청 반폭 ${requestedHalfWidthM}m`, () => {
        const cum = cumulativeDistances(route.polyline);
        const plan = planCorridorSearch(route.polyline, requestedHalfWidthM);
        const samples = sampleAlongRoute(route.polyline, plan.intervalM, cum);

        const offsetPoint = (alongM: number, offsetM: number): LatLng => {
          const a = pointAtDistance(route.polyline, alongM, cum);
          const b = pointAtDistance(
            route.polyline,
            Math.min(route.distanceM, alongM + 150),
            cum,
          );
          const latScale = 1 / 111_320;
          const lngScale = 1 / (111_320 * Math.cos((a.lat * Math.PI) / 180));
          const dLat = b.lat - a.lat;
          const dLng = b.lng - a.lng;
          const norm = Math.hypot(dLat / latScale, dLng / lngScale) || 1;
          return {
            lat: a.lat + (-dLng / lngScale / norm) * latScale * offsetM,
            lng: a.lng + (dLat / latScale / norm) * lngScale * offsetM,
          };
        };

        let tested = 0;
        const blindSpots: string[] = [];

        for (let alongM = 0; alongM <= route.distanceM; alongM += 150) {
          for (const ratio of [0.25, 0.5, 0.75, 0.9, 1]) {
            for (const side of [1, -1]) {
              const target = offsetPoint(
                alongM,
                plan.coveredHalfWidthM * ratio * side,
              );
              const proj = projectOntoPolyline(target, route.polyline, cum);
              // 경로 양 끝을 넘어간 지점은 회랑의 정의에서 벗어난다.
              if (proj.alongM <= 1 || proj.alongM >= route.distanceM - 1) {
                continue;
              }
              if (proj.offsetM > plan.coveredHalfWidthM) continue;
              tested += 1;
              const covered = samples.some(
                (s) => haversineM(s.point, target) <= plan.searchRadiusM,
              );
              if (!covered) {
                blindSpots.push(
                  `${(alongM / 1000).toFixed(1)}km 지점, 이탈 ${Math.round(proj.offsetM)}m`,
                );
              }
            }
          }
        }

        expect(tested).toBeGreaterThan(500);
        expect(blindSpots).toEqual([]);
      });
    }
  }
});
