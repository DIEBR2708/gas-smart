import type {
  DiscountRule,
  FillRecord,
  NamedPlace,
  Preferences,
  StationReport,
  Vehicle,
} from "@/lib/domain/types";
import type { PlanResponse } from "@/lib/plan-client";

/**
 * 기기 안에만 남는 사용자 데이터.
 *
 * 할인 프로필·마지막 계획은 서버 계정과 묶지 않는다.
 * 식별자 없이 이 브라우저에서만 쓰인다.
 */

const KEYS = {
  fills: "cfn.fills",
  discounts: "cfn.discounts",
  reports: "cfn.reports",
  lastPlan: "cfn.lastPlan",
  session: "cfn.session",
  reserve5Migrated: "cfn.migrated.reserve5",
  fuel20Migrated: "cfn.migrated.fuel20",
};

export interface SessionState {
  vehicle: Vehicle;
  preferences: Preferences;
  routeId: string;
  origin: NamedPlace | null;
  destination: NamedPlace | null;
  departAt: string | null;
  searchMode?: "route" | "nearby";
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode
  }
}

export function loadFills(): FillRecord[] {
  return readJson<FillRecord[]>(KEYS.fills, []);
}

export function saveFills(records: FillRecord[]) {
  writeJson(KEYS.fills, records.slice(-40));
}

export function loadDiscountRules(): DiscountRule[] {
  return readJson<DiscountRule[]>(KEYS.discounts, []);
}

export function saveDiscountRules(rules: DiscountRule[]) {
  writeJson(KEYS.discounts, rules);
}

export function loadReports(): StationReport[] {
  return readJson<StationReport[]>(KEYS.reports, []);
}

export function saveReports(reports: StationReport[]) {
  writeJson(KEYS.reports, reports.slice(-80));
}

export function cachePlan(response: PlanResponse) {
  if ((response.plan?.options.length ?? 0) === 0) return;
  writeJson(KEYS.lastPlan, { savedAt: new Date().toISOString(), response });
}

export function loadCachedPlan(): { savedAt: string; response: PlanResponse } | null {
  return readJson(KEYS.lastPlan, null);
}

export function loadSession(): SessionState | null {
  const session = readJson<SessionState | null>(KEYS.session, null);
  if (!session) return null;
  // 예비 기본값을 6L에서 5L로 옮긴다. 예전에 기본값 그대로 쓰던 세션만 한 번 맞춘다.
  if (typeof window !== "undefined") {
    try {
      if (!window.localStorage.getItem(KEYS.reserve5Migrated)) {
        window.localStorage.setItem(KEYS.reserve5Migrated, "1");
        if (session.vehicle.reserveL === 6) {
          session.vehicle = { ...session.vehicle, reserveL: 5 };
          writeJson(KEYS.session, session);
        }
      }
      if (!window.localStorage.getItem(KEYS.fuel20Migrated)) {
        window.localStorage.setItem(KEYS.fuel20Migrated, "1");
        if (session.vehicle.currentFuelL === 9) {
          session.vehicle = { ...session.vehicle, currentFuelL: 20 };
          writeJson(KEYS.session, session);
        }
      }
    } catch {
      // quota / private mode
    }
  }
  return session;
}

export function saveSession(session: SessionState) {
  writeJson(KEYS.session, session);
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
