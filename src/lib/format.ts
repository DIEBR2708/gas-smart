const KRW = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export function krw(value: number): string {
  return `${KRW.format(Math.round(value))}원`;
}

/** 절감액처럼 방향이 중요한 값. 부호를 명시한다. */
export function signedKrw(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0원";
  return `${rounded > 0 ? "+" : "-"}${KRW.format(Math.abs(rounded))}원`;
}

export function perLiter(value: number): string {
  return `${KRW.format(Math.round(value))}원/L`;
}

export function liters(value: number, digits = 1): string {
  return `${value.toFixed(digits)}L`;
}

export function km(meters: number, digits = 1): string {
  return `${(meters / 1000).toFixed(digits)}km`;
}

export function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

export function relativeTime(iso: string, now = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return "시각 미상";
  const hours = diffMs / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}분 전 신고`;
  if (hours < 24) return `${Math.round(hours)}시간 전 신고`;
  return `${Math.round(hours / 24)}일 전 신고`;
}

export function seoulTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
