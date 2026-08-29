import type { FillRecord } from "./types";

/**
 * 주유 기록으로 실주행 연비를 추정한다.
 *
 * 기록은 기기 안에만 둔다. 서버로 보내지 않으므로 위치·식별자와 묶이지 않는다.
 * 최근 기록에 더 큰 가중치를 주는 가중평균이다. 기록이 두 건 미만이면
 * 추정이 불안정하므로 null을 돌려 사용자가 넣은 값을 유지한다.
 */
export function learnedKmPerLiter(records: FillRecord[]): number | null {
  const valid = records
    .filter((record) => record.liters > 0.5 && record.kmDriven > 3)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (valid.length < 2) return null;

  let weighted = 0;
  let weights = 0;
  valid.forEach((record, index) => {
    const weight = index + 1;
    weighted += (record.kmDriven / record.liters) * weight;
    weights += weight;
  });
  const estimate = weighted / weights;
  if (!Number.isFinite(estimate) || estimate < 3 || estimate > 40) return null;
  return Math.round(estimate * 10) / 10;
}

export function fillEconomy(record: FillRecord): number {
  return record.liters > 0 ? record.kmDriven / record.liters : 0;
}
