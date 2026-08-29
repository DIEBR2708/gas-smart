import { searchGazetteer } from "./data/places";
import type {
  LatLng,
  NamedPlace,
  Preferences,
  RefuelPlan,
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
): Promise<PlanResponse> {
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? "추천 계산에 실패했습니다.");
  }
  return json as PlanResponse;
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
