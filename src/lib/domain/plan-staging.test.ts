import { describe, expect, it } from "vitest";
import { SAMPLE_ROUTES } from "@/lib/data/sample-routes";
import { MockRouteProvider } from "@/lib/providers/mock/route-provider";
import { MockStationProvider } from "@/lib/providers/mock/station-provider";
import type { RouteProvider } from "@/lib/providers/types";
import type { Detour, Route, Station } from "./types";
import { DEFAULT_PREFERENCES, DEFAULT_VEHICLE } from "./fixtures";
import { buildRefuelPlan, type PlanOptions } from "./plan";

const DEPART_AT = new Date("2026-08-29T09:00:00+09:00");
const route = SAMPLE_ROUTES[0];

/** 길찾기를 몇 번, 어떤 순서로 쳤는지 기록하는 프로바이더 */
class RecordingRouteProvider implements RouteProvider {
  readonly id = "recording";
  readonly label = "기록용 길찾기";
  readonly isLive = true;

  readonly batches: string[][] = [];
  private readonly inner = new MockRouteProvider();

  findRoute = this.inner.findRoute.bind(this.inner);
  detourShape = this.inner.detourShape.bind(this.inner);

  async computeDetours(
    r: Route,
    stations: Station[],
  ): Promise<Map<string, Detour>> {
    this.batches.push(stations.map((s) => s.id));
    return this.inner.computeDetours(r, stations);
  }
}

function makeProviders() {
  const routes = new RecordingRouteProvider();
  return { providers: { stations: new MockStationProvider(), routes }, routes };
}

function plan(providers: ReturnType<typeof makeProviders>["providers"], options: PlanOptions = {}) {
  return buildRefuelPlan(
    {
      route,
      vehicle: DEFAULT_VEHICLE,
      preferences: DEFAULT_PREFERENCES,
      departAt: DEPART_AT,
    },
    providers,
    options,
  );
}

describe("어림 계산 먼저, 정밀 계산 나중", () => {
  it("어림 모드는 길찾기를 한 건도 치지 않는다", async () => {
    const { providers, routes } = makeProviders();
    const draft = await plan(providers, { detourMode: "estimate" });

    expect(routes.batches).toHaveLength(0);
    expect(draft.options.length).toBeGreaterThan(0);
    expect(draft.meta.provisional).toBe(true);
    expect(draft.meta.detourSource).toBe("geometric-estimate");
  });

  it("어림 우회에도 시간이 붙는다", async () => {
    const { providers } = makeProviders();
    const draft = await plan(providers, { detourMode: "estimate" });

    expect(draft.options.length).toBeGreaterThan(0);
    for (const option of draft.options) {
      // 최소 왕복 거리는 넘어야 한다. 유턴 보정이 여기에 더 얹힐 수는 있다.
      expect(option.detour.extraDistanceM).toBeGreaterThanOrEqual(
        option.detour.offRouteM * 2 - 1e-6,
      );
      // 시간을 0으로 두면 순위가 거리만 보고 뒤틀려 정밀 계산과 크게 어긋난다.
      if (option.detour.extraDistanceM > 0) {
        expect(option.detour.extraDurationS).toBeGreaterThan(0);
      }
    }
  });

  it("정밀 모드는 길찾기를 치고 잠정 표시를 지운다", async () => {
    const { providers, routes } = makeProviders();
    const exact = await plan(providers);

    expect(routes.batches).toHaveLength(1);
    expect(exact.meta.provisional).toBe(false);
    expect(exact.meta.detourSource).toBe("routing-api");
  });

  it("두 단계가 같은 수의 후보를 정밀 대상으로 잡는다", async () => {
    const { providers: a } = makeProviders();
    const { providers: b } = makeProviders();
    const draft = await plan(a, { detourMode: "estimate" });
    const exact = await plan(b);

    expect(draft.meta.exactlyEvaluated).toBe(exact.meta.exactlyEvaluated);
  });

  it("정밀 목록은 어림 목록에서 늘어나지 않는다", async () => {
    const { providers: a } = makeProviders();
    const { providers: b } = makeProviders();
    const tight = { preferences: { ...DEFAULT_PREFERENCES, maxDetourKm: 1.5 } };
    const draft = await buildRefuelPlan(
      { route, vehicle: DEFAULT_VEHICLE, departAt: DEPART_AT, ...tight },
      a,
      { detourMode: "estimate" },
    );
    const exact = await buildRefuelPlan(
      { route, vehicle: DEFAULT_VEHICLE, departAt: DEPART_AT, ...tight },
      b,
    );

    /*
      어림값으로 걸러내면 목록이 줄었다가 다시 늘어난다. 어느 쪽이 맞는지
      모르는 채로 화면이 두 번 흔들리는 것이 가장 나쁘다.
    */
    const drafted = new Set(draft.options.map((o) => o.station.id));
    for (const option of exact.options) {
      expect(drafted).toContain(option.station.id);
    }
  });

  it("길찾기는 한 묶음으로 나가 왕복 대기가 한 번이다", async () => {
    const { providers, routes } = makeProviders();
    const exact = await plan(providers);

    expect(routes.batches).toHaveLength(1);
    expect(routes.batches[0].length).toBeLessThanOrEqual(12);
    expect(exact.meta.exactlyEvaluated).toBeLessThanOrEqual(12);
  });
});

describe("고른 주유소를 먼저 계산한다", () => {
  it("우선 주유소가 첫 묶음 맨 앞에 온다", async () => {
    const { providers: first, routes: firstRoutes } = makeProviders();
    await plan(first);
    const lastInBatch = firstRoutes.batches[0].at(-1)!;

    const { providers, routes } = makeProviders();
    await plan(providers, { priorityStationId: lastInBatch });

    expect(routes.batches[0][0]).toBe(lastInBatch);
  });

  it("상한 밖에 있던 주유소도 우선 지정하면 정밀 계산된다", async () => {
    const { providers: first, routes: firstRoutes } = makeProviders();
    await plan(first, { maxExactCandidates: 3 });
    const { providers: wide, routes: wideRoutes } = makeProviders();
    await plan(wide);

    const skipped = wideRoutes.batches[0].find(
      (id) => !firstRoutes.batches[0].includes(id),
    );
    expect(skipped).toBeDefined();

    const { providers, routes } = makeProviders();
    await plan(providers, {
      maxExactCandidates: 3,
      priorityStationId: skipped,
    });

    expect(routes.batches[0]).toContain(skipped);
  });
});

describe("쓸모없어진 계산은 끊는다", () => {
  it("이미 취소된 신호면 길찾기를 치지 않는다", async () => {
    const { providers, routes } = makeProviders();
    const controller = new AbortController();
    controller.abort();

    await expect(plan(providers, { signal: controller.signal })).rejects.toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
    expect(routes.batches).toHaveLength(0);
  });

  it("취소하지 않으면 그대로 끝까지 계산한다", async () => {
    const { providers, routes } = makeProviders();
    const controller = new AbortController();

    const result = await plan(providers, { signal: controller.signal });
    expect(routes.batches).toHaveLength(1);
    expect(result.options.length).toBeGreaterThan(0);
  });
});
