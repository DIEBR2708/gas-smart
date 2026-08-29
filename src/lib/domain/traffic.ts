/**
 * 출발 시각에 따른 정체 배수.
 *
 * 카카오 미래운행정보 API가 있으면 그 값을 쓰는 편이 맞다. 키가 없을 때는
 * 평일 출퇴근 시간대만 아주 거친 계수로 우회 시간과 도착 시각을 늘린다.
 * 거리는 바꾸지 않는다. 정체가 연료를 얼마나 더 태우는지는 연비 학습이
 * 흡수해야 하고, 여기서 거리를 부풀리면 이중 계상이 된다.
 */

export function congestionFactorAt(departAt: Date, highwayHeavy: boolean): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(departAt);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
  const weekend = weekday === "Sat" || weekday === "Sun";
  if (weekend) {
    if (hour >= 11 && hour < 18) return highwayHeavy ? 1.08 : 1.12;
    return 1;
  }
  if (hour >= 7 && hour < 9) return highwayHeavy ? 1.18 : 1.45;
  if (hour >= 17 && hour < 20) return highwayHeavy ? 1.22 : 1.5;
  if (hour >= 9 && hour < 11) return highwayHeavy ? 1.06 : 1.15;
  return 1;
}
