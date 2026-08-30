import { describe, expect, it } from "vitest";
import { MockRouteProvider } from "@/lib/providers/mock/route-provider";
import {
  interpolateRoute,
  isStraightFallbackRoute,
  noteKakaoRouteFailure,
} from "./route-build";
import { carUnreachableReason } from "./driving-region";

describe("interpolateRoute", () => {
  it("출발·도착을 버리지 않고 직선 경로를 만든다", () => {
    const route = interpolateRoute(
      { name: "전주", lat: 35.8242, lng: 127.148 },
      { name: "광주광역시청", lat: 35.1595, lng: 126.8526 },
    );
    expect(route.origin.name).toBe("전주");
    expect(route.destination.name).toBe("광주광역시청");
    expect(route.polyline.length).toBeGreaterThan(2);
    expect(route.distanceM).toBeGreaterThan(50_000);
    expect(route.summary).toContain("직선");
    expect(isStraightFallbackRoute(route)).toBe(true);
    expect(
      noteKakaoRouteFailure(route, "http-429").summary,
    ).toContain("일일 한도");
  });

  it("제주로 가는 직선은 만들지 않는다", () => {
    expect(() =>
      interpolateRoute(
        { name: "서울시청", lat: 37.5663, lng: 126.9779 },
        { name: "제주공항", lat: 33.511, lng: 126.493 },
      ),
    ).toThrow(/제주/);
    expect(
      carUnreachableReason(
        { lat: 37.5663, lng: 126.9779 },
        { lat: 33.511, lng: 126.493 },
      ),
    ).toMatch(/제주/);
  });
});

describe("MockRouteProvider.findRoute", () => {
  it("샘플에 없는 쌍은 서울–대전으로 바꿔치지 않는다", async () => {
    const provider = new MockRouteProvider();
    const route = await provider.findRoute(
      { name: "전주", lat: 35.8242, lng: 127.148 },
      { name: "광주광역시청", lat: 35.1595, lng: 126.8526 },
    );
    expect(route.origin.name).toBe("전주");
    expect(route.destination.name).toBe("광주광역시청");
    expect(route.id).toContain("custom");
  });
});
