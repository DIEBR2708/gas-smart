import { describe, expect, it } from "vitest";
import { searchGazetteer } from "./places";

describe("searchGazetteer", () => {
  it("별칭으로 찾는다", () => {
    const hits = searchGazetteer("강남");
    expect(hits.some((place) => place.name === "강남역")).toBe(true);
  });

  it("빈 검색어는 결과를 주지 않는다", () => {
    expect(searchGazetteer("   ")).toEqual([]);
  });
});
