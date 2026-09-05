import {
  getSampleRoute,
  knownCorridorRoute,
  SAMPLE_ROUTES,
} from "@/lib/data/sample-routes";
import {
  carUnreachableReason,
  polylineUnreachableReason,
  UNREACHABLE_BY_CAR_CODE,
} from "@/lib/domain/driving-region";
import {
  interpolateRoute,
  isStraightFallbackRoute,
  noteKakaoRouteFailure,
} from "@/lib/domain/route-build";
import { nearbySearchRoute } from "@/lib/domain/nearby";
import { buildRefuelPlan } from "@/lib/domain/plan";
import type {
  Brand,
  DiscountRule,
  FillPolicy,
  FuelKind,
  LatLng,
  NamedPlace,
  Preferences,
  RefuelPlan,
  Route,
  StationReport,
  Vehicle,
} from "@/lib/domain/types";
import {
  resolveProviders,
  stationsAreReal,
  type ProviderSet,
} from "@/lib/providers";
import { snapToRoadKakao } from "@/lib/providers/kakao/local";
import { kakaoRestApiKey } from "@/lib/runtime-keys";

/**
 * 추천 계산의 본체. HTTP를 모른다.
 *
 * 웹에서는 /api/plan이 이걸 감싸 NDJSON으로 흘려보내고, 안드로이드 앱에서는
 * 화면이 직접 부른다. 앱에는 대신 계산해 줄 서버가 없기 때문이다.
 *
 * 그래서 결과를 반환하지 않고 `emit`으로 내보낸다. 본선 경로가 먼저 나오고,
 * 어림 순위가 그다음, 정밀 순위가 마지막이다. 전송 방식이 무엇이든 이 순서와
 * 중간 결과를 그대로 쓸 수 있어야 한다.
 */

const FUEL_KINDS: FuelKind[] = ["gasoline", "premium", "diesel", "lpg"];
const BRANDS: Brand[] = ["SKE", "GSC", "HDO", "SOL", "RTE", "RTX", "NHO", "ETC"];
const REPORT_KINDS = ["closed", "price-mismatch", "gone"] as const;

const PLAN_CACHE_TTL_MS = 90_000;

export interface PlanPayload {
  plan: RefuelPlan;
  shapes: Record<string, LatLng[]>;
  dataMode: "live" | "sample";
}

export type PlanMessage =
  | { type: "route"; route: Route }
  | ({
      type: "plan";
      stage: "estimate" | "exact";
      timing?: { routeMs: number; planMs: number };
    } & PlanPayload)
  | { type: "error"; error: string };

/** 계산을 시작하기도 전에 거절해야 하는 경우. HTTP에서는 400이 된다. */
export interface PlanRejection {
  error: string;
  code?: string;
}

export interface PlanRequestBody {
  routeId?: string;
  searchMode?: "route" | "nearby";
  origin?: NamedPlace;
  destination?: NamedPlace;
  vehicle?: Partial<Vehicle>;
  preferences?: Partial<Preferences>;
  departAt?: string;
  reports?: StationReport[];
  /** 사용자가 이미 고른 주유소. 이 곳의 경유 경로부터 계산한다. */
  priorityStationId?: string;
}

const planResponseCache = new Map<string, { at: number; payload: PlanPayload }>();

function planCacheKey(input: {
  routeId?: string;
  origin: NamedPlace | null;
  destination: NamedPlace | null;
  vehicle: Vehicle;
  preferences: Preferences;
  reports: StationReport[];
  departAt: Date;
  nearby: boolean;
  priorityStationId: string;
}): string {
  return JSON.stringify({
    routeId: input.routeId ?? "",
    nearby: input.nearby,
    // 우선 계산한 주유소는 정밀 계산 대상이 달라지므로 결과도 다르다.
    prio: input.priorityStationId,
    o: input.origin && [input.origin.lat.toFixed(4), input.origin.lng.toFixed(4)],
    d:
      input.destination &&
      [input.destination.lat.toFixed(4), input.destination.lng.toFixed(4)],
    v: input.vehicle,
    p: input.preferences,
    r: input.reports,
    t: Math.floor(input.departAt.getTime() / 300_000),
  });
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parsePlace(input: NamedPlace | undefined): NamedPlace | null {
  if (!input) return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const name = String(input.name ?? "").trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 32 || lat > 39 || lng < 124 || lng > 132) return null;
  return { name: name.slice(0, 80), lat, lng };
}

function parseVehicle(input: Partial<Vehicle> | undefined): Vehicle {
  const fuelKind = FUEL_KINDS.includes(input?.fuelKind as FuelKind)
    ? (input!.fuelKind as FuelKind)
    : "gasoline";
  const tankCapacityL = clamp(Number(input?.tankCapacityL), 20, 200, 60);
  return {
    fuelKind,
    kmPerLiter: clamp(Number(input?.kmPerLiter), 3, 40, 11.5),
    tankCapacityL,
    currentFuelL: clamp(Number(input?.currentFuelL), 0, tankCapacityL, 20),
    reserveL: clamp(Number(input?.reserveL), 0, tankCapacityL, 5),
  };
}

function parseFillPolicy(input: unknown): FillPolicy {
  const policy = input as FillPolicy | undefined;
  switch (policy?.mode) {
    case "full":
      return { mode: "full" };
    case "fixedLiters":
      return { mode: "fixedLiters", liters: clamp(policy.liters, 1, 200, 30) };
    case "fixedBudget":
      return { mode: "fixedBudget", krw: clamp(policy.krw, 1000, 500_000, 50_000) };
    default:
      return { mode: "toDestination" };
  }
}

function parseBrands(input: unknown): Brand[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is Brand => BRANDS.includes(item as Brand));
}

function parseDiscountRules(input: unknown): DiscountRule[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).flatMap((raw, index) => {
    const item = raw as Partial<DiscountRule>;
    const name = String(item.name ?? "").trim().slice(0, 40);
    if (!name) return [];
    return [
      {
        id: String(item.id ?? `rule-${index}`).slice(0, 40),
        name,
        enabled: item.enabled !== false,
        flatKrwPerL: clamp(Number(item.flatKrwPerL), 0, 500, 0),
        rate: clamp(Number(item.rate), 0, 0.5, 0),
        brands: parseBrands(item.brands),
      },
    ];
  });
}

function parsePreferences(input: Partial<Preferences> | undefined): Preferences {
  return {
    timeValueKrwPerMin: clamp(Number(input?.timeValueKrwPerMin), 0, 5000, 150),
    cardDiscountKrwPerL: clamp(Number(input?.cardDiscountKrwPerL), 0, 500, 60),
    extraDiscountRate: clamp(Number(input?.extraDiscountRate), 0, 0.5, 0),
    maxDetourKm: clamp(Number(input?.maxDetourKm), 0.2, 30, 8),
    maxDetourMin: clamp(Number(input?.maxDetourMin), 1, 120, 15),
    fillPolicy: parseFillPolicy(input?.fillPolicy),
    minMeaningfulSavingKrw: clamp(
      Number(input?.minMeaningfulSavingKrw),
      0,
      100_000,
      500,
    ),
    selfServiceOnly: Boolean(input?.selfServiceOnly),
    brands: parseBrands(input?.brands),
    avoidHighwayExit: Boolean(input?.avoidHighwayExit),
    discountRules: parseDiscountRules(input?.discountRules),
  };
}

function parseReports(input: unknown): StationReport[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 80).flatMap((raw) => {
    const item = raw as Partial<StationReport>;
    const stationId = String(item.stationId ?? "").trim();
    const kind = item.kind;
    if (!stationId || !REPORT_KINDS.includes(kind as (typeof REPORT_KINDS)[number])) {
      return [];
    }
    return [
      {
        id: String(item.id ?? stationId).slice(0, 40),
        stationId: stationId.slice(0, 80),
        stationName: String(item.stationName ?? "").slice(0, 80),
        kind: kind as StationReport["kind"],
        note: String(item.note ?? "").slice(0, 200),
        reportedAt: String(item.reportedAt ?? new Date().toISOString()),
      },
    ];
  });
}

/**
 * 옮긴 거리가 이보다 짧으면 원래 좌표도 이미 도로 옆이었다는 뜻이다.
 * 도심에서 편의점 하나 거리만큼 밀어놓고 "옮겼습니다"라고 말할 필요는 없다.
 */
const SNAP_MIN_MOVE_M = 250;

function kakaoFailureCode(error: unknown): string {
  return error instanceof Error && error.message.startsWith("KAKAO:")
    ? error.message.slice("KAKAO:".length)
    : "";
}

async function snapEndpointToRoad(
  place: NamedPlace,
  label: string,
  key: string,
): Promise<{ place: NamedPlace; note: string } | null> {
  const snap = await snapToRoadKakao(key, place.lat, place.lng);
  if (!snap || snap.distanceM < SNAP_MIN_MOVE_M) return null;
  const away =
    snap.distanceM >= 1000
      ? `${(snap.distanceM / 1000).toFixed(1)}km`
      : `${Math.round(snap.distanceM / 10) * 10}m`;
  return {
    place: {
      name: place.name,
      lat: snap.place.lat,
      lng: snap.place.lng,
      address: snap.place.address ?? snap.place.name,
    },
    note: `${label} '${place.name}' 자리는 도로와 이어지지 않아, ${away} 떨어진 '${snap.place.name}' 기준으로 길을 잡았습니다.`,
  };
}

/**
 * 산 정상처럼 도로가 없는 좌표를 그대로 넘기면 카카오는 경로를 아예 만들지 않는다.
 * 길찾기가 결과 코드로 거절했을 때만, 양 끝을 가장 가까운 차량 진입 지점으로 옮겨
 * 한 번 더 물어본다. 통신 실패는 좌표 문제가 아니므로 재시도하지 않는다.
 */
async function findRouteSnappingToRoad(
  providers: ProviderSet,
  origin: NamedPlace,
  destination: NamedPlace,
): Promise<Route> {
  try {
    return await providers.routes.findRoute(origin, destination);
  } catch (error) {
    const key = kakaoRestApiKey();
    if (!key || !kakaoFailureCode(error).startsWith("code-")) throw error;

    const [snappedOrigin, snappedDestination] = await Promise.all([
      snapEndpointToRoad(origin, "출발지", key),
      snapEndpointToRoad(destination, "도착지", key),
    ]);
    if (!snappedOrigin && !snappedDestination) throw error;

    const route = await providers.routes.findRoute(
      snappedOrigin?.place ?? origin,
      snappedDestination?.place ?? destination,
    );
    return {
      ...route,
      adjustedNote: [snappedOrigin?.note, snappedDestination?.note]
        .filter(Boolean)
        .join(" "),
    };
  }
}

/** 본선 경로까지 확정된 상태. 여기서부터는 거절 없이 결과만 나온다. */
export interface PreparedPlan {
  route: Route;
  emitAll: (emit: (message: PlanMessage) => void, signal?: AbortSignal) => Promise<void>;
}

export function isRejection(
  result: PlanRejection | PreparedPlan,
): result is PlanRejection {
  return "error" in result;
}

/**
 * 요청을 검사하고 본선 경로까지 찾는다.
 *
 * 거절은 전부 여기서 난다. 잘못된 좌표, 같은 출발·도착, 자동차로 갈 수 없는
 * 구간은 계산을 시작할 것도 없다. HTTP에서는 이 단계의 실패만 상태 코드가
 * 되고, 그 뒤의 실패는 이미 지도가 떠 있는 화면 위에 사유로 얹힌다.
 */
export async function preparePlan(
  body: PlanRequestBody,
): Promise<PlanRejection | PreparedPlan> {
  const vehicle = parseVehicle(body.vehicle);
  const preferences = parsePreferences(body.preferences);
  const reports = parseReports(body.reports);
  const departAt = body.departAt ? new Date(body.departAt) : new Date();
  if (Number.isNaN(departAt.getTime())) {
    return { error: "출발 시각이 올바르지 않습니다." };
  }

  const providers = resolveProviders(vehicle.fuelKind, departAt);
  const origin = parsePlace(body.origin);
  const destination = parsePlace(body.destination);
  const nearby = body.searchMode === "nearby";
  const priorityStationId = String(body.priorityStationId ?? "").slice(0, 80);
  const cacheKey = planCacheKey({
    routeId: body.routeId,
    origin,
    destination: nearby ? null : destination,
    vehicle,
    preferences,
    reports,
    departAt,
    nearby,
    priorityStationId,
  });

  let route = getSampleRoute(body.routeId ?? "") ?? SAMPLE_ROUTES[0];

  if (nearby) {
    if (!origin) {
      return { error: "이 자리에서 찾으려면 위치를 지정해 주세요." };
    }
  } else if (origin && destination) {
    const same =
      Math.abs(origin.lat - destination.lat) < 1e-5 &&
      Math.abs(origin.lng - destination.lng) < 1e-5;
    if (same) return { error: "출발지와 도착지가 같습니다." };

    const blocked = carUnreachableReason(origin, destination);
    if (blocked) return { error: blocked, code: UNREACHABLE_BY_CAR_CODE };
  }

  const cached = planResponseCache.get(cacheKey);
  if (
    cached &&
    Date.now() - cached.at < PLAN_CACHE_TTL_MS &&
    cached.payload.plan.options.length > 0 &&
    !isStraightFallbackRoute(cached.payload.plan.route)
  ) {
    const payload = cached.payload;
    return {
      route: payload.plan.route,
      async emitAll(emit) {
        emit({ type: "route", route: payload.plan.route });
        emit({ type: "plan", stage: "exact", ...payload });
      },
    };
  }

  const startedAt = Date.now();

  if (nearby && origin) {
    route = nearbySearchRoute(origin);
  } else if (origin && destination) {
    try {
      route = await findRouteSnappingToRoad(providers, origin, destination);
    } catch (error) {
      const corridor = knownCorridorRoute(origin, destination);
      if (corridor) {
        route = corridor;
      } else {
        try {
          route = interpolateRoute(origin, destination);
          const code = kakaoFailureCode(error);
          if (code) route = noteKakaoRouteFailure(route, code);
        } catch (fallback) {
          const reason =
            fallback instanceof Error
              ? fallback.message
              : "자동차로는 갈 수 없는 구간입니다.";
          return { error: reason, code: UNREACHABLE_BY_CAR_CODE };
        }
      }
    }
    const sea = polylineUnreachableReason(route.polyline);
    if (sea) return { error: sea, code: UNREACHABLE_BY_CAR_CODE };
  }

  const routeReadyAt = Date.now();
  const planInput = { route, vehicle, preferences, departAt, reports, nearby };
  const dataMode = stationsAreReal(providers) ? "live" : "sample";

  const toPayload = (plan: RefuelPlan): PlanPayload => ({
    plan,
    shapes: Object.fromEntries(
      plan.options.map((option) => [
        option.station.id,
        option.detour.viaPolyline && option.detour.viaPolyline.length > 1
          ? option.detour.viaPolyline
          : providers.routes.detourShape(
              route,
              option.station,
              option.detour.joinPoint,
            ),
      ]),
    ),
    dataMode,
  });

  /*
    본선 경로 → 어림 순위 → 정밀 순위 순으로 내보낸다.

    경유 길찾기는 후보 수만큼 카카오를 치기 때문에 4초 안팎이 걸린다. 그동안
    화면을 비워 두는 대신, 길찾기를 한 건도 쓰지 않는 직선 왕복 어림값으로
    순위를 먼저 띄우고 진짜 경로가 오는 대로 그 자리에서 갈아 끼운다.

    근처 검색이나 샘플 경로는 애초에 어림값으로 계산하므로 두 번 돌릴 이유가 없다.
  */
  const needsRefinement = !nearby && providers.routes.isLive;

  const settledRoute = route;
  return {
    route: settledRoute,
    async emitAll(emit, signal) {
      emit({ type: "route", route: settledRoute });

      try {
        if (needsRefinement) {
          const draft = await buildRefuelPlan(planInput, providers, {
            detourMode: "estimate",
            signal,
          });
          emit({ type: "plan", stage: "estimate", ...toPayload(draft) });
        }

        const plan = await buildRefuelPlan(planInput, providers, {
          signal,
          priorityStationId: priorityStationId || undefined,
        });
        const payload = toPayload(plan);

        if (plan.options.length > 0 && !isStraightFallbackRoute(plan.route)) {
          if (planResponseCache.size > 80) {
            const now = Date.now();
            for (const [key, entry] of planResponseCache) {
              if (now - entry.at >= PLAN_CACHE_TTL_MS) {
                planResponseCache.delete(key);
              }
            }
          }
          planResponseCache.set(cacheKey, { at: Date.now(), payload });
        }

        emit({
          type: "plan",
          stage: "exact",
          ...payload,
          timing: {
            routeMs: routeReadyAt - startedAt,
            planMs: Date.now() - routeReadyAt,
          },
        });
      } catch (error) {
        // 화면이 이미 떠난 계산은 알릴 상대가 없다.
        if (!(error instanceof Error && error.name === "AbortError")) {
          emit({
            type: "error",
            error:
              error instanceof Error
                ? error.message
                : "추천 계산에 실패했습니다.",
          });
        }
      }
    },
  };
}
