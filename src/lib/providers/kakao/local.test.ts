import { describe, expect, it } from "vitest";
import { looksLikeRoadAddress } from "./local";

describe("looksLikeRoadAddress", () => {
  it("도로명과 번지를 주소로 본다", () => {
    expect(looksLikeRoadAddress("테헤란로 427")).toBe(true);
    expect(looksLikeRoadAddress("세종대로 110")).toBe(true);
    expect(looksLikeRoadAddress("강남대로396")).toBe(true);
  });

  it("도시·역 이름은 주소가 아니다", () => {
    expect(looksLikeRoadAddress("부산")).toBe(false);
    expect(looksLikeRoadAddress("서울시청")).toBe(false);
    expect(looksLikeRoadAddress("강남역")).toBe(false);
  });
});
