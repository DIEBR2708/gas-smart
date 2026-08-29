import type { LatLng, Preferences, RefuelPlan, Vehicle } from "./domain/types";

export interface PlanResponse {
  plan: RefuelPlan;
  /** 후보별 우회 구간 형상 (주유소 id -> 좌표 배열) */
  shapes: Record<string, LatLng[]>;
  dataMode: "live" | "sample";
}

export interface PlanRequest {
  routeId: string;
  vehicle: Vehicle;
  preferences: Preferences;
  departAt: string;
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
