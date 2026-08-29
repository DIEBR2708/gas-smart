import { describe, expect, it } from "vitest";
import {
  breakEvenDetourKm,
  effectivePricePerLiter,
  evaluateOption,
  litersRequiredForTrip,
  median,
  type CostContext,
} from "./cost";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_VEHICLE,
  straightRoute,
  testDetour,
  testStation,
} from "./fixtures";
import type { Preferences, Vehicle } from "./types";

const DEPART_AT = new Date("2026-08-29T09:00:00+09:00");

function ctx(overrides: {
  vehicle?: Partial<Vehicle>;
  preferences?: Partial<Preferences>;
  referencePriceKrwPerL?: number;
  distanceKm?: number;
} = {}): CostContext {
  const vehicle = { ...DEFAULT_VEHICLE, ...overrides.vehicle };
  const preferences = { ...DEFAULT_PREFERENCES, ...overrides.preferences };
  return {
    vehicle,
    preferences,
    route: straightRoute(overrides.distanceKm ?? 100),
    referencePriceKrwPerL:
      overrides.referencePriceKrwPerL ??
      effectivePricePerLiter(1700, preferences),
    departAt: DEPART_AT,
  };
}

describe("effectivePricePerLiter", () => {
  it("정액 할인을 먼저 빼고 정률 할인을 곱한다", () => {
    const price = effectivePricePerLiter(1700, {
      ...DEFAULT_PREFERENCES,
      cardDiscountKrwPerL: 100,
      extraDiscountRate: 0.1,
    });
    expect(price).toBeCloseTo(1600 * 0.9, 6);
  });

  it("브랜드 조건부 할인 규칙은 해당 브랜드에만 적용된다", () => {
    const preferences: Preferences = {
      ...DEFAULT_PREFERENCES,
      cardDiscountKrwPerL: 0,
      extraDiscountRate: 0,
      discountRules: [
        {
          id: "sk",
          name: "SK 제휴",
          enabled: true,
          flatKrwPerL: 80,
          rate: 0,
          brands: ["SKE"],
        },
      ],
    };
    expect(effectivePricePerLiter(1700, preferences, "SKE")).toBe(1620);
    expect(effectivePricePerLiter(1700, preferences, "GSC")).toBe(1700);
  });

  it("할인이 가격을 넘어도 음수가 되지 않는다", () => {
    const price = effectivePricePerLiter(100, {
      ...DEFAULT_PREFERENCES,
      cardDiscountKrwPerL: 500,
      extraDiscountRate: 0,
    });
    expect(price).toBe(0);
  });
});

describe("litersRequiredForTrip", () => {
  it("현재 연료와 예비량을 반영한다", () => {
    // 100km / 10km/L = 10L 필요, 예비 6L, 보유 4L -> 12L
    const liters = litersRequiredForTrip(
      { ...DEFAULT_VEHICLE, kmPerLiter: 10, currentFuelL: 4, reserveL: 6 },
      100_000,
    );
    expect(liters).toBeCloseTo(12, 6);
  });

  it("이미 충분하면 0이다", () => {
    const liters = litersRequiredForTrip(
      { ...DEFAULT_VEHICLE, kmPerLiter: 10, currentFuelL: 40, reserveL: 6 },
      100_000,
    );
    expect(liters).toBe(0);
  });
});

describe("evaluateOption", () => {
  it("취급하지 않는 유종이면 후보가 아니다", () => {
    const option = evaluateOption(
      testStation({ prices: { diesel: 1500 } }),
      testDetour(),
      ctx(),
    );
    expect(option).toBeNull();
  });

  it("우회 거리가 늘어나면 실질 총비용이 커진다", () => {
    const c = ctx();
    const near = evaluateOption(testStation(), testDetour(), c)!;
    const far = evaluateOption(
      testStation(),
      testDetour({ extraDistanceM: 6000, extraDurationS: 720 }),
      c,
    )!;
    expect(far.normalizedCostKrw).toBeGreaterThan(near.normalizedCostKrw);
  });

  it("우회로 태우는 연료가 주입량에 반영된다", () => {
    const c = ctx({
      vehicle: { kmPerLiter: 10 },
      preferences: { fillPolicy: { mode: "toDestination" } },
    });
    const near = evaluateOption(testStation(), testDetour(), c)!;
    const far = evaluateOption(
      testStation(),
      testDetour({ extraDistanceM: 10_000 }),
      c,
    )!;
    // 우회 10km / 10km/L = 1L 추가 주유
    expect(far.litersToBuy - near.litersToBuy).toBeCloseTo(1, 5);
    expect(far.detourFuelL).toBeCloseTo(1, 5);
  });

  it("현재 연료로 못 가는 주유소는 도달 불가로 표시된다", () => {
    const c = ctx({ vehicle: { currentFuelL: 2, kmPerLiter: 10 } });
    const option = evaluateOption(
      testStation(),
      testDetour({ alongRouteM: 80_000 }),
      c,
    )!;
    expect(option.reachable).toBe(false);
    expect(option.warnings.map((w) => w.code)).toContain("unreachable");
  });

  it("탱크 용량을 넘겨 주입할 수 없다", () => {
    const c = ctx({
      vehicle: { tankCapacityL: 30, currentFuelL: 28, kmPerLiter: 5 },
      preferences: { fillPolicy: { mode: "full" } },
      distanceKm: 100,
    });
    const option = evaluateOption(
      testStation(),
      testDetour({ alongRouteM: 10_000 }),
      c,
    )!;
    expect(option.litersToBuy).toBeLessThanOrEqual(30);
    expect(option.fuelOnArrivalL + option.litersToBuy).toBeLessThanOrEqual(
      30 + 1e-6,
    );
  });

  it("같은 시세라면 가득 주유와 필요량 주유의 실질 비용이 같다", () => {
    // 정규화가 제대로 되어 있는지 판별하는 핵심 불변식.
    // 남는 연료를 자산으로 상계하지 않으면 '가득'이 항상 비싸 보이는 왜곡이 생긴다.
    const preferences = { ...DEFAULT_PREFERENCES, cardDiscountKrwPerL: 0 };
    const reference = 1700;
    const base = {
      vehicle: { ...DEFAULT_VEHICLE, kmPerLiter: 10, currentFuelL: 10 },
      route: straightRoute(150),
      referencePriceKrwPerL: reference,
      departAt: DEPART_AT,
    };
    const toDestination = evaluateOption(testStation(), testDetour(), {
      ...base,
      preferences: { ...preferences, fillPolicy: { mode: "toDestination" } },
    })!;
    const full = evaluateOption(testStation(), testDetour(), {
      ...base,
      preferences: { ...preferences, fillPolicy: { mode: "full" } },
    })!;

    expect(full.litersToBuy).toBeGreaterThan(toDestination.litersToBuy);
    expect(full.normalizedCostKrw).toBeCloseTo(
      toDestination.normalizedCostKrw,
      4,
    );
  });

  it("예산이 부족하면 모자란 연료를 시세로 비용에 더한다", () => {
    const preferences: Preferences = {
      ...DEFAULT_PREFERENCES,
      cardDiscountKrwPerL: 0,
      fillPolicy: { mode: "fixedBudget", krw: 10_000 },
    };
    const c: CostContext = {
      vehicle: { ...DEFAULT_VEHICLE, kmPerLiter: 10, currentFuelL: 5 },
      preferences,
      route: straightRoute(150),
      referencePriceKrwPerL: 1700,
      departAt: DEPART_AT,
    };
    const option = evaluateOption(testStation(), testDetour(), c)!;

    // 10,000원 / 1,700원 = 약 5.88L 만 넣으므로 목적지 도착 전에 바닥난다.
    expect(option.litersToBuy).toBeCloseTo(10_000 / 1700, 4);
    expect(option.shortfallFuelL).toBeGreaterThan(0);
    expect(option.shortfallCostKrw).toBeCloseTo(1700 * option.shortfallFuelL, 4);
    expect(option.warnings.map((w) => w.code)).toContain(
      "insufficient-to-destination",
    );
  });

  it("싼 가격이 우회 비용을 못 이기면 더 비싼 근거리 주유소가 이긴다", () => {
    const c = ctx({
      vehicle: { kmPerLiter: 9, currentFuelL: 8 },
      preferences: { cardDiscountKrwPerL: 0, timeValueKrwPerMin: 200 },
      referencePriceKrwPerL: 1700,
      distanceKm: 60,
    });
    const nearExpensive = evaluateOption(
      testStation({ id: "near", prices: { gasoline: 1745 } }),
      testDetour({ alongRouteM: 20_000, extraDistanceM: 300, extraDurationS: 60 }),
      c,
    )!;
    const farCheap = evaluateOption(
      testStation({ id: "far", prices: { gasoline: 1700 } }),
      testDetour({
        alongRouteM: 20_000,
        extraDistanceM: 9000,
        extraDurationS: 20 * 60,
      }),
      c,
    )!;
    expect(nearExpensive.normalizedCostKrw).toBeLessThan(
      farCheap.normalizedCostKrw,
    );
  });

  it("영업시간이 지난 주유소는 오류 경고를 받는다", () => {
    const c: CostContext = {
      ...ctx(),
      departAt: new Date("2026-08-29T23:30:00+09:00"),
    };
    const option = evaluateOption(
      testStation({
        openingHours: { allDay: false, open: "06:00", close: "22:00" },
      }),
      testDetour({ alongRouteM: 0 }),
      c,
    )!;
    expect(option.warnings.map((w) => w.code)).toContain("closed-on-arrival");
  });

  it("오래된 가격 신고에는 신선도 경고가 붙는다", () => {
    const option = evaluateOption(
      testStation({
        priceUpdatedAt: new Date("2026-08-25T00:00:00+09:00").toISOString(),
      }),
      testDetour(),
      ctx(),
    )!;
    expect(option.warnings.map((w) => w.code)).toContain("stale-price");
  });
});

describe("breakEvenDetourKm", () => {
  it("시간 가치가 0이면 절감액을 리터당 연료비로 나눈 값이다", () => {
    // 20L x 50원 = 1,000원 이득. 1km 주행 비용 = 1700 / 12 = 141.7원.
    const km = breakEvenDetourKm({
      gainPerLiterKrw: 50,
      litersToBuy: 20,
      effectivePriceKrwPerL: 1700,
      kmPerLiter: 12,
      timeValueKrwPerMin: 0,
      detourSpeedKmh: 30,
    });
    expect(km).toBeCloseTo(1000 / (1700 / 12), 4);
    expect(km).toBeLessThan(8);
  });

  it("시간을 비용으로 보면 손익분기 거리가 짧아진다", () => {
    const args = {
      gainPerLiterKrw: 50,
      litersToBuy: 20,
      effectivePriceKrwPerL: 1700,
      kmPerLiter: 12,
      detourSpeedKmh: 30,
    };
    const free = breakEvenDetourKm({ ...args, timeValueKrwPerMin: 0 });
    const valued = breakEvenDetourKm({ ...args, timeValueKrwPerMin: 300 });
    expect(valued).toBeLessThan(free);
  });

  it("이득이 없으면 0이다", () => {
    expect(
      breakEvenDetourKm({
        gainPerLiterKrw: -10,
        litersToBuy: 30,
        effectivePriceKrwPerL: 1700,
        kmPerLiter: 12,
        timeValueKrwPerMin: 100,
        detourSpeedKmh: 30,
      }),
    ).toBe(0);
  });
});

describe("median", () => {
  it("짝수 개면 가운데 두 값의 평균", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("빈 배열은 0", () => {
    expect(median([])).toBe(0);
  });
});
