import { describe, expect, it } from "vitest";
import {
  cumulativeDistances,
  haversineM,
  pointAtDistance,
  polylineLengthM,
  projectOntoPolyline,
  sampleAlongRoute,
} from "./geo";

const SEOUL = { lat: 37.5663, lng: 126.9779 };
const DAEJEON = { lat: 36.3504, lng: 127.3845 };

describe("haversineM", () => {
  it("서울-대전 직선거리가 실측치에 가깝다", () => {
    const km = haversineM(SEOUL, DAEJEON) / 1000;
    expect(km).toBeGreaterThan(137);
    expect(km).toBeLessThan(143);
  });

  it("같은 점은 0", () => {
    expect(haversineM(SEOUL, SEOUL)).toBeCloseTo(0, 6);
  });
});

describe("projectOntoPolyline", () => {
  const line = [
    { lat: 36, lng: 127 },
    { lat: 37, lng: 127 },
  ];

  it("경로 옆의 점을 수선으로 내린다", () => {
    const proj = projectOntoPolyline({ lat: 36.5, lng: 127.02 }, line);
    expect(proj.point.lat).toBeCloseTo(36.5, 3);
    expect(proj.offsetM).toBeGreaterThan(1500);
    expect(proj.offsetM).toBeLessThan(2000);
    expect(proj.alongM).toBeCloseTo(polylineLengthM(line) / 2, -2);
  });

  it("경로 위의 점은 이탈거리가 0에 가깝다", () => {
    const proj = projectOntoPolyline({ lat: 36.4, lng: 127 }, line);
    expect(proj.offsetM).toBeLessThan(1);
  });

  it("진행 방향 기준 좌우를 구분한다", () => {
    const left = projectOntoPolyline({ lat: 36.5, lng: 126.98 }, line);
    const right = projectOntoPolyline({ lat: 36.5, lng: 127.02 }, line);
    expect(left.side).not.toBe(right.side);
  });

  it("경로 끝을 지나친 점은 종점에 붙는다", () => {
    const proj = projectOntoPolyline({ lat: 37.5, lng: 127 }, line);
    expect(proj.alongM).toBeCloseTo(polylineLengthM(line), -2);
  });
});

describe("pointAtDistance", () => {
  const line = [
    { lat: 36, lng: 127 },
    { lat: 37, lng: 127 },
  ];

  it("절반 지점을 정확히 찾는다", () => {
    const total = polylineLengthM(line);
    const mid = pointAtDistance(line, total / 2);
    expect(mid.lat).toBeCloseTo(36.5, 4);
  });

  it("범위를 벗어난 값은 양 끝으로 잘린다", () => {
    expect(pointAtDistance(line, -100).lat).toBeCloseTo(36, 6);
    expect(pointAtDistance(line, 1e9).lat).toBeCloseTo(37, 6);
  });
});

describe("cumulativeDistances", () => {
  it("단조 증가하고 첫 값이 0이다", () => {
    const cum = cumulativeDistances([SEOUL, DAEJEON, { lat: 35.1, lng: 129.0 }]);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeLessThan(cum[2]);
  });
});

describe("sampleAlongRoute", () => {
  it("간격보다 촘촘하게 샘플을 만들고 종점을 포함한다", () => {
    const line = [SEOUL, DAEJEON];
    const total = polylineLengthM(line);
    const samples = sampleAlongRoute(line, 5000);
    expect(samples.length).toBeGreaterThanOrEqual(Math.floor(total / 5000));
    expect(samples[samples.length - 1].alongM).toBeCloseTo(total, -1);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].alongM).toBeGreaterThan(samples[i - 1].alongM);
    }
  });
});
