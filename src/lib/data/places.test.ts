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

  it("추가한 지명도 별칭으로 찾는다", () => {
    expect(searchGazetteer("홍대").some((place) => place.name === "홍대입구역")).toBe(
      true,
    );
    expect(searchGazetteer("세종시").some((place) => place.name === "세종시청")).toBe(
      true,
    );
  });

  it("도시 별칭은 정확 일치를 앞에 둔다", () => {
    expect(searchGazetteer("부산")[0]?.name).toBe("부산역");
    expect(searchGazetteer("서울")[0]?.name).toBe("서울시청");
    expect(searchGazetteer("부산")[0]?.address).toMatch(/동구/);
  });
});
