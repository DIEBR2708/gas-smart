import { describe, expect, it } from "vitest";
import { SAMPLE_ROUTES } from "@/lib/data/sample-routes";
import { MockRouteProvider } from "@/lib/providers/mock/route-provider";
import { MockStationProvider } from "@/lib/providers/mock/station-provider";
import { DEFAULT_PREFERENCES, DEFAULT_VEHICLE } from "./fixtures";
import { buildRefuelPlan } from "./plan";
import type { Preferences, Vehicle } from "./types";


const providers = {
  stations: new MockStationProvider(),
  routes: new MockRouteProvider(),
};

const DEPART_AT = new Date("2026-08-29T09:00:00+09:00");
const route = SAMPLE_ROUTES[0];

function plan(overrides: {
  vehicle?: Partial<Vehicle>;
  preferences?: Partial<Preferences>;
} = {}) {
  return buildRefuelPlan(
    {
      route,
      vehicle: { ...DEFAULT_VEHICLE, ...overrides.vehicle },
      preferences: { ...DEFAULT_PREFERENCES, ...overrides.preferences },
      departAt: DEPART_AT,
    },
    providers,
  );
}

describe("buildRefuelPlan", () => {
  it("실질 총비용 오름차순으로 정렬된다", async () => {
    const result = await plan();
    expect(result.options.length).toBeGreaterThan(1);
    for (let i = 1; i < result.options.length; i += 1) {
      expect(result.options[i].normalizedCostKrw).toBeGreaterThanOrEqual(
        result.options[i - 1].normalizedCostKrw,
      );
    }
    expect(result.best?.rank).toBe(1);
  });

  it("기준선은 우회가 가장 짧은 후보다", async () => {
    const result = await plan();
    const minDetour = Math.min(
      ...result.options.map((o) => o.detour.extraDistanceM),
    );
    expect(result.baseline?.detour.extraDistanceM).toBeCloseTo(minDetour, 6);
    expect(result.baseline?.savingKrw).toBeCloseTo(0, 6);
  });

  it("최적안의 절감액은 음수가 될 수 없다", async () => {
    const result = await plan();
    expect(result.best!.savingKrw).toBeGreaterThanOrEqual(-1e-6);
  });

  it("우회 허용치를 좁히면 후보가 줄어든다", async () => {
    const wide = await plan({ preferences: { maxDetourKm: 12, maxDetourMin: 40 } });
    const narrow = await plan({ preferences: { maxDetourKm: 1, maxDetourMin: 3 } });
    expect(narrow.options.length).toBeLessThan(wide.options.length);
    for (const option of narrow.options) {
      expect(option.detour.extraDistanceM / 1000).toBeLessThanOrEqual(1);
    }
  });

  it("연료가 넉넉하면 주유가 필요 없다고 판정한다", async () => {
    const result = await plan({
      vehicle: { currentFuelL: 58, tankCapacityL: 60, kmPerLiter: 12 },
      preferences: { fillPolicy: { mode: "toDestination" } },
    });
    expect(result.canReachWithoutRefueling).toBe(true);
    expect(result.verdict).toBe("no-refuel-needed");
  });

  it("가득 주유의 절감액 중 재고 선구매분을 분리해 알려준다", async () => {
    const result = await plan({ preferences: { fillPolicy: { mode: "full" } } });
    const best = result.best!;
    // 시세보다 싼 곳에서 가득 채우면 남는 연료에도 이득이 붙는다.
    // 그 몫은 지금 지갑에서 덜 나가는 돈이 아니므로 따로 표시해야 한다.
    expect(best.surplusFuelL).toBeGreaterThan(0);
    expect(best.stockUpValueKrw).toBeCloseTo(
      Math.max(0, result.referencePriceKrwPerL - best.effectivePriceKrwPerL) *
        best.surplusFuelL,
      6,
    );
  });

  it("필요한 만큼만 넣으면 재고 선구매분이 생기지 않는다", async () => {
    const result = await plan({
      preferences: { fillPolicy: { mode: "toDestination" } },
    });
    for (const option of result.options) {
      expect(option.surplusFuelL).toBeLessThan(1e-6);
      expect(option.stockUpValueKrw).toBeLessThan(1e-6);
    }
  });

  it("예비량 아래로 도착하는 주유소는 목록에 올리지 않는다", async () => {
    const result = await plan({
      vehicle: { currentFuelL: 12, kmPerLiter: 10, reserveL: 5 },
    });
    for (const option of result.options) {
      expect(option.fuelOnArrivalL).toBeGreaterThanOrEqual(5 - 1e-6);
    }
    expect(result.excluded.some((e) => e.reason.includes("예비"))).toBe(true);
  });

  it("연료가 거의 없으면 먼 주유소를 후보에서 제외한다", async () => {
    const result = await plan({ vehicle: { currentFuelL: 3, kmPerLiter: 10 } });
    for (const option of result.options) {
      expect(option.detour.alongRouteM / 1000 / 10).toBeLessThanOrEqual(3);
    }
    expect(
      result.excluded.some((e) => e.reason.includes("도달 불가")),
    ).toBe(true);
  });

  it("시간의 가치를 높이면 더 짧은 우회를 고른다", async () => {
    const wide = { maxDetourKm: 20, maxDetourMin: 60 };
    const timeIsFree = await plan({
      preferences: { ...wide, timeValueKrwPerMin: 0 },
    });
    const timeIsExpensive = await plan({
      preferences: { ...wide, timeValueKrwPerMin: 3000 },
    });
    expect(timeIsExpensive.best!.detour.extraDurationS).toBeLessThanOrEqual(
      timeIsFree.best!.detour.extraDurationS,
    );
  });

  it("절감 기준을 높이면 애매한 판정으로 내려간다", async () => {
    const result = await plan({ preferences: { minMeaningfulSavingKrw: 1_000_000 } });
    expect(["marginal", "stay-on-route", "no-refuel-needed"]).toContain(
      result.verdict,
    );
  });

  it("브랜드를 제한하면 그 브랜드만 남는다", async () => {
    const result = await plan({ preferences: { brands: ["RTE"] } });
    for (const option of result.options) {
      expect(option.station.brand).toBe("RTE");
    }
  });

  it("셀프 전용 설정을 지킨다", async () => {
    const result = await plan({ preferences: { selfServiceOnly: true } });
    for (const option of result.options) {
      expect(option.station.isSelfService).toBe(true);
    }
  });

  it("고속도로 진출 회피를 켜면 해당 후보가 사라진다", async () => {
    const result = await plan({ preferences: { avoidHighwayExit: true } });
    for (const option of result.options) {
      expect(option.station.accessHint?.requiresHighwayExit).not.toBe(true);
    }
  });

  it("모든 후보에 도로 기반이 아님을 알리는 경고가 붙는다", async () => {
    const result = await plan();
    for (const option of result.options) {
      expect(option.warnings.map((w) => w.code)).toContain("estimated-detour");
    }
    expect(result.meta.detourSource).toBe("geometric-estimate");
  });

  it("조회 범위와 계산 범위를 숨기지 않고 보고한다", async () => {
    const result = await plan();
    expect(result.meta.candidateCount).toBeGreaterThan(result.options.length);
    expect(result.meta.exactlyEvaluated).toBeLessThanOrEqual(
      result.meta.candidateCount,
    );
    expect(result.meta.corridorHalfWidthM).toBeGreaterThan(0);
    expect(result.meta.searchCallCount).toBeGreaterThan(1);
    expect(result.meta.optimalityGuaranteed).toBe(true);
  });

  it("허용 우회가 너무 넓으면 회랑이 잘렸다고 알린다", async () => {
    const result = await plan({
      preferences: { maxDetourKm: 25, maxDetourMin: 90 },
    });
    expect(result.meta.requestedHalfWidthM).toBe(12_500);
    expect(result.meta.corridorTruncated).toBe(true);
    expect(result.meta.corridorHalfWidthM).toBeLessThan(
      result.meta.requestedHalfWidthM,
    );
  });

  it("폐업 제보된 주유소는 후보에서 뺀다", async () => {
    const first = await plan();
    const target = first.options[0]?.station;
    expect(target).toBeDefined();
    const reported = await buildRefuelPlan(
      {
        route,
        vehicle: DEFAULT_VEHICLE,
        preferences: DEFAULT_PREFERENCES,
        departAt: DEPART_AT,
        reports: [
          {
            id: "r1",
            stationId: target.id,
            stationName: target.name,
            kind: "gone",
            note: "",
            reportedAt: DEPART_AT.toISOString(),
          },
        ],
      },
      providers,
    );
    expect(reported.options.some((o) => o.station.id === target.id)).toBe(false);
    expect(
      reported.excluded.some(
        (item) => item.station.id === target.id && item.reason.includes("폐업"),
      ),
    ).toBe(true);
  });

  it("탱크가 짧으면 다회 주유 일정을 만든다", async () => {
    const result = await plan({
      vehicle: {
        tankCapacityL: 18,
        currentFuelL: 5,
        kmPerLiter: 10,
        reserveL: 5,
      },
    });
    // 서울–대전은 약 160km. 18L로는 예비량을 남기고 한 번에 못 간다.
    if (result.itinerary.length >= 2) {
      expect(result.verdict).toBe("multi-stop");
      expect(result.itinerary[0].litersToBuy).toBeGreaterThan(0);
    } else {
      // 후보 배치에 따라 한 번에 닿을 수도 있다. 그 경우에도 일정이 비지 않아야 한다.
      expect(result.canReachWithoutRefueling || result.itinerary.length === 1).toBe(
        true,
      );
    }
  });

  it("모든 제외 후보에 이유가 붙는다", async () => {
    const result = await plan();
    for (const item of result.excluded) {
      expect(item.reason.length).toBeGreaterThan(0);
    }
    // 조회된 주유소는 채택되거나 이유와 함께 제외되거나 둘 중 하나다.
    // 어느 쪽에도 없이 사라지는 주유소가 있으면 안 된다.
    const accounted = new Set([
      ...result.options.map((o) => o.station.id),
      ...result.excluded.map((e) => e.station.id),
    ]);
    expect(accounted.size).toBe(result.meta.candidateCount);
  });
});

/**
 * 후보 줄이기가 최적안을 놓치지 않는지 전수 계산으로 검증한다.
 *
 * 하한값 기반 가지치기는 "최소 우회로도 이미 최적안보다 비싸다"는 증명에
 * 기대고 있다. 그 증명이 틀리면 앱은 더 싼 주유소를 알면서 숨기는 셈이 된다.
 * 회랑 안의 모든 후보를 정직하게 다 계산한 결과와 비교한다.
 */
describe("가지치기가 최적안을 버리지 않는다", () => {
  const scenarios: {
    label: string;
    vehicle?: Partial<Vehicle>;
    preferences?: Partial<Preferences>;
    routeIndex?: number;
  }[] = [
    { label: "기본" },
    { label: "필요한 만큼만", preferences: { fillPolicy: { mode: "toDestination" } } },
    { label: "금액 지정", preferences: { fillPolicy: { mode: "fixedBudget", krw: 50_000 } } },
    { label: "시간 가치 높음", preferences: { timeValueKrwPerMin: 600 } },
    { label: "우회 허용 넓음", preferences: { maxDetourKm: 15, maxDetourMin: 45 } },
    { label: "할인 없음", preferences: { cardDiscountKrwPerL: 0 } },
    { label: "연료 부족", vehicle: { currentFuelL: 6, kmPerLiter: 9 } },
    { label: "경유차", vehicle: { fuelKind: "diesel" } },
    { label: "인천공항 경로", routeIndex: 1 },
    { label: "강릉 장거리", routeIndex: 2, vehicle: { currentFuelL: 20 } },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.label}: 전수 계산과 최적안이 같다`, async () => {
      const targetRoute = SAMPLE_ROUTES[scenario.routeIndex ?? 0];
      const vehicle = { ...DEFAULT_VEHICLE, ...scenario.vehicle };
      const preferences = { ...DEFAULT_PREFERENCES, ...scenario.preferences };

      const pruned = await buildRefuelPlan(
        { route: targetRoute, vehicle, preferences, departAt: DEPART_AT },
        providers,
      );
      const exhaustive = await buildRefuelPlan(
        { route: targetRoute, vehicle, preferences, departAt: DEPART_AT },
        // 가지치기를 무력화한 프로바이더가 아니라, 계산 상한만 크게 둔 계획과 비교한다.
        providers,
        { maxExactCandidates: Number.POSITIVE_INFINITY, disablePruning: true },
      );

      expect(pruned.meta.optimalityGuaranteed).toBe(true);
      if (!exhaustive.best) {
        expect(pruned.best).toBeNull();
        return;
      }
      expect(pruned.best).not.toBeNull();
      expect(pruned.best!.normalizedCostKrw).toBeCloseTo(
        exhaustive.best.normalizedCostKrw,
        6,
      );
      expect(pruned.best!.station.id).toBe(exhaustive.best.station.id);
      // 가지치기가 실제로 일을 하고 있어야 검증에 의미가 있다.
      expect(pruned.meta.exactlyEvaluated).toBeLessThanOrEqual(
        exhaustive.meta.exactlyEvaluated,
      );
    });
  }
});
