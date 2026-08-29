import { describe, expect, it } from "vitest";
import { MockRouteProvider } from "@/lib/providers/mock/route-provider";
import { interpolateRoute } from "./route-build";

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
