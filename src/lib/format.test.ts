import { describe, expect, it } from "vitest";
import { cashCostKrw, displayStationName, signedMinutes } from "./format";

describe("displayStationName", () => {
  it("(주)와 주식회사를 뺀다", () => {
    expect(displayStationName("(주)강남주유소")).toBe("강남주유소");
    expect(displayStationName("강남주유소(주)")).toBe("강남주유소");
    expect(displayStationName("㈜현대오일뱅크")).toBe("현대오일뱅크");
    expect(displayStationName("주식회사 대전셀프")).toBe("대전셀프");
    expect(displayStationName("( 주 ) 서울")).toBe("서울");
  });
});

describe("signedMinutes", () => {
  it("초를 +N분으로 적는다", () => {
    expect(signedMinutes(300)).toBe("+5분");
    expect(signedMinutes(0)).toBe("+0분");
    expect(signedMinutes(-120)).toBe("-2분");
  });
});

describe("cashCostKrw", () => {
  it("시간 비용을 뺀다", () => {
    expect(cashCostKrw({ normalizedCostKrw: 50_000, timeCostKrw: 800 })).toBe(
      49_200,
    );
  });
});
