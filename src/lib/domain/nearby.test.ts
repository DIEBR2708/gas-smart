import { describe, expect, it } from "vitest";
import { nearbySearchRoute, isNearbySearchRoute } from "./nearby";

describe("nearbySearchRoute", () => {
  it("목적지 없이 이 자리 주변 경로를 만든다", () => {
    const route = nearbySearchRoute({
      name: "서울시청",
      lat: 37.5663,
      lng: 126.9779,
    });
    expect(isNearbySearchRoute(route)).toBe(true);
    expect(route.distanceM).toBe(0);
    expect(route.summary).toBe("이 자리 주변");
    expect(route.origin.name).toBe("서울시청");
  });
});
