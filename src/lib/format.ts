import { BRAND_LABEL, type Brand } from "./domain/types";

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

/** 우회 시간. 목록에서 금액 아래에 +5분처럼 적는다. */
export function signedMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m === 0) return "+0분";
  return `${m > 0 ? "+" : ""}${m}분`;
}

/**
 * 주유소 상호에서 (주)·㈜·주식회사를 뺀다.
 * 오피넷 신고명에 법인식이 붙어 목록이 지저분해지는 것을 막는다.
 */
export function displayStationName(name: string): string {
  return name
    .replace(/주식회사/g, "")
    .replace(/㈜/g, "")
    .replace(/\(\s*주\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-_/.,]+|[\s\-_/.,]+$/g, "")
    .trim();
}

const BRAND_PREFIXES = [
  ...Object.values(BRAND_LABEL),
  "SK에너지",
  "SK",
  "GS칼텍스",
  "GS",
  "현대오일뱅크",
  "현대오일",
  "S-OIL",
  "S오일",
  "자영알뜰",
  "고속도로알뜰",
  "농협알뜰",
  "알뜰",
  "자가상표",
].sort((a, b) => b.length - a.length);

/**
 * 브랜드 옆에 작게 붙일 상호.
 * 상표명과 끝의 '주유소'는 빼서 GS칼텍스 + 아크로셀프 처럼 보이게 한다.
 */
export function stationTradeName(name: string, brand?: Brand): string {
  let trade = displayStationName(name);
  const extra = brand ? [BRAND_LABEL[brand]] : [];
  for (const prefix of [...extra, ...BRAND_PREFIXES]) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    trade = trade.replace(new RegExp(`^${escaped}\\s*`, "i"), "").trim();
  }
  trade = trade.replace(/\s*주유소$/u, "").trim();
  trade = trade.replace(/\s*충전소$/u, "").trim();
  return trade;
}

/** 문장용: "GS칼텍스 아크로셀프" */
export function stationHeading(name: string, brand: Brand): string {
  const brandLabel = BRAND_LABEL[brand];
  const trade = stationTradeName(name, brand);
  if (!trade || trade === brandLabel) return brandLabel;
  return `${brandLabel} ${trade}`;
}

/** 시간 기회비용을 뺀 실제 지출. 순위는 시간을 포함한 값으로 매긴다. */
export function cashCostKrw(option: {
  normalizedCostKrw: number;
  timeCostKrw: number;
}): number {
  return option.normalizedCostKrw - option.timeCostKrw;
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

/** datetime-local 입력용 KST 값 (YYYY-MM-DDTHH:mm) */
export function toSeoulInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** datetime-local 값을 KST로 해석한다. */
export function fromSeoulInputValue(value: string): Date {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (!match) return new Date(NaN);
  return new Date(`${match[1]}:00+09:00`);
}
