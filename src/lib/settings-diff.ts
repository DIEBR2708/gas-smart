import type { Preferences, Vehicle } from "@/lib/domain/types";

/**
 * 적용된 차량·조건과 편집 중인 값의 차이.
 *
 * 조건을 하나 만질 때마다 경로를 다시 계산하면, 슬라이더를 끝까지 끌기도 전에
 * 조회가 몇 번씩 나간다. 그래서 편집은 초안에 모아두고 사용자가 "적용"을
 * 눌렀을 때만 반영한다. 그때 무엇이 바뀌었는지는 사용자에게 알려줘야 한다.
 */

export interface SettingsSnapshot {
  vehicle: Vehicle;
  preferences: Preferences;
}

const VEHICLE_LABELS: Record<keyof Vehicle, string> = {
  fuelKind: "유종",
  kmPerLiter: "연비",
  tankCapacityL: "탱크 용량",
  currentFuelL: "현재 연료",
  reserveL: "예비 연료",
};

const PREFERENCE_LABELS: Record<keyof Preferences, string> = {
  timeValueKrwPerMin: "시간 여유",
  cardDiscountKrwPerL: "카드 할인",
  extraDiscountRate: "정률 할인",
  maxDetourKm: "최대 우회 거리",
  maxDetourMin: "최대 우회 시간",
  fillPolicy: "주입량",
  minMeaningfulSavingKrw: "최소 절감액",
  selfServiceOnly: "셀프 전용",
  brands: "브랜드",
  avoidHighwayExit: "고속도로 진출",
  discountRules: "할인 프로필",
};

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 바뀐 항목의 사람이 읽는 이름. 순서는 화면에 보이는 순서를 따른다. */
export function changedSettingLabels(
  applied: SettingsSnapshot,
  draft: SettingsSnapshot,
): string[] {
  const labels: string[] = [];
  for (const key of Object.keys(VEHICLE_LABELS) as (keyof Vehicle)[]) {
    if (!same(applied.vehicle[key], draft.vehicle[key])) {
      labels.push(VEHICLE_LABELS[key]);
    }
  }
  for (const key of Object.keys(PREFERENCE_LABELS) as (keyof Preferences)[]) {
    if (!same(applied.preferences[key], draft.preferences[key])) {
      labels.push(PREFERENCE_LABELS[key]);
    }
  }
  return labels;
}

/** "연비, 탱크 용량 외 2개" */
export function summarizeChanges(labels: string[], shown = 2): string {
  if (labels.length === 0) return "";
  const head = labels.slice(0, shown).join(", ");
  const rest = labels.length - Math.min(shown, labels.length);
  return rest > 0 ? `${head} 외 ${rest}개` : head;
}
