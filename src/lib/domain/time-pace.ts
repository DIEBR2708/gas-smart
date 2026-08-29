export type TimePace = "rushed" | "normal" | "relaxed";

/**
 * 화면에는 촉박/적당/여유만 보여 주고, 순위 계산에는 원/분으로 환산한다.
 * 촉박할수록 우회 시간을 비싸게 봐서 가까운 주유소가 올라간다.
 */
export const TIME_PACE: Record<
  TimePace,
  { label: string; krwPerMin: number; hint: string }
> = {
  rushed: {
    label: "촉박",
    krwPerMin: 400,
    hint: "우회 시간을 비싸게 봅니다. 가까운 곳이 유리해집니다.",
  },
  normal: {
    label: "적당",
    krwPerMin: 150,
    hint: "가격 차이가 분명하면 우회합니다.",
  },
  relaxed: {
    label: "여유",
    krwPerMin: 40,
    hint: "조금 돌아가도 싼 곳을 고릅니다.",
  },
};

export const TIME_PACE_ORDER: TimePace[] = ["rushed", "normal", "relaxed"];

export function timePaceFromKrw(krwPerMin: number): TimePace {
  if (krwPerMin >= 275) return "rushed";
  if (krwPerMin <= 80) return "relaxed";
  return "normal";
}
