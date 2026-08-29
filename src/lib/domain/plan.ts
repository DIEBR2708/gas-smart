import type { RouteProvider, StationProvider } from "@/lib/providers/types";
import {
  breakEvenDetourKm,
  effectivePricePerLiter,
  evaluateOption,
  litersRequiredForTrip,
  median,
  type CostContext,
} from "./cost";
import { planCorridorSearch } from "./corridor";
import {
  cumulativeDistances,
  projectOntoPolyline,
  type Projection,
} from "./geo";
import { displayStationName } from "@/lib/format";
import { planItinerary } from "./itinerary";
import { congestionFactorAt } from "./traffic";
import type {
  Detour,
  Preferences,
  RankedOption,
  RefuelOption,
  RefuelPlan,
  Route,
  Station,
  StationReport,
  Vehicle,
  Verdict,
} from "./types";

/**
 * 정확한 우회 계산(경유지 길찾기)을 수행할 후보 수의 상한.
 *
 * 카카오 다중 경유지 길찾기는 1일 5,000건이므로 사용자 한 명이 수십 건을
 * 태우면 금방 쿼터가 마른다. 다만 이 상한에 걸려 계산을 멈추면 더 나은
 * 후보를 못 본 것일 수 있으므로 `optimalityGuaranteed`로 표시한다.
 */
const MAX_EXACT_DETOUR_CANDIDATES = 24;

/**
 * 하한값 가지치기가 이 수보다 적게 남기지 않도록 하는 하한.
 *
 * 가지치기만 두면 최적안 하나와 그 근처만 남아 후보 목록이 두세 개로 줄어든다.
 * 최적안을 찾는 데는 충분하지만, 사용자가 "왜 이게 최선인지"를 비교해 볼
 * 재료가 사라진다. 예측 가능한 만큼의 호출을 더 써서 목록을 유지한다.
 */
const MIN_EXACT_DETOUR_CANDIDATES = 10;

/** 경유지 길찾기를 한 번에 묶어 보내는 크기 */
const DETOUR_BATCH_SIZE = 6;

/** 회랑 반폭의 하한 (m). 우회 허용치가 아주 작아도 이 정도는 본다. */
const MIN_CORRIDOR_HALF_WIDTH_M = 1200;

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
  reports?: StationReport[];
}

export interface PlanProviders {
  stations: StationProvider;
  routes: RouteProvider;
}

/**
 * 가지치기를 끄고 전수 계산한 결과와 비교하기 위한 옵션.
 * 하한값 가지치기가 최적안을 버리지 않는지 테스트에서 검증하는 데 쓴다.
 */
export interface PlanOptions {
  maxExactCandidates?: number;
  disablePruning?: boolean;
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
  options: PlanOptions = {},
): Promise<RefuelPlan> {
  const maxExactCandidates =
    options.maxExactCandidates ?? MAX_EXACT_DETOUR_CANDIDATES;
  const { route, vehicle, preferences, departAt, reports = [] } = input;
  const cum = cumulativeDistances(route.polyline);
  const congestionFactor = route.durationIncludesTraffic
    ? 1
    : congestionFactorAt(departAt, Boolean(route.summary?.includes("고속")));

  // 우회를 왕복으로 보면 경로에서 x만큼 떨어진 주유소의 최소 우회는 2x다.
  // 따라서 허용 우회거리의 절반이 조회해야 할 회랑 반폭이다.
  const requestedHalfWidthM = Math.max(
    MIN_CORRIDOR_HALF_WIDTH_M,
    (preferences.maxDetourKm * 1000) / 2,
  );
  const corridor = planCorridorSearch(route.polyline, requestedHalfWidthM);

  const raw = await providers.stations.findAlongRoute(route, {
    fuelKind: vehicle.fuelKind,
    corridorHalfWidthM: corridor.coveredHalfWidthM,
  });

  const excluded: { station: Station; reason: string }[] = [];
  const surviving: {
    station: Station;
    proj: Projection;
  }[] = [];

  for (const station of raw) {
    const hardFail = passesHardFilters(station, vehicle, preferences);
    if (hardFail) {
      excluded.push({ station, reason: hardFail });
      continue;
    }
    const report = reports.find((item) => item.stationId === station.id);
    if (report?.kind === "gone") {
      excluded.push({ station, reason: "폐업·이전으로 제보됨" });
      continue;
    }
    if (report?.kind === "closed") {
      excluded.push({ station, reason: "영업하지 않는다고 제보됨" });
      continue;
    }
    const proj = projectOntoPolyline(station, route.polyline, cum);
    if (proj.offsetM > corridor.coveredHalfWidthM) {
      excluded.push({
        station,
        reason: `경로에서 ${(proj.offsetM / 1000).toFixed(1)}km 떨어져 회랑 밖`,
      });
      continue;
    }
    // 현재 연료로 진입 지점까지도 못 가는 곳은 후보가 아니다.
    // 이걸 놓치면 앱이 사용자를 길에 세우게 된다.
    const fuelToReachL = proj.alongM / 1000 / vehicle.kmPerLiter;
    if (fuelToReachL > vehicle.currentFuelL) {
      excluded.push({ station, reason: "현재 연료로 도달 불가" });
      continue;
    }
    surviving.push({ station, proj });
  }

  // 경로 주변 시세. 남는 연료의 가치와 부족분 조달 비용을 여기에 맞춘다.
  const referencePriceKrwPerL =
    median(
      surviving.map((s) =>
        effectivePricePerLiter(
          s.station.prices[vehicle.fuelKind]!,
          preferences,
          s.station.brand,
        ),
      ),
    ) || effectivePricePerLiter(1700, preferences);

  const litersRequiredWithoutDetour = litersRequiredForTrip(
    vehicle,
    route.distanceM,
  );
  const canReachWithoutRefueling = litersRequiredWithoutDetour <= 0;

  const ctx: CostContext = {
    vehicle,
    preferences,
    route,
    referencePriceKrwPerL,
    departAt,
    congestionFactor,
    reports,
  };

  /*
    후보 줄이기: 휴리스틱 대신 하한값을 쓴다.

    경로에서 x만큼 떨어진 주유소를 들르는 최소 우회는 왕복 2x이고, 추가 시간과
    통행료는 아무리 적어도 0 이상이다. 그 최소 조건으로 같은 비용 함수를
    돌리면 그 주유소가 도달할 수 있는 가장 낮은 비용, 즉 하한이 나온다.
    비용 함수는 우회 거리·시간·통행료에 대해 단조 증가하므로 이 값은 실제
    비용을 절대 넘지 않는다.

    하한값이 이미 확정된 최적안보다 높으면 그 후보는 계산해 볼 필요가 없다.
    "근사치 기준 하위권이라 버렸다"가 아니라 "이길 수 없음을 증명했다"가 된다.
  */
  const bounded = surviving
    .map((s) => {
      const minimalDetour: Detour = {
        extraDistanceM: s.proj.offsetM * 2,
        extraDurationS: 0,
        extraTollKrw: 0,
        alongRouteM: s.proj.alongM,
        offRouteM: s.proj.offsetM,
        joinPoint: s.proj.point,
        source: "geometric-estimate",
      };
      const lowerBound = evaluateOption(s.station, minimalDetour, ctx);
      return {
        station: s.station,
        lowerBoundKrw: lowerBound
          ? lowerBound.normalizedCostKrw
          : Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => a.lowerBoundKrw - b.lowerBoundKrw);

  /*
    경로에서 가장 가까운 주유소는 하한값이 높아도 반드시 정밀 계산한다.

    이 주유소가 "이 앱을 쓰지 않는 운전자가 그냥 들를 곳", 즉 절감액의
    기준선이다. 가지치기에 걸려 계산되지 않으면 비교 대상이 사라지고
    절감액이 0으로 표시된다.
  */
  const nearest = surviving.reduce<(typeof surviving)[number] | null>(
    (best, candidate) =>
      !best || candidate.proj.offsetM < best.proj.offsetM ? candidate : best,
    null,
  );
  if (nearest) {
    const index = bounded.findIndex((b) => b.station.id === nearest.station.id);
    if (index > 0) {
      const [pulled] = bounded.splice(index, 1);
      bounded.unshift(pulled);
    }
  }

  const evaluated: RefuelOption[] = [];
  let bestCostSoFar = Number.POSITIVE_INFINITY;
  let cursor = 0;
  let exactlyEvaluated = 0;
  let stoppedByQuota = false;

  while (cursor < bounded.length) {
    if (exactlyEvaluated >= maxExactCandidates) {
      stoppedByQuota = true;
      break;
    }
    // 하한이 최적안 이상이면 이후 후보는 정렬상 모두 이길 수 없다.
    // 다만 비교할 목록을 남기기 위해 최소 개수는 채운다.
    if (
      !options.disablePruning &&
      exactlyEvaluated >= MIN_EXACT_DETOUR_CANDIDATES &&
      bounded[cursor].lowerBoundKrw >= bestCostSoFar
    ) {
      break;
    }

    const batch = bounded.slice(
      cursor,
      Math.min(
        cursor + DETOUR_BATCH_SIZE,
        cursor + (maxExactCandidates - exactlyEvaluated),
      ),
    );
    cursor += batch.length;
    exactlyEvaluated += batch.length;

    const detours = await providers.routes.computeDetours(
      route,
      batch.map((b) => b.station),
    );

    for (const { station } of batch) {
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
      bestCostSoFar = Math.min(bestCostSoFar, option.normalizedCostKrw);
    }
  }

  for (const skipped of bounded.slice(cursor)) {
    excluded.push({
      station: skipped.station,
      reason: stoppedByQuota
        ? "정밀 계산 한도에 걸려 확인하지 못함"
        : "최소 우회로도 최적안보다 비싸 계산 불필요",
    });
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
      stockUpValueKrw:
        Math.max(0, referencePriceKrwPerL - option.effectivePriceKrwPerL) *
        option.surplusFuelL,
      rank: index + 1,
    };
  });

  const best = ranked[0] ?? null;
  const baseline = baselineOption
    ? (ranked.find((r) => r.station.id === baselineOption.station.id) ?? null)
    : null;

  const itinerary = planItinerary({
    route,
    vehicle,
    options: ranked,
    fillFullAtLast: preferences.fillPolicy.mode === "full",
  });

  const { verdict, headline } = decide({
    best,
    baseline,
    preferences,
    canReachWithoutRefueling,
    candidateCount: ranked.length,
    itineraryCount: itinerary.length,
    itinerary,
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
    itinerary,
    meta: {
      stationProvider: providers.stations.label,
      routeProvider: providers.routes.label,
      detourSource: providers.routes.isLive ? "routing-api" : "geometric-estimate",
      computedAt: new Date().toISOString(),
      candidateCount: raw.length,
      exactlyEvaluated,
      corridorHalfWidthM: corridor.coveredHalfWidthM,
      requestedHalfWidthM,
      corridorTruncated: corridor.truncated,
      searchRadiusM: corridor.searchRadiusM,
      searchCallCount: corridor.callCount,
      optimalityGuaranteed: !stoppedByQuota,
    },
  };
}

function decide(args: {
  best: RankedOption | null;
  baseline: RankedOption | null;
  preferences: Preferences;
  canReachWithoutRefueling: boolean;
  candidateCount: number;
  itineraryCount: number;
  itinerary: RefuelPlan["itinerary"];
}): { verdict: Verdict; headline: string } {
  const {
    best,
    baseline,
    preferences,
    canReachWithoutRefueling,
    candidateCount,
    itineraryCount,
    itinerary,
  } = args;

  if (itineraryCount >= 2) {
    const names = itinerary
      .map((stop) => displayStationName(stop.option.station.name))
      .join(" → ");
    return {
      verdict: "multi-stop",
      headline: `탱크 용량만으로는 한 번에 목적지 예비량을 채울 수 없습니다. ${itineraryCount}곳(${names}) 순서로 나눠 넣으면 중간에 서지 않고 도착할 수 있습니다.`,
    };
  }

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
      headline: `경로에서 가장 가까운 ${displayStationName(best.station.name)}가 이미 최선입니다. 더 싼 곳을 찾아 우회할 이유가 없습니다.`,
    };
  }

  if (
    best.savingKrw < preferences.minMeaningfulSavingKrw ||
    best.savingPessimisticKrw <= 0
  ) {
    return {
      verdict: "marginal",
      headline: `${displayStationName(best.station.name)}가 계산상 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 저렴하지만, 연비·가격 오차를 감안하면 이득이 사라질 수 있습니다. 가까운 곳에서 넣는 편이 안전합니다.`,
    };
  }

  const stockUpNote =
    best.stockUpValueKrw > 500
      ? ` 이 가운데 ${Math.round(best.stockUpValueKrw).toLocaleString("ko-KR")}원은 이번 여행에 쓰지 않고 탱크에 채워둔 싼 연료의 값입니다.`
      : "";

  return {
    verdict: "detour-worth-it",
    headline: `${displayStationName(best.station.name)}로 ${(best.detour.extraDistanceM / 1000).toFixed(1)}km 우회하면 우회 연료비와 시간까지 계산해도 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 절약됩니다.${stockUpNote}`,
  };
}
