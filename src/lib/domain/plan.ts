import type { RouteProvider, StationProvider } from "@/lib/providers/types";
import {
  breakEvenDetourKm,
  destinationHoldL,
  effectivePricePerLiter,
  evaluateOption,
  litersRequiredForTrip,
  minArrivalFuelL,
  median,
  type CostContext,
} from "./cost";
import { rejectIllegalUturn, withAccessHint } from "./access";
import { STATION_SEARCH_MAX_RADIUS_M, planCorridorSearch } from "./corridor";
import { nearbyGeometricDetour } from "./nearby";
import {
  cumulativeDistances,
  projectOntoPolyline,
  type Projection,
} from "./geo";
import { stationHeading } from "@/lib/format";
import { abortError } from "@/lib/http";
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
 *
 * 경유 길찾기는 12건까지 한꺼번에 나가므로, 여기까지가 왕복 한 번으로 끝나는
 * 크기다. 이보다 늘리면 호출이 두 바퀴가 되어 대기 시간이 그대로 두 배가 된다.
 */
const MAX_EXACT_DETOUR_CANDIDATES = 12;

/**
 * 하한값 가지치기가 이 수보다 적게 남기지 않도록 하는 하한.
 *
 * 가지치기만 두면 최적안 하나와 그 근처만 남아 후보 목록이 두세 개로 줄어든다.
 * 최적안을 찾는 데는 충분하지만, 사용자가 "왜 이게 최선인지"를 비교해 볼
 * 재료가 사라진다. 예측 가능한 만큼의 호출을 더 써서 목록을 유지한다.
 */
const MIN_EXACT_DETOUR_CANDIDATES = 10;

/** 경유지 길찾기를 한 번에 묶어 보내는 크기 */
const DETOUR_BATCH_SIZE = 12;

/** 회랑 반폭의 하한 (m). 우회 허용치가 아주 작아도 이 정도는 본다. */
const MIN_CORRIDOR_HALF_WIDTH_M = 1200;

/**
 * 회랑 반폭의 상한 (m).
 *
 * 필요한 샘플 간격은 sqrt(r^2 - w^2)라 반폭이 반경(5km)에 가까워질수록
 * 0으로 무너진다. 반폭 4km면 한 경로에 조회가 30회를 넘고 4.5km면 60회다.
 *
 * 그렇게까지 넓힐 값어치가 없다. 중심선에서 2.5km면 왕복 5km 우회이고,
 * 연료·시간을 합쳐 2천원 넘게 든다. 40L를 넣어 그걸 뒤집으려면 리터당
 * 60원 넘게 싸야 한다. 그보다 먼 주유소는 다른 검색에서 이미 받아 둔
 * 목록에 있으면 그대로 후보로 올라간다.
 */
const MAX_CORRIDOR_HALF_WIDTH_M = 2500;

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
  /** 목적지 없이 지금 자리 주변만 검색 */
  nearby?: boolean;
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
  /**
   * `estimate`면 경유 길찾기를 한 건도 치지 않고 직선 왕복으로만 우회를 잰다.
   * 본선 경로가 나온 직후 순위를 먼저 보여주기 위한 1차 계산에 쓴다.
   */
  detourMode?: "estimate" | "exact";
  /**
   * 사용자가 이미 고른 주유소. 정밀 계산 순서의 맨 앞으로 당긴다.
   * 상한에 걸려 잘리더라도 이 주유소만큼은 실제 경유 경로가 나온다.
   */
  priorityStationId?: string;
  /** 출발지·도착지가 바뀌어 이 계산이 쓸모없어지면 끊는다. */
  signal?: AbortSignal;
}

/**
 * 길찾기를 치지 않고 잰 우회. 경로에서 x 떨어진 곳은 왕복 2x로 보고,
 * 시간은 우회 평균 속도로 환산한다.
 *
 * 하한값 계산과 달리 시간을 0으로 두지 않는다. 하한은 "이보다 나쁠 수 없다"를
 * 증명해야 하지만, 이쪽은 정밀 계산이 끝나기 전에 보여줄 어림값이라 실제에
 * 가까운 편이 낫다.
 */
function estimatedDetour(proj: Projection): Detour {
  const extraDistanceM = proj.offsetM * 2;
  return {
    extraDistanceM,
    extraDurationS: (extraDistanceM / 1000 / DETOUR_SPEED_KMH) * 3600,
    extraTollKrw: 0,
    alongRouteM: proj.alongM,
    offRouteM: proj.offsetM,
    joinPoint: proj.point,
    source: "geometric-estimate",
  };
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
  const estimateOnly = options.detourMode === "estimate";
  const { route, vehicle, preferences, departAt, reports = [], nearby = false } =
    input;
  const cum = cumulativeDistances(route.polyline);
  const congestionFactor = route.durationIncludesTraffic
    ? 1
    : congestionFactorAt(departAt, Boolean(route.summary?.includes("고속")));

  // 우회를 왕복으로 보면 경로에서 x만큼 떨어진 주유소의 최소 우회는 2x다.
  // 따라서 허용 우회거리의 절반이 조회해야 할 회랑 반폭이다.
  // 이 자리 주변은 왕복이 아니라 여기부터의 거리이므로 허용치를 그대로 쓴다.
  const requestedHalfWidthM = nearby
    ? Math.min(
        STATION_SEARCH_MAX_RADIUS_M * 0.9,
        Math.max(MIN_CORRIDOR_HALF_WIDTH_M, preferences.maxDetourKm * 1000),
      )
    : Math.max(MIN_CORRIDOR_HALF_WIDTH_M, (preferences.maxDetourKm * 1000) / 2);
  // 실제로 조회할 폭은 상한을 건다. 요청 폭은 그대로 두고 잘렸다고 알린다.
  const searchHalfWidthM = nearby
    ? requestedHalfWidthM
    : Math.min(MAX_CORRIDOR_HALF_WIDTH_M, requestedHalfWidthM);
  const corridor = planCorridorSearch(route.polyline, searchHalfWidthM);
  const corridorTruncated =
    corridor.truncated || searchHalfWidthM < requestedHalfWidthM;

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
    // 예비량 아래로 떨어져 도착하는 곳은 후보가 아니다.
    // 이미 예비량 이하면 0L까지만 허용한다.
    const driveKm = nearby
      ? proj.offsetM / 1000
      : proj.alongM / 1000;
    const fuelLeftL = vehicle.currentFuelL - driveKm / vehicle.kmPerLiter;
    const arrivalFloorL = minArrivalFuelL(vehicle);
    if (fuelLeftL + 1e-9 < arrivalFloorL) {
      excluded.push({
        station,
        reason:
          arrivalFloorL > 0
            ? `예비 ${vehicle.reserveL}L 아래로 내려가 제외`
            : "현재 연료로 도달 불가",
      });
      continue;
    }
    const hinted = withAccessHint(station, proj, route);
    if (
      preferences.avoidHighwayExit &&
      hinted.accessHint?.requiresHighwayExit
    ) {
      excluded.push({ station: hinted, reason: "고속도로 진출이 필요해 제외됨" });
      continue;
    }
    surviving.push({ station: hinted, proj });
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

  const nearbyFill =
    nearby && preferences.fillPolicy.mode === "toDestination"
      ? ({ mode: "full" } as const)
      : preferences.fillPolicy;
  const litersRequiredWithoutDetour = nearby
    ? Math.max(0, vehicle.tankCapacityL - vehicle.currentFuelL)
    : litersRequiredForTrip(vehicle, route.distanceM, preferences.fillPolicy);
  const canReachWithoutRefueling = nearby
    ? false
    : litersRequiredWithoutDetour <= 0;

  const ctx: CostContext = {
    vehicle,
    preferences: nearby
      ? { ...preferences, fillPolicy: nearbyFill }
      : preferences,
    route,
    referencePriceKrwPerL,
    departAt,
    congestionFactor,
    reports,
    nearby,
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
      const minimalDetour: Detour = nearby
        ? nearbyGeometricDetour(route.origin, s.station, s.proj)
        : {
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
        proj: s.proj,
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

  /*
    사용자가 이미 고른 주유소는 무조건 맨 앞이다.

    화면에서 한 곳을 누른 사람이 기다리는 것은 목록 전체의 순위가 아니라
    "거기 들렀다 가면 실제로 얼마나 돌아가는가" 하나뿐이다. 상한에 걸려
    잘리는 일이 없도록 첫 묶음에 넣는다.
  */
  if (options.priorityStationId) {
    const index = bounded.findIndex(
      (b) => b.station.id === options.priorityStationId,
    );
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
    if (options.signal?.aborted) throw abortError();

    /*
      하한이 최적안 이상이면 이후 후보는 정렬상 모두 이길 수 없다.
      다만 비교할 목록을 남기기 위해 최소 개수는 채운다.

      이 판정을 상한 검사보다 먼저 한다. 순서를 뒤집으면 "남은 후보가 이길 수
      없음을 이미 증명했는데 마침 상한에도 닿은" 경우를 쿼터 때문에 멈춘 것으로
      기록해, 최적임을 보장하지 못한다고 잘못 알린다.
    */
    if (
      !options.disablePruning &&
      exactlyEvaluated >= MIN_EXACT_DETOUR_CANDIDATES &&
      bounded[cursor].lowerBoundKrw >= bestCostSoFar
    ) {
      break;
    }
    if (exactlyEvaluated >= maxExactCandidates) {
      stoppedByQuota = true;
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

    const detours =
      nearby || estimateOnly
        ? new Map<string, Detour>()
        : await providers.routes.computeDetours(
            route,
            batch.map((b) => b.station),
            options.signal,
          );

    for (const { station, proj } of batch) {
      const rawDetour = nearby
        ? nearbyGeometricDetour(route.origin, station, proj)
        : estimateOnly
          ? estimatedDetour(proj)
          : detours.get(station.id);
      if (!rawDetour) continue;
      const detour = rejectIllegalUturn(rawDetour, proj, station, route);

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
        excluded.push({
          station,
          reason:
            option.fuelOnArrivalL >= 0
              ? `예비 ${vehicle.reserveL}L 아래로 내려가 제외`
              : "현재 연료로 도달 불가",
        });
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

  const itinerary = nearby
    ? []
    : planItinerary({
        route,
        vehicle,
        options: ranked,
        fillFullAtLast: preferences.fillPolicy.mode === "full",
        destinationHoldL: destinationHoldL(vehicle, preferences.fillPolicy),
      });

  const { verdict, headline } = decide({
    best,
    baseline,
    preferences,
    canReachWithoutRefueling,
    candidateCount: ranked.length,
    itineraryCount: itinerary.length,
    itinerary,
    nearby,
  });

  return {
    route,
    vehicle,
    preferences,
    nearby,
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
      detourSource:
        nearby || estimateOnly || !providers.routes.isLive
          ? "geometric-estimate"
          : "routing-api",
      provisional: estimateOnly,
      computedAt: new Date().toISOString(),
      candidateCount: raw.length,
      exactlyEvaluated,
      corridorHalfWidthM: corridor.coveredHalfWidthM,
      requestedHalfWidthM,
      corridorTruncated,
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
  nearby?: boolean;
}): { verdict: Verdict; headline: string } {
  const {
    best,
    baseline,
    preferences,
    canReachWithoutRefueling,
    candidateCount,
    itineraryCount,
    itinerary,
    nearby,
  } = args;

  if (itineraryCount >= 2) {
    const names = itinerary
      .map((stop) =>
        stationHeading(stop.option.station.name, stop.option.station.brand),
      )
      .join(" → ");
    return {
      verdict: "multi-stop",
      headline: `탱크 용량만으로는 한 번에 목적지 예비량을 채울 수 없습니다. ${itineraryCount}곳(${names}) 순서로 나눠 넣으면 중간에 서지 않고 도착할 수 있습니다.`,
    };
  }

  if (candidateCount === 0 || !best || !baseline) {
    return {
      verdict: "no-candidates",
      headline: nearby
        ? "이 자리 주변에서 조건에 맞는 주유소를 찾지 못했습니다. 얼마나 멀리 볼지나 브랜드 조건을 넓혀 보세요."
        : "조건에 맞는 주유소를 경로 주변에서 찾지 못했습니다. 우회 허용치나 브랜드 조건을 넓혀 보세요.",
    };
  }

  if (
    !nearby &&
    canReachWithoutRefueling &&
    preferences.fillPolicy.mode === "toDestination"
  ) {
    return {
      verdict: "no-refuel-needed",
      headline:
        "지금 연료로 목적지까지 예비량을 남기고 도착할 수 있습니다. 이번 구간에서는 주유하지 않아도 됩니다.",
    };
  }

  if (best.station.id === baseline.station.id) {
    return {
      verdict: "stay-on-route",
      headline: nearby
        ? `제일 가까운 ${stationHeading(best.station.name, best.station.brand)}가 이미 제일 쌉니다. 더 멀리 갈 이유가 없습니다.`
        : `경로에서 가장 가까운 ${stationHeading(best.station.name, best.station.brand)}가 이미 최선입니다. 더 싼 곳을 찾아 우회할 이유가 없습니다.`,
    };
  }

  if (
    best.savingKrw < preferences.minMeaningfulSavingKrw ||
    best.savingPessimisticKrw <= 0
  ) {
    return {
      verdict: "marginal",
      headline: nearby
        ? `${stationHeading(best.station.name, best.station.brand)}가 계산상 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 저렴하지만, 연비·가격 오차를 감안하면 이득이 사라질 수 있습니다. 제일 가까운 곳에서 넣는 편이 안전합니다.`
        : `${stationHeading(best.station.name, best.station.brand)}가 계산상 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 저렴하지만, 연비·가격 오차를 감안하면 이득이 사라질 수 있습니다. 가까운 곳에서 넣는 편이 안전합니다.`,
    };
  }

  return {
    verdict: "detour-worth-it",
    headline: nearby
      ? `${stationHeading(best.station.name, best.station.brand)}는 제일 가까운 곳보다 가는 거리·시간까지 넣어도 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 쌉니다. ${(best.detour.extraDistanceM / 1000).toFixed(1)}km 가면 됩니다.`
      : `${stationHeading(best.station.name, best.station.brand)}로 ${(best.detour.extraDistanceM / 1000).toFixed(1)}km 우회하면 우회 연료비와 시간까지 계산해도 ${Math.round(best.savingKrw).toLocaleString("ko-KR")}원 절약됩니다.`,
  };
}
