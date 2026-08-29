import { describe, expect, it } from "vitest";
import { congestionFactorAt } from "./traffic";

describe("congestionFactorAt", () => {
  it("평일 출근 시간대는 1보다 크다", () => {
    const rush = congestionFactorAt(new Date("2026-08-28T08:00:00+09:00"), false);
    const noon = congestionFactorAt(new Date("2026-08-28T13:00:00+09:00"), false);
    expect(rush).toBeGreaterThan(1.2);
    expect(noon).toBe(1);
  });

  it("고속도로 출퇴근은 도심보다 계수가 작다", () => {
    const urban = congestionFactorAt(new Date("2026-08-28T18:00:00+09:00"), false);
    const highway = congestionFactorAt(new Date("2026-08-28T18:00:00+09:00"), true);
    expect(highway).toBeGreaterThan(1);
    expect(highway).toBeLessThan(urban);
  });

  it("주말 오전은 평일 출근보다 한산하다", () => {
    const weekday = congestionFactorAt(new Date("2026-08-28T08:00:00+09:00"), false);
    const sunday = congestionFactorAt(new Date("2026-08-30T08:00:00+09:00"), false);
    expect(sunday).toBeLessThan(weekday);
  });
});
