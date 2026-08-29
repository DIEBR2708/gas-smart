import { NextResponse } from "next/server";
import { getSampleRoute, SAMPLE_ROUTES } from "@/lib/data/sample-routes";
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
    reserveL: clamp(Number(input?.reserveL), 0, tankCapacityL, 6),
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
    try {
      route = await providers.routes.findRoute(origin, destination);
    } catch {
      route = interpolateRoute(origin, destination);
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
        providers.routes.detourShape(
          route,
          option.station,
          option.detour.joinPoint,
        ),
      ]),
    );

    return NextResponse.json({
      plan,
      shapes,
      dataMode: providers.anyLive ? "live" : "sample",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "추천 계산에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
