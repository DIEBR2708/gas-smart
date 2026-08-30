import type {
  Brand,
  Detour,
  FillPolicy,
  Preferences,
  RefuelOption,
  Route,
  Station,
  StationReport,
  Vehicle,
  Warning,
} from "./types";

/** 가격 신고가 이 시간보다 오래되면 신선도 경고를 붙인다. */
const STALE_PRICE_HOURS = 36;
/** 주유소 도착 시 잔량이 탱크의 이 비율 미만이면 위험 경고. */
const LOW_MARGIN_RATIO = 0.08;

const EPS = 1e-9;

/**
 * 주유소에 도착할 때 이 잔량 미만이면 후보에서 뺀다.
 * 이미 예비량 이하로 출발했다면 0L까지는 허용한다. 그렇지 않으면
 * 예비량과 같은 잔량으로는 한 칸도 못 간다.
 */
export function minArrivalFuelL(vehicle: Vehicle): number {
  return vehicle.currentFuelL > vehicle.reserveL + EPS ? vehicle.reserveL : 0;
}

export interface CostContext {
  vehicle: Vehicle;
  preferences: Preferences;
  route: Route;
  /**
   * 경로 주변 시세 중위값 (원/L).
   * 도착 시 남는 연료의 가치와 부족분의 조달 비용을 매기는 기준가.
   * 이 기준이 없으면 "가득 채우기"가 항상 비싸 보이는 왜곡이 생긴다.
   */
  referencePriceKrwPerL: number;
  /** 출발 시각. 주유소 도착 시점의 영업 여부 판정에 쓴다. */
  departAt: Date;
  /**
   * 정체로 늘어난 시간 배수. 1이면 자유 흐름, 출퇴근은 1보다 크다.
   * 우회 시간 비용과 도착 시각 추정에만 곱한다. 거리는 바꾸지 않는다.
   */
  congestionFactor?: number;
  reports?: StationReport[];
  /** 다회 주유 일정에서 주입량을 강제할 때 쓴다. */
  forcedLiters?: number;
}

/** 카드 정액 할인 후 정률 할인을 적용한 실지불 단가. */
export function effectivePricePerLiter(
  listPriceKrwPerL: number,
  preferences: Preferences,
  brand?: Brand,
): number {
  let flat = preferences.cardDiscountKrwPerL;
  let rate = Math.min(Math.max(preferences.extraDiscountRate, 0), 1);
  for (const rule of preferences.discountRules ?? []) {
    if (!rule.enabled) continue;
    if (rule.brands.length > 0 && (!brand || !rule.brands.includes(brand))) {
      continue;
    }
    flat += rule.flatKrwPerL;
    rate = 1 - (1 - rate) * (1 - Math.min(Math.max(rule.rate, 0), 1));
  }
  const afterFlat = listPriceKrwPerL - flat;
  return Math.max(0, afterFlat * (1 - Math.min(rate, 1)));
}

/** 우회 없이 그대로 달렸을 때 목적지에서 예비량을 남기기 위해 필요한 주유량 (L). */
export function litersRequiredForTrip(
  vehicle: Vehicle,
  distanceM: number,
): number {
  const needL = distanceM / 1000 / vehicle.kmPerLiter;
  return Math.max(0, needL + vehicle.reserveL - vehicle.currentFuelL);
}

function desiredLitersForPolicy(
  policy: FillPolicy,
  args: {
    totalTripKm: number;
    vehicle: Vehicle;
    maxFillableL: number;
    effectivePriceKrwPerL: number;
  },
): number {
  const { totalTripKm, vehicle, maxFillableL, effectivePriceKrwPerL } = args;
  switch (policy.mode) {
    case "toDestination":
      return Math.max(
        0,
        totalTripKm / vehicle.kmPerLiter +
          vehicle.reserveL -
          vehicle.currentFuelL,
      );
    case "full":
      return maxFillableL;
    case "fixedLiters":
      return Math.max(0, policy.liters);
    case "fixedBudget":
      return effectivePriceKrwPerL <= EPS
        ? 0
        : Math.max(0, policy.krw / effectivePriceKrwPerL);
  }
}

function parseHhmm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

const SEOUL_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 주유소 영업시간은 KST로 표기된다.
 * 서버 로컬 시간대(배포 환경은 보통 UTC)로 판정하면 9시간이 밀려
 * 문 닫은 주유소를 추천하게 된다.
 */
export function minutesOfDayInSeoul(at: Date): number {
  const parts = SEOUL_TIME.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

function isOpenAt(station: Station, at: Date): boolean {
  const hours = station.openingHours;
  if (hours.allDay) return true;
  if (!hours.open || !hours.close) return true;
  const minutes = minutesOfDayInSeoul(at);
  const open = parseHhmm(hours.open);
  const close = parseHhmm(hours.close);
  // 자정을 넘겨 영업하는 경우 (예: 06:00 ~ 01:00)
  if (close <= open) return minutes >= open || minutes < close;
  return minutes >= open && minutes < close;
}

/**
 * 한 주유소를 경유하는 시나리오의 실질 총비용을 계산한다.
 *
 * 비용 구성:
 *   실지출        = 실지불단가 x 주입량
 *   + 시간비용    = 우회 소요시간 x 시간의 가치
 *   + 통행료 증분 = 우회로 달라진 통행료
 *   + 부족분 조달 = (예비량을 못 채운 만큼) x 경로 주변 시세
 *   - 잉여 크레딧 = (예비량 초과 잔량) x 경로 주변 시세
 *
 * 우회로 추가 소모되는 연료는 별도 항목으로 더하지 않는다.
 * 총 주행거리에 우회 거리가 포함되므로 주입량 계산에 이미 반영되어 있고,
 * 고정량·고정금액 주유의 경우에는 잉여/부족 항목이 그 차이를 흡수한다.
 * 따로 더하면 이중 계상이 된다.
 */
export function evaluateOption(
  station: Station,
  detour: Detour,
  ctx: CostContext,
): RefuelOption | null {
  const { vehicle, preferences, route, referencePriceKrwPerL, departAt } = ctx;
  const listPrice = station.prices[vehicle.fuelKind];
  if (listPrice === undefined) return null;

  const mismatch = (ctx.reports ?? []).find(
    (r) => r.stationId === station.id && r.kind === "price-mismatch",
  );
  const listed = listPrice + (mismatch ? 40 : 0);
  const effectivePrice = effectivePricePerLiter(listed, preferences, station.brand);
  const e = vehicle.kmPerLiter;

  const baseKm = route.distanceM / 1000;
  const detourKm = detour.extraDistanceM / 1000;
  const totalTripKm = baseKm + detourKm;
  const detourFuelL = detourKm / e;

  // 펌프에 도착할 때까지 달린 거리: 본선 주행분 + 진입 우회분(왕복 중 절반)
  const inboundKm = detour.alongRouteM / 1000 + detourKm / 2;
  const fuelOnArrivalL = vehicle.currentFuelL - inboundKm / e;
  const reachable = fuelOnArrivalL + EPS >= minArrivalFuelL(vehicle);

  const maxFillableL = Math.max(
    0,
    vehicle.tankCapacityL - Math.max(0, fuelOnArrivalL),
  );
  const desiredL =
    ctx.forcedLiters !== undefined
      ? ctx.forcedLiters
      : desiredLitersForPolicy(preferences.fillPolicy, {
          totalTripKm,
          vehicle,
          maxFillableL,
          effectivePriceKrwPerL: effectivePrice,
        });
  const litersToBuy = Math.min(desiredL, maxFillableL);
  const tankCapped = desiredL > maxFillableL + 1e-6;

  const fuelAtDestinationL =
    vehicle.currentFuelL + litersToBuy - totalTripKm / e;
  const surplusFuelL = Math.max(0, fuelAtDestinationL - vehicle.reserveL);
  const shortfallFuelL = Math.max(0, vehicle.reserveL - fuelAtDestinationL);

  const outOfPocketKrw = effectivePrice * litersToBuy;
  const detourFuelCostKrw = effectivePrice * detourFuelL;
  const congestion = Math.max(1, ctx.congestionFactor ?? 1);
  const inflatedDurationS = detour.extraDurationS * congestion;
  const timeCostKrw =
    (inflatedDurationS / 60) * preferences.timeValueKrwPerMin;
  const tollDeltaKrw = detour.extraTollKrw;
  const surplusCreditKrw = referencePriceKrwPerL * surplusFuelL;
  const shortfallCostKrw = referencePriceKrwPerL * shortfallFuelL;

  const normalizedCostKrw =
    outOfPocketKrw +
    timeCostKrw +
    tollDeltaKrw +
    shortfallCostKrw -
    surplusCreditKrw;

  const usefulLiters = Math.max(0, litersToBuy - surplusFuelL);
  const krwPerUsefulLiter =
    usefulLiters > EPS ? normalizedCostKrw / usefulLiters : 0;

  const warnings: Warning[] = [];

  if (!reachable) {
    warnings.push({
      code: "unreachable",
      severity: "error",
      message:
        fuelOnArrivalL < 0
          ? `현재 연료로는 도달 전에 ${Math.abs(fuelOnArrivalL).toFixed(1)}L 부족합니다.`
          : `예비 ${vehicle.reserveL}L 아래로 내려가 이 주유소는 제외합니다.`,
    });
  } else if (fuelOnArrivalL < vehicle.tankCapacityL * LOW_MARGIN_RATIO) {
    warnings.push({
      code: "low-margin-on-arrival",
      severity: "warn",
      message: `도착 시 잔량이 ${fuelOnArrivalL.toFixed(1)}L뿐입니다. 정체나 경로 변경이 생기면 위험합니다.`,
    });
  }

  if (tankCapped) {
    warnings.push({
      code: "tank-capped",
      severity: "info",
      message: `탱크 용량 때문에 ${maxFillableL.toFixed(1)}L까지만 주입됩니다.`,
    });
  }

  if (shortfallFuelL > 0.05) {
    warnings.push({
      code: "insufficient-to-destination",
      severity: "warn",
      message: `이 계획만으로는 목적지에서 예비량이 ${shortfallFuelL.toFixed(1)}L 부족합니다. 추가 주유가 필요합니다.`,
    });
  }

  const ageH =
    (departAt.getTime() - new Date(station.priceUpdatedAt).getTime()) / 3_600_000;
  if (Number.isFinite(ageH) && ageH > STALE_PRICE_HOURS) {
    warnings.push({
      code: "stale-price",
      severity: "info",
      message: `가격 신고가 ${Math.round(ageH / 24)}일 전입니다. 현장 가격이 다를 수 있습니다.`,
    });
  }

  const arrivalAt = new Date(
    departAt.getTime() +
      ((route.durationS * (detour.alongRouteM / Math.max(1, route.distanceM)) +
        detour.extraDurationS) *
        congestion *
        1000),
  );
  const reportedClosed = (ctx.reports ?? []).some(
    (r) => r.stationId === station.id && (r.kind === "closed" || r.kind === "gone"),
  );
  if (reportedClosed || !isOpenAt(station, arrivalAt)) {
    const minutes = minutesOfDayInSeoul(arrivalAt);
    const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    warnings.push({
      code: "closed-on-arrival",
      severity: "error",
      message: `도착 예상 시각(${hhmm} KST)에 영업하지 않습니다.`,
    });
  }

  if (station.accessHint?.oppositeSide) {
    warnings.push({
      code: "opposite-side",
      severity: "warn",
      message: "진행 방향 반대편입니다. 회차 구간이 필요합니다.",
    });
  }
  if (station.accessHint?.requiresHighwayExit) {
    warnings.push({
      code: "highway-exit",
      severity: "warn",
      message: "고속도로를 진출했다가 재진입해야 합니다. 통행료와 시간이 추가됩니다.",
    });
  }
  if (detour.source === "geometric-estimate") {
    warnings.push({
      code: "estimated-detour",
      severity: "info",
      message: "우회 거리는 도로망이 아닌 기하학적 추정치입니다.",
    });
  }
  if (congestion > 1.05) {
    warnings.push({
      code: "congested",
      severity: "info",
      message: `출발 시각 기준 정체를 반영해 우회 시간을 ${Math.round((congestion - 1) * 100)}% 늘려 계산했습니다.`,
    });
  }
  for (const report of ctx.reports ?? []) {
    if (report.stationId !== station.id) continue;
    warnings.push({
      code: "user-reported",
      severity: report.kind === "price-mismatch" ? "warn" : "error",
      message:
        report.kind === "price-mismatch"
          ? "이전에 현장 가격이 다르다고 제보한 곳입니다. 단가를 40원/L 비관적으로 올렸습니다."
          : report.kind === "closed"
            ? "영업하지 않는다고 제보한 곳입니다."
            : "폐업·이전으로 제보한 곳입니다.",
    });
  }

  return {
    station,
    detour,
    listPriceKrwPerL: listPrice,
    effectivePriceKrwPerL: effectivePrice,
    fuelOnArrivalL,
    reachable,
    litersToBuy,
    tankCapped,
    detourFuelL,
    fuelAtDestinationL,
    surplusFuelL,
    shortfallFuelL,
    outOfPocketKrw,
    detourFuelCostKrw,
    timeCostKrw,
    tollDeltaKrw,
    surplusCreditKrw,
    shortfallCostKrw,
    normalizedCostKrw,
    krwPerUsefulLiter,
    warnings,
  };
}

/**
 * 손익분기 우회거리 (km).
 *
 * 기준선보다 리터당 g원 싼 주유소에서 L리터를 넣으면 총 g x L원을 번다.
 * 반대로 우회 1km마다 (실지불단가 / 연비)원의 연료비와
 * (시간의 가치 / 평균속도)원의 시간비용을 쓴다.
 * 그 둘이 같아지는 지점이 손익분기다.
 *
 * 이 숫자가 UI에 있어야 사용자가 "리터당 30원 때문에 10km를 돌아가는 건
 * 손해"라는 사실을 스스로 판단할 수 있다.
 */
export function breakEvenDetourKm(args: {
  gainPerLiterKrw: number;
  litersToBuy: number;
  effectivePriceKrwPerL: number;
  kmPerLiter: number;
  timeValueKrwPerMin: number;
  detourSpeedKmh: number;
}): number {
  const {
    gainPerLiterKrw,
    litersToBuy,
    effectivePriceKrwPerL,
    kmPerLiter,
    timeValueKrwPerMin,
    detourSpeedKmh,
  } = args;
  const grossGain = gainPerLiterKrw * litersToBuy;
  if (grossGain <= 0) return 0;
  const fuelCostPerKm = effectivePriceKrwPerL / kmPerLiter;
  const minutesPerKm = detourSpeedKmh > 0 ? 60 / detourSpeedKmh : 0;
  const costPerKm = fuelCostPerKm + timeValueKrwPerMin * minutesPerKm;
  if (costPerKm <= EPS) return Number.POSITIVE_INFINITY;
  return grossGain / costPerKm;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
