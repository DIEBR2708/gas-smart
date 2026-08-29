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
    expect(best.stockUpValueKrw).toBeGreaterThan(0);
    expect(best.stockUpValueKrw).toBeLessThanOrEqual(best.savingKrw + 1e-6);
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

  it("정확 계산 대상 후보 수에 상한이 있다", async () => {
    const result = await plan({ preferences: { maxDetourKm: 20, maxDetourMin: 90 } });
    expect(result.options.length).toBeLessThanOrEqual(14);
    expect(result.meta.candidateCount).toBeGreaterThan(result.options.length);
  });
});
