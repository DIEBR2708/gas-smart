import { describe, expect, it } from "vitest";
import {
  carUnreachableReason,
  drivingRegion,
  polylineUnreachableReason,
} from "./driving-region";
import { interpolateRoute } from "./route-build";

const SEOUL = { name: "서울시청", lat: 37.5663, lng: 126.9779 };
const BUSAN = { name: "부산역", lat: 35.1151, lng: 129.0415 };
const JEJU = { name: "제주공항", lat: 33.511, lng: 126.493 };
const SEOGWIPO = { name: "서귀포", lat: 33.2541, lng: 126.56 };
const ULLEUNG = { name: "울릉", lat: 37.4844, lng: 130.9053 };
const MOKPO = { name: "목포", lat: 34.8118, lng: 126.3922 };

describe("drivingRegion", () => {
  it("육지와 제주·울릉을 구분한다", () => {
    expect(drivingRegion(SEOUL)).toBe("mainland");
    expect(drivingRegion(BUSAN)).toBe("mainland");
    expect(drivingRegion(MOKPO)).toBe("mainland");
    expect(drivingRegion(JEJU)).toBe("jeju");
    expect(drivingRegion(SEOGWIPO)).toBe("jeju");
    expect(drivingRegion(ULLEUNG)).toBe("ulleung");
  });
});

describe("carUnreachableReason", () => {
  it("육지 안 이동은 막지 않는다", () => {
    expect(carUnreachableReason(SEOUL, BUSAN)).toBeNull();
    expect(carUnreachableReason(SEOUL, MOKPO)).toBeNull();
  });

  it("제주 안 이동은 막지 않는다", () => {
    expect(carUnreachableReason(JEJU, SEOGWIPO)).toBeNull();
  });

  it("육지에서 제주·울릉으로 가는 자동차 경로를 막는다", () => {
    expect(carUnreachableReason(SEOUL, JEJU)).toMatch(/제주/);
    expect(carUnreachableReason(MOKPO, JEJU)).toMatch(/제주/);
    expect(carUnreachableReason(SEOUL, ULLEUNG)).toMatch(/울릉/);
  });
});

describe("polylineUnreachableReason", () => {
  it("육지 직선은 통과한다", () => {
    const route = interpolateRoute(SEOUL, BUSAN);
    expect(polylineUnreachableReason(route.polyline)).toBeNull();
  });

  it("제주로 그은 직선은 해협을 밟아 막힌다", () => {
    const steps = 24;
    const line = Array.from({ length: steps + 1 }, (_, i) => ({
      lat: SEOUL.lat + (JEJU.lat - SEOUL.lat) * (i / steps),
      lng: SEOUL.lng + (JEJU.lng - SEOUL.lng) * (i / steps),
    }));
    expect(polylineUnreachableReason(line)).toMatch(/제주|바다/);
  });
});
