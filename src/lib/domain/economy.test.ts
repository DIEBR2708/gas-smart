import { describe, expect, it } from "vitest";
import { learnedKmPerLiter } from "./economy";

describe("learnedKmPerLiter", () => {
  it("기록이 두 건 미만이면 추정하지 않는다", () => {
    expect(learnedKmPerLiter([])).toBeNull();
    expect(
      learnedKmPerLiter([{ id: "1", at: "2026-01-01", kmDriven: 400, liters: 40 }]),
    ).toBeNull();
  });

  it("최근 기록에 더 큰 가중치를 준다", () => {
    const estimate = learnedKmPerLiter([
      { id: "1", at: "2026-01-01", kmDriven: 400, liters: 40 },
      { id: "2", at: "2026-06-01", kmDriven: 520, liters: 40 },
    ]);
    // 10과 13의 가중평균 (1*10 + 2*13) / 3 = 12
    expect(estimate).toBeCloseTo(12, 5);
  });

  it("비정상 값은 버린다", () => {
    expect(
      learnedKmPerLiter([
        { id: "1", at: "2026-01-01", kmDriven: 1, liters: 40 },
        { id: "2", at: "2026-06-01", kmDriven: 2, liters: 40 },
      ]),
    ).toBeNull();
  });
});
