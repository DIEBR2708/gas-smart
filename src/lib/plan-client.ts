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

export interface PlanResponse {
  plan: RefuelPlan;
  /** 후보별 우회 구간 형상 (주유소 id -> 좌표 배열) */
  shapes: Record<string, LatLng[]>;
  dataMode: "live" | "sample";
}

export interface PlanRequest {
  routeId?: string;
  origin?: NamedPlace;
  destination?: NamedPlace;
  vehicle: Vehicle;
  preferences: Preferences;
  departAt: string;
  reports?: StationReport[];
}

export async function fetchPlan(
  body: PlanRequest,
  signal?: AbortSignal,
  onRoute?: (route: Route) => void,
): Promise<PlanResponse> {
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("ndjson") && res.body) {
    return readPlanStream(res.body, onRoute);
  }
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? "추천 계산에 실패했습니다.");
  }
  const payload = json as PlanResponse;
  if (payload.plan?.route) onRoute?.(payload.plan.route);
  return payload;
}

async function readPlanStream(
  body: ReadableStream<Uint8Array>,
  onRoute?: (route: Route) => void,
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
          onRoute?.(message.route);
        }
        if (message.type === "plan" && message.plan) {
          plan = {
            plan: message.plan,
            shapes: message.shapes ?? {},
            dataMode: message.dataMode ?? "sample",
          };
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

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<NamedPlace[]> {
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
  const res = await fetch(`/api/places?lat=${lat}&lng=${lng}`, { signal });
  if (!res.ok) return null;
  const json = (await res.json()) as PlaceSearchResponse;
  return json.places?.[0] ?? null;
}
