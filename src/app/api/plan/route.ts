import { NextResponse } from "next/server";
import { getSampleRoute, SAMPLE_ROUTES } from "@/lib/data/sample-routes";
import {
  carUnreachableReason,
  polylineUnreachableReason,
  UNREACHABLE_BY_CAR_CODE,
} from "@/lib/domain/driving-region";
import { interpolateRoute } from "@/lib/domain/route-build";
import { buildRefuelPlan } from "@/lib/domain/plan";
import type {
  Brand,
  DiscountRule,
  FillPolicy,
  FuelKind,
  NamedPlace,
  Preferences,
  StationReport,
  Vehicle,
} from "@/lib/domain/types";
import { resolveProviders } from "@/lib/providers";

/**
 * 추천 계산은 서버에서 한다.
 * 오피넷 인증키와 카카오 REST 키가 브라우저로 새어나가면 그대로 도용된다.
 * 클라이언트는 좌표와 차량 정보만 보내고 결과만 받는다.
 */

const FUEL_KINDS: FuelKind[] = ["gasoline", "premium", "diesel", "lpg"];
const BRANDS: Brand[] = ["SKE", "GSC", "HDO", "SOL", "RTE", "RTX", "NHO", "ETC"];
const REPORT_KINDS = ["closed", "price-mismatch", "gone"] as const;

const PLAN_CACHE_TTL_MS = 90_000;
const planResponseCache = new Map<string, { at: number; payload: unknown }>();

function planCacheKey(input: {
  routeId?: string;
  origin: NamedPlace | null;
  destination: NamedPlace | null;
  vehicle: Vehicle;
  preferences: Preferences;
  reports: StationReport[];
  departAt: Date;
}): string {
  return JSON.stringify({
    routeId: input.routeId ?? "",
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

interface PlanRequestBody {
  routeId?: string;
  origin?: NamedPlace;
  destination?: NamedPlace;
  vehicle?: Partial<Vehicle>;
  preferences?: Partial<Preferences>;
  departAt?: string;
  reports?: StationReport[];
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
    currentFuelL: clamp(Number(input?.currentFuelL), 0, tankCapacityL, 14),
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

export async function POST(request: Request) {
  let body: PlanRequestBody;
  try {
    body = (await request.json()) as PlanRequestBody;
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const vehicle = parseVehicle(body.vehicle);
  const preferences = parsePreferences(body.preferences);
  const reports = parseReports(body.reports);
  const departAt = body.departAt ? new Date(body.departAt) : new Date();
  if (Number.isNaN(departAt.getTime())) {
    return NextResponse.json({ error: "출발 시각이 올바르지 않습니다." }, { status: 400 });
  }

  const providers = resolveProviders(vehicle.fuelKind, departAt);
  const origin = parsePlace(body.origin);
  const destination = parsePlace(body.destination);
  const cacheKey = planCacheKey({
    routeId: body.routeId,
    origin,
    destination,
    vehicle,
    preferences,
    reports,
    departAt,
  });

  let route = getSampleRoute(body.routeId ?? "") ?? SAMPLE_ROUTES[0];

  if (origin && destination) {
    const same =
      Math.abs(origin.lat - destination.lat) < 1e-5 &&
      Math.abs(origin.lng - destination.lng) < 1e-5;
    if (same) {
      return NextResponse.json(
        { error: "출발지와 도착지가 같습니다." },
        { status: 400 },
      );
    }
    const blocked = carUnreachableReason(origin, destination);
    if (blocked) {
      return NextResponse.json(
        { error: blocked, code: UNREACHABLE_BY_CAR_CODE },
        { status: 400 },
      );
    }
  }

  const cached = planResponseCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PLAN_CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  if (origin && destination) {
    try {
      route = await providers.routes.findRoute(origin, destination);
    } catch {
      try {
        route = interpolateRoute(origin, destination);
      } catch (fallback) {
        const reason =
          fallback instanceof Error
            ? fallback.message
            : "자동차로는 갈 수 없는 구간입니다.";
        return NextResponse.json(
          { error: reason, code: UNREACHABLE_BY_CAR_CODE },
          { status: 400 },
        );
      }
    }
    const sea = polylineUnreachableReason(route.polyline);
    if (sea) {
      return NextResponse.json(
        { error: sea, code: UNREACHABLE_BY_CAR_CODE },
        { status: 400 },
      );
    }
  }

  try {
    const plan = await buildRefuelPlan(
      { route, vehicle, preferences, departAt, reports },
      providers,
    );

    const shapes = Object.fromEntries(
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
    );

    const payload = {
      plan,
      shapes,
      dataMode: providers.anyLive ? "live" : "sample",
    };
    if (planResponseCache.size > 80) {
      const now = Date.now();
      for (const [key, entry] of planResponseCache) {
        if (now - entry.at >= PLAN_CACHE_TTL_MS) planResponseCache.delete(key);
      }
    }
    planResponseCache.set(cacheKey, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "추천 계산에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
