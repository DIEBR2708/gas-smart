import { haversineM } from "./geo";
import type { LatLng } from "./types";

/**
 * 한국에서 자동차 도로로 이어지지 않은 권역.
 * 연륙교가 있는 거제·남해·진도·완도·강화·영종은 육지로 본다.
 * 제주·울릉·백령처럼 배로만 가는 곳은 따로 둔다.
 */

export type DrivingRegion =
  | "mainland"
  | "jeju"
  | "udo"
  | "marado"
  | "chuja"
  | "ulleung"
  | "dokdo"
  | "baengnyeong"
  | "daecheong"
  | "yeonpyeong"
  | "heuksan"
  | "hongdo"
  | "geomun"
  | "tsushima"
  | "water";

interface Box {
  id: Exclude<DrivingRegion, "mainland" | "water">;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** 좁은 섬을 먼저 본다. 제주 박스 안의 우도·마라도가 묻히지 않게. */
const ISLANDS: Box[] = [
  { id: "dokdo", minLat: 37.236, maxLat: 37.25, minLng: 131.86, maxLng: 131.88 },
  { id: "ulleung", minLat: 37.45, maxLat: 37.56, minLng: 130.78, maxLng: 130.95 },
  { id: "baengnyeong", minLat: 37.9, maxLat: 38.03, minLng: 124.6, maxLng: 124.8 },
  { id: "daecheong", minLat: 37.8, maxLat: 37.86, minLng: 124.68, maxLng: 124.78 },
  { id: "yeonpyeong", minLat: 37.64, maxLat: 37.71, minLng: 125.68, maxLng: 125.76 },
  { id: "hongdo", minLat: 34.66, maxLat: 34.72, minLng: 125.17, maxLng: 125.22 },
  { id: "heuksan", minLat: 34.64, maxLat: 34.73, minLng: 125.38, maxLng: 125.48 },
  { id: "geomun", minLat: 34.0, maxLat: 34.08, minLng: 127.26, maxLng: 127.35 },
  { id: "chuja", minLat: 33.9, maxLat: 34.03, minLng: 126.28, maxLng: 126.38 },
  { id: "marado", minLat: 33.1, maxLat: 33.135, minLng: 126.25, maxLng: 126.29 },
  { id: "udo", minLat: 33.49, maxLat: 33.525, minLng: 126.945, maxLng: 126.98 },
  { id: "jeju", minLat: 33.19, maxLat: 33.58, minLng: 126.14, maxLng: 126.97 },
  { id: "tsushima", minLat: 34.02, maxLat: 34.72, minLng: 129.16, maxLng: 129.52 },
];

const JEJU_FAMILY = new Set<DrivingRegion>(["jeju", "udo", "marado", "chuja"]);
const EAST_ISLANDS = new Set<DrivingRegion>(["ulleung", "dokdo"]);

export const UNREACHABLE_BY_CAR_CODE = "UNREACHABLE_BY_CAR";

function inBox(p: LatLng, box: Box): boolean {
  return (
    p.lat >= box.minLat &&
    p.lat <= box.maxLat &&
    p.lng >= box.minLng &&
    p.lng <= box.maxLng
  );
}

function islandAt(p: LatLng): Box["id"] | null {
  for (const box of ISLANDS) {
    if (inBox(p, box)) return box.id;
  }
  return null;
}

/** 제주해협·울릉 앞바다처럼 도로가 없는 수역. 연안 도로는 넣지 않는다. */
function inKnownStrait(p: LatLng): boolean {
  if (islandAt(p)) return false;
  // 제주 북단(33.56) ~ 해남·완도 남쪽(34.22) 사이
  if (p.lat >= 33.56 && p.lat <= 34.22 && p.lng >= 125.85 && p.lng <= 127.95) {
    return true;
  }
  // 동해 울릉 접근 수역
  if (p.lat >= 36.6 && p.lat <= 37.8 && p.lng >= 130.15 && p.lng <= 131.7) {
    return true;
  }
  return false;
}

function inMainland(p: LatLng): boolean {
  if (p.lat < 34.27 || p.lat > 38.65) return false;
  if (p.lng < 125.05 || p.lng > 129.58) return false;
  return true;
}

export function drivingRegion(point: LatLng): DrivingRegion {
  const island = islandAt(point);
  if (island) return island;
  if (inKnownStrait(point)) return "water";
  if (inMainland(point)) return "mainland";
  return "water";
}

export function carUnreachableReason(
  origin: LatLng,
  destination: LatLng,
): string | null {
  const from = drivingRegion(origin);
  const to = drivingRegion(destination);
  if (from === to && from !== "water") return null;
  if (from === "water" || to === "water") {
    return "출발지나 도착지가 바다 위입니다. 육지의 지점을 골라 주세요.";
  }
  if (JEJU_FAMILY.has(from) || JEJU_FAMILY.has(to)) {
    return "제주도는 배로만 갈 수 있습니다. 자동차 경로는 만들지 않습니다.";
  }
  if (EAST_ISLANDS.has(from) || EAST_ISLANDS.has(to)) {
    return "울릉도·독도는 자동차 도로로 이어지지 않습니다.";
  }
  return "출발과 도착이 바다로 나뉘어 자동차로는 갈 수 없습니다.";
}

/**
 * 카카오가 페리 구간을 넣거나, 직선 근사가 해협을 가로지른 경우.
 * 육지 고속도로는 정점이 수십 km 떨어져도 수역을 지나지 않으므로 통과시킨다.
 */
export function polylineUnreachableReason(polyline: LatLng[]): string | null {
  if (polyline.length < 2) return null;
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  const ends = carUnreachableReason(first, last);
  if (ends) return ends;

  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    if (drivingRegion(a) === "water" || drivingRegion(b) === "water") {
      return "이 경로는 바다를 가로지릅니다. 자동차로는 갈 수 없습니다.";
    }
    const span = haversineM(a, b);
    if (span >= 8_000 && drivingRegion(mid) === "water") {
      return "이 경로는 바다를 가로지릅니다. 자동차로는 갈 수 없습니다.";
    }
  }
  return null;
}

export function isUnreachableByCarMessage(message: string): boolean {
  return (
    message.includes("배로만") ||
    message.includes("바다로 나뉘") ||
    message.includes("바다 위") ||
    message.includes("바다를 가로지") ||
    message.includes("자동차 도로로 이어지지")
  );
}
