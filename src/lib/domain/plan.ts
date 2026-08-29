import type { RouteProvider, StationProvider } from "@/lib/providers/types";
import {
  breakEvenDetourKm,
  effectivePricePerLiter,
  evaluateOption,
  litersRequiredForTrip,
  median,
  type CostContext,
} from "./cost";
import { cumulativeDistances, projectOntoPolyline } from "./geo";
import type {
  Preferences,
  RankedOption,
  RefuelPlan,
  Route,
  Station,
  Vehicle,
  Verdict,
} from "./types";

/**
 * 정확한 우회 계산(경유지 길찾기)을 수행할 후보 수의 상한.
 * 카카오 다중 경유지 길찾기는 1일 5,000건이므로 사용자 한 명이 수십 건을
 * 태우면 금방 쿼터가 마른다. 값싼 휴리스틱으로 먼저 줄이고 여기까지만 정확히 본다.
 */
const MAX_EXACT_DETOUR_CANDIDATES = 14;

/** 우회 주행 평균 속도 가정 (km/h). 손익분기 설명에 쓰인다. */
const DETOUR_SPEED_KMH = 28;

/** 비관 시나리오: 연비는 이만큼 나쁘고, 가격은 이만큼 오르고, 우회는 이만큼 길다. */
const PESSIMISTIC = {
  fuelEconomyFactor: 0.85,
  priceSurchargeKrwPerL: 25,
  detourFactor: 1.25,
};

export interface PlanInput {
  route: Route;
  vehicle: Vehicle;
  preferences: Preferences;
  departAt: Date;
}

export interface PlanProviders {
  stations: StationProvider;
  routes: RouteProvider;
}

function passesHardFilters(
  station: Station,
  vehicle: Vehicle,
  preferences: Preferences,
): string | null {
  if (station.prices[vehicle.fuelKind] === undefined) {
    return "해당 유종을 취급하지 않음";
  }
  if (preferences.selfServiceOnly && !station.isSelfService) {
    return "셀프 주유소만 보기 설정";
  }
  if (preferences.brands.length > 0 && !preferences.brands.includes(station.brand)) {
    return "선호 브랜드 아님";
  }
  if (preferences.avoidHighwayExit && station.accessHint?.requiresHighwayExit) {
    return "고속도로 진출이 필요해 제외됨";
  }
  return null;
}

export async function buildRefuelPlan(
  input: PlanInput,
  providers: PlanProviders,
): Promise<RefuelPlan> {
  const { route, vehicle, preferences, departAt } = input;
  const cum = cumulativeDistances(route.polyline);

  const corridorRadiusM = Math.min(
    5000,
    Math.max(1200, (preferences.maxDetourKm * 1000) / 2),
  );

  const raw = await providers.stations.findAlongRoute(route, {
    fuelKind: vehicle.fuelKind,
    corridorRadiusM,
  });

  const excluded: { station: Station; reason: string }[] = [];
  const surviving: { station: Station; offsetM: number; alongM: number }[] = [];

  for (const station of raw) {
    const hardFail = passesHardFilters(station, vehicle, preferences);
    if (hardFail) {
      excluded.push({ station, reason: hardFail });
      continue;
    }
    const proj = projectOntoPolyline(station, route.polyline, cum);
    if (proj.offsetM > corridorRadiusM) {
      excluded.push({ station, reason: "경로에서 너무 멀어 제외됨" });
      continue;
    }
    // 현재 연료로 진입 지점까지도 못 가는 곳은 후보가 아니다.
    // 이걸 놓치면 앱이 사용자를 길에 세우게 된다.
    const fuelToReachL = proj.alongM / 1000 / vehicle.kmPerLiter;
    if (fuelToReachL > vehicle.currentFuelL) {
      excluded.push({ station, reason: "현재 연료로 도달 불가" });
      continue;
    }
    surviving.push({ station, offsetM: proj.offsetM, alongM: proj.alongM });
  }

  // 경로 주변 시세. 남는 연료의 가치와 부족분 조달 비용을 여기에 맞춘다.
  const referencePriceKrwPerL =
    median(
      surviving.map((s) =>
        effectivePricePerLiter(s.station.prices[vehicle.fuelKind]!, preferences),
      ),
    ) || effectivePricePerLiter(1700, preferences);

  const litersRequiredWithoutDetour = litersRequiredForTrip(
    vehicle,
    route.distanceM,
  );
  const canReachWithoutRefueling = litersRequiredWithoutDetour <= 0;

  const estimatedLiters = Math.max(
    5,
    Math.min(
      vehicle.tankCapacityL,
      litersRequiredWithoutDetour > 0
        ? litersRequiredWithoutDetour
        : vehicle.tankCapacityL * 0.5,
    ),
  );

  // 값싼 휴리스틱으로 순위를 매겨 상위 N개만 정확히 계산한다.
  // 왕복 우회를 가정한 연료비 + 시간비용을 리터당 가격에 얹은 근사치.
  const scored = surviving
    .map((s) => {
      const price = effectivePricePerLiter(
        s.station.prices[vehicle.fuelKind]!,
        preferences,
      );
      const roughDetourKm = (s.offsetM * 2) / 1000;
      const roughCost =
        price * estimatedLiters +
        (price / vehicle.kmPerLiter) * roughDetourKm +
        preferences.timeValueKrwPerMin * (roughDetourKm / DETOUR_SPEED_KMH) * 60;
      return { ...s, roughCost };
    })
    .sort((a, b) => a.roughCost - b.roughCost);

  const shortlist = scored.slice(0, MAX_EXACT_DETOUR_CANDIDATES);
  for (const dropped of scored.slice(MAX_EXACT_DETOUR_CANDIDATES)) {
    excluded.push({
      station: dropped.station,
      reason: "가격·우회 근사치 기준 하위권",
    });
  }

  const detours = await providers.routes.computeDetours(
    route,
    shortlist.map((s) => s.station),
  );

  const ctx: CostContext = {
    vehicle,
    preferences,
    route,
    referencePriceKrwPerL,
    departAt,
  };

  const evaluated = [];
  for (const { station } of shortlist) {
    const detour = detours.get(station.id);
    if (!detour) continue;

    if (detour.extraDistanceM / 1000 > preferences.maxDetourKm) {
      excluded.push({
        station,
        reason: `우회 ${(detour.extraDistanceM / 1000).toFixed(1)}km가 허용치 초과`,
      });
      continue;
    }
    if (detour.extraDurationS / 60 > preferences.maxDetourMin) {
      excluded.push({
        station,
        reason: `우회 ${Math.round(detour.extraDurationS / 60)}분이 허용치 초과`,
      });
      continue;
    }

    const option = evaluateOption(station, detour, ctx);
    if (!option) continue;
    if (!option.reachable) {
      excluded.push({ station, reason: "현재 연료로 도달 불가" });
      continue;
    }
    if (option.warnings.some((w) => w.code === "closed-on-arrival")) {
      excluded.push({ station, reason: "도착 예상 시각에 영업 종료" });
      continue;
    }
    evaluated.push(option);
  }

  evaluated.sort((a, b) => a.normalizedCostKrw - b.normalizedCostKrw);

  // 기준선: "그냥 지나가다 제일 가까운 데서 넣기". 이 앱을 쓰지 않는 운전자의 행동.
  const baselineOption = [...evaluated].sort(
    (a, b) =>
      a.detour.extraDistanceM - b.detour.extraDistanceM ||
      a.effectivePriceKrwPerL - b.effectivePriceKrwPerL,
  )[0];

  const pessimisticCtx: CostContext = {
    ...ctx,
    vehicle: {
      ...vehicle,
      kmPerLiter: vehicle.kmPerLiter * PESSIMISTIC.fuelEconomyFactor,
    },
  };

  const baselinePessimisticCost = baselineOption
    ? (evaluateOption(baselineOption.station, baselineOption.detour, pessimisticCtx)
        ?.normalizedCostKrw ?? 0)
    : 0;

  const ranked: RankedOption[] = evaluated.map((option, index) => {
    const savingKrw = baselineOption
      ? baselineOption.normalizedCostKrw - option.normalizedCostKrw
      : 0;

    const pessimisticStation: Station = {
      ...option.station,
      prices: {
        ...option.station.prices,
        [vehicle.fuelKind]:
          option.listPriceKrwPerL + PESSIMISTIC.priceSurchargeKrwPerL,
      },
    };
    const pessimisticDetour = {
      ...option.detour,
      extraDistanceM: option.detour.extraDistanceM * PESSIMISTIC.detourFactor,
      extraDurationS: option.detour.extraDurationS * PESSIMISTIC.detourFactor,
    };
    const pessimisticSelf = evaluateOption(
      pessimisticStation,
      pessimisticDetour,
      pessimisticCtx,
    );
    const savingPessimisticKrw =
      pessimisticSelf && baselineOption
        ? baselinePessimisticCost - pessimisticSelf.normalizedCostKrw
        : 0;

    const gainPerLiterKrw = baselineOption
      ? baselineOption.effectivePriceKrwPerL - option.effectivePriceKrwPerL
      : 0;

    return {
      ...option,
      savingKrw,
      savingPessimisticKrw,
      breakEvenDetourKm: breakEvenDetourKm({
        gainPerLiterKrw,
        litersToBuy: option.litersToBuy,
        effectivePriceKrwPerL: option.effectivePriceKrwPerL,
        kmPerLiter: vehicle.kmPerLiter,
        timeValueKrwPerMin: preferences.timeValueKrwPerMin,
        detourSpeedKmh: DETOUR_SPEED_KMH,
      }),
      rank: index + 1,
    };
  });

  const best = ranked[0] ?? null;
  const baseline = baselineOption
    ? (ranked.find((r) => r.station.id === baselineOption.station.id) ?? null)
    : null;

  const { verdict, headline } = decide({
    best,
    baseline,
    preferences,
    canReachWithoutRefueling,
    candidateCount: ranked.length,
  });

  return {
    route,
    vehicle,
    preferences,
    litersRequiredWithoutDetour,
    canReachWithoutRefueling,
    referencePriceKrwPerL,
    baseline,
    best,
    options: ranked,
    excluded,
    verdict,
    headline,
    meta: {
      stationProvider: providers.stations.label,
      routeProvider: providers.routes.label,
      candidateCount: raw.length,
      detourSource: providers.routes.isLive ? "routing-api" : "geometric-estimate",
      computedAt: new Date().toISOString(),
    },
  };
}

function decide(args: {
  best: RankedOption | null;
  baseline: RankedOption | null;
  preferences: Preferences;
  canReachWithoutRefueling: boolean;
  candidateCount: number;
}): { verdict: Verdict; headline: string } {
  const { best, baseline, preferences, canReachWithoutRefueling, candidateCount } =
    args;

  if (candidateCount === 0 || !best || !baseline) {
    return {
      verdict: "no-candidates",
      headline:
        "조건에 맞는 주유소를 경로 주변에서 찾지 못했습니다. 우회 허용치나 브랜드 조건을 넓혀 보세요.",
    };
  }

  if (canReachWithoutRefueling && preferences.fillPolicy.mode === "toDestination") {
    return {
      verdict: "no-refuel-needed",
      headline:
        "지금 연료로 목적지까지 예비량을 남기고 도착할 수 있습니다. 이번 구간에서는 주유하지 않아도 됩니다.",
    };
  }

  if (best.station.id === baseline.station.id) {
    return {
      verdict: "stay-on-route",
      headline: `경로에서 가장 가까운 ${best.station.name}가 이미 최선입니다. 더 싼 곳을 찾아 우회할 이유가 없습니다.`,
    };
  }

  if (
    best.savingKrw < preferences.minMeaningfulSavingKrw ||
    best.savingPessimisticKrw <= 0
  ) {
    return {
      verdict: "marginal",
      headline: `${best.station.name}가 계산상 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 저렴하지만, 연비·가격 오차를 감안하면 이득이 사라질 수 있습니다. 가까운 곳에서 넣는 편이 안전합니다.`,
    };
  }

  return {
    verdict: "detour-worth-it",
    headline: `${best.station.name}로 ${(best.detour.extraDistanceM / 1000).toFixed(1)}km 우회하면 우회 연료비와 시간까지 계산해도 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 절약됩니다.`,
  };
}
