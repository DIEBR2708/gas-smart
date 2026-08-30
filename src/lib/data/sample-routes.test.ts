import { describe, expect, it } from "vitest";
import { isStraightFallbackRoute } from "@/lib/domain/route-build";
import { knownCorridorRoute } from "./sample-routes";

const SEOUL = { name: "서울시청", lat: 37.5663, lng: 126.9779 };
const BUSAN = { name: "부산역", lat: 35.1151, lng: 129.0415 };
const GANGNAM = { name: "강남역", lat: 37.4979, lng: 127.0276 };
const HAEUNDAE = { name: "해운대", lat: 35.1631, lng: 129.1636 };
const JEONJU = { name: "전주", lat: 35.8242, lng: 127.148 };

describe("knownCorridorRoute", () => {
  it("부산에서 서울은 경부 회랑으로 잇는다", () => {
    const route = knownCorridorRoute(BUSAN, SEOUL);
    expect(route).not.toBeNull();
    expect(route!.polyline.length).toBeGreaterThan(20);
    expect(route!.distanceM).toBeGreaterThan(350_000);
    expect(route!.summary).toContain("경부");
    expect(isStraightFallbackRoute(route!)).toBe(false);
  });

  it("서울·부산 근처 지명도 같은 회랑을 쓴다", () => {
    const route = knownCorridorRoute(HAEUNDAE, GANGNAM);
    expect(route).not.toBeNull();
    expect(route!.origin.name).toBe("해운대");
    expect(route!.destination.name).toBe("강남역");
    expect(isStraightFallbackRoute(route!)).toBe(false);
  });

  it("경부가 아닌 쌍은 회랑을 주지 않는다", () => {
    expect(knownCorridorRoute(JEONJU, SEOUL)).toBeNull();
  });
});
