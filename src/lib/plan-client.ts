import { searchGazetteer } from "./data/places";
import type {
  LatLng,
  NamedPlace,
  Preferences,
  RefuelPlan,
  Route,
  StationReport,
  Vehicle,
} from "./domain/types";
import { isNativeApp } from "./platform";

export interface PlanResponse {
  plan: RefuelPlan;
  /** 후보별 우회 구간 형상 (주유소 id -> 좌표 배열) */
  shapes: Record<string, LatLng[]>;
  dataMode: "live" | "sample";
}

export interface PlanStreamHandlers {
  /** 본선 경로가 나온 즉시 (아직 후보는 없다) */
  onRoute?: (route: Route) => void;
  /**
   * 순위가 갱신될 때마다. 어림 계산 결과가 먼저 오고, 실제 경유 길찾기로
   * 다시 계산한 결과가 뒤이어 같은 자리를 덮는다.
   */
  onPlan?: (response: PlanResponse) => void;
}

export interface PlanRequest {
  routeId?: string;
  searchMode?: "route" | "nearby";
  origin?: NamedPlace;
  destination?: NamedPlace;
  vehicle: Vehicle;
  preferences: Preferences;
  departAt: string;
  reports?: StationReport[];
  priorityStationId?: string;
}

export async function fetchPlan(
  body: PlanRequest,
  signal?: AbortSignal,
  handlers: PlanStreamHandlers = {},
): Promise<PlanResponse> {
  if (isNativeApp()) return runPlanOnDevice(body, signal, handlers);

  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("ndjson") && res.body) {
    return readPlanStream(res.body, handlers);
  }
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? "추천 계산에 실패했습니다.");
  }
  const payload = json as PlanResponse;
  if (payload.plan?.route) handlers.onRoute?.(payload.plan.route);
  return payload;
}

/**
 * 앱 안에서 직접 계산한다.
 *
 * 서버가 없으니 스트림도 없다. 엔진이 내보내는 단계를 그대로 콜백으로 넘기면
 * 되므로, 웹에서 NDJSON을 만들고 다시 파싱하던 왕복이 통째로 사라진다.
 *
 * 엔진은 필요할 때만 불러온다. 브라우저 번들에 오피넷·좌표 변환까지 들어갈
 * 이유가 없다.
 */
async function runPlanOnDevice(
  body: PlanRequest,
  signal: AbortSignal | undefined,
  handlers: PlanStreamHandlers,
): Promise<PlanResponse> {
  const [{ isRejection, preparePlan }, { bootstrapNative }] = await Promise.all([
    import("./engine/plan-engine"),
    import("./native-bootstrap"),
  ]);
  bootstrapNative();

  const prepared = await preparePlan(body);
  if (isRejection(prepared)) throw new Error(prepared.error);

  let plan: PlanResponse | null = null;
  let failure: string | null = null;

  await prepared.emitAll((message) => {
    if (message.type === "error") {
      failure = message.error;
      return;
    }
    if (message.type === "route") {
      handlers.onRoute?.(message.route);
      return;
    }
    plan = {
      plan: message.plan,
      shapes: message.shapes,
      dataMode: message.dataMode,
    };
    handlers.onPlan?.(plan);
  }, signal);

  if (!plan) throw new Error(failure ?? "추천 계산에 실패했습니다.");
  return plan;
}

async function readPlanStream(
  body: ReadableStream<Uint8Array>,
  handlers: PlanStreamHandlers,
): Promise<PlanResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let plan: PlanResponse | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line) as {
          type?: string;
          error?: string;
          route?: Route;
          plan?: RefuelPlan;
          shapes?: Record<string, LatLng[]>;
          dataMode?: PlanResponse["dataMode"];
        };
        if (message.type === "error") {
          throw new Error(message.error ?? "추천 계산에 실패했습니다.");
        }
        if (message.type === "route" && message.route) {
          handlers.onRoute?.(message.route);
        }
        if (message.type === "plan" && message.plan) {
          plan = {
            plan: message.plan,
            shapes: message.shapes ?? {},
            dataMode: message.dataMode ?? "sample",
          };
          handlers.onPlan?.(plan);
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
  if (!plan) {
    throw new Error("추천 계산에 실패했습니다.");
  }
  return plan;
}

export interface PlaceSearchResponse {
  places: NamedPlace[];
  source: "kakao" | "gazetteer" | "mixed" | "device" | "nominatim";
}

async function placesEngine() {
  const [engine, { bootstrapNative }] = await Promise.all([
    import("./engine/places-engine"),
    import("./native-bootstrap"),
  ]);
  bootstrapNative();
  return engine;
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<NamedPlace[]> {
  if (isNativeApp()) {
    try {
      const { lookupPlaces } = await placesEngine();
      const places = (await lookupPlaces(query)).places;
      return places.length > 0 ? places : searchGazetteer(query);
    } catch {
      return searchGazetteer(query);
    }
  }

  try {
    const res = await fetch(`/api/places?q=${encodeURIComponent(query)}`, {
      signal,
    });
    if (!res.ok) return searchGazetteer(query);
    const json = (await res.json()) as PlaceSearchResponse;
    const places = json.places ?? [];
    return places.length > 0 ? places : searchGazetteer(query);
  } catch (error) {
    if (signal?.aborted) throw error;
    return searchGazetteer(query);
  }
}

export async function reverseGeocodePlace(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<NamedPlace | null> {
  if (isNativeApp()) {
    try {
      const { lookupCoordinate } = await placesEngine();
      return (await lookupCoordinate(lat, lng)).places[0] ?? null;
    } catch {
      return null;
    }
  }

  const res = await fetch(`/api/places?lat=${lat}&lng=${lng}`, {
    signal: signal ?? AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as PlaceSearchResponse;
  return json.places?.[0] ?? null;
}
