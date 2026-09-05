import { describe, expect, it } from "vitest";
import { planCorridorSearch, sampleCorridorCenters } from "./corridor";

/**
 * 경로 한 건이 오피넷 하루 한도를 통째로 먹으면 안 된다.
 * 필요한 샘플 간격은 sqrt(r^2 - w^2)이라 반폭이 반경에 가까울수록 무너진다.
 */
function straightPolyline(km: number) {
  const steps = 400;
  const degPerKm = 1 / 111.32;
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: 37.5665 - (km * degPerKm * i) / steps,
    lng: 126.978,
  }));
}

describe("회랑 조회 횟수", () => {
  it("반폭이 넓어질수록 호출이 가파르게 는다", () => {
    const polyline = straightPolyline(160);
    const calls = (halfWidthM: number) => {
      const plan = planCorridorSearch(polyline, halfWidthM);
      return sampleCorridorCenters(
        polyline,
        plan.coveredHalfWidthM,
        plan.searchRadiusM,
      ).length;
    };
    expect(calls(2_500)).toBeLessThan(calls(4_000));
    expect(calls(4_000)).toBeLessThan(calls(4_500));
  });

  it("2.5km 반폭이면 서울–대전 한 건이 25회 안쪽이다", () => {
    const polyline = straightPolyline(160);
    const plan = planCorridorSearch(polyline, 2_500);
    const centers = sampleCorridorCenters(
      polyline,
      plan.coveredHalfWidthM,
      plan.searchRadiusM,
    );
    expect(centers.length).toBeLessThanOrEqual(25);
  });
});
