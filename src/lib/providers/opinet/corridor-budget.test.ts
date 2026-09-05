import { describe, expect, it } from "vitest";
import {
  planCorridorSearch,
  sampleCorridorCenters,
} from "@/lib/domain/corridor";
import { DAILY_CALL_BUDGET } from "./fetch-queue";

/** 서울–대전 정도의 장거리 한 건이 하루 예산을 통째로 먹지 않아야 한다. */
function straightPolyline(km: number) {
  const steps = 400;
  const degPerKm = 1 / 111.32;
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: 37.5665 - (km * degPerKm * i) / steps,
    lng: 126.978,
  }));
}

describe("경로 한 건이 쓰는 오피넷 호출 수", () => {
  it("장거리도 하루 예산의 일부만 쓴다", () => {
    const polyline = straightPolyline(160);
    const plan = planCorridorSearch(polyline, 3_000);
    const centers = sampleCorridorCenters(
      polyline,
      plan.coveredHalfWidthM,
      plan.searchRadiusM,
    );
    expect(centers.length).toBeGreaterThan(0);
    expect(centers.length).toBeLessThan(DAILY_CALL_BUDGET / 4);
  });
});
