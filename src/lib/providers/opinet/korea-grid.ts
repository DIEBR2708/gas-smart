import type { LatLng } from "@/lib/domain/types";

/**
 * 육지·제주만 대략 덮는 다각형. 서해 한가운데를 빼 오피넷 호출을 줄인다.
 * 검색 때 빠진 칸은 경로 샘플로 채운다.
 */
const MAINLAND_RING: LatLng[] = [
  { lat: 37.98, lng: 126.12 },
  { lat: 37.2, lng: 126.48 },
  { lat: 36.35, lng: 126.38 },
  { lat: 35.45, lng: 126.28 },
  { lat: 34.35, lng: 126.25 },
  { lat: 34.28, lng: 127.55 },
  { lat: 34.62, lng: 128.45 },
  { lat: 35.15, lng: 129.22 },
  { lat: 35.85, lng: 129.52 },
  { lat: 36.55, lng: 129.48 },
  { lat: 37.55, lng: 129.28 },
  { lat: 38.45, lng: 128.52 },
  { lat: 38.58, lng: 126.98 },
  { lat: 37.95, lng: 126.48 },
];

const JEJU_BOX = {
  minLat: 33.2,
  maxLat: 33.56,
  minLng: 126.14,
  maxLng: 126.97,
};

const ULLEUNG = { lat: 37.5, lng: 130.87 };

/** 격자 간격 (m). 5km 원으로 육지를 메울 때 사각형 대각선이 너무 벌어지지 않게. */
export const PREFETCH_STEP_M = 6_400;

function degLat(m: number): number {
  return m / 111_320;
}

function degLng(m: number, lat: number): number {
  return m / (111_320 * Math.cos((lat * Math.PI) / 180));
}

export function pointInRing(point: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const intersect =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng <
        ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPrefetchLand(point: LatLng): boolean {
  if (
    point.lat >= JEJU_BOX.minLat &&
    point.lat <= JEJU_BOX.maxLat &&
    point.lng >= JEJU_BOX.minLng &&
    point.lng <= JEJU_BOX.maxLng
  ) {
    return true;
  }
  if (
    Math.abs(point.lat - ULLEUNG.lat) < 0.08 &&
    Math.abs(point.lng - ULLEUNG.lng) < 0.1
  ) {
    return true;
  }
  return pointInRing(point, MAINLAND_RING);
}

/** 당일 백그라운드에서 훑을 검색 중심. */
export function koreaPrefetchCenters(): LatLng[] {
  const stepLat = degLat(PREFETCH_STEP_M);
  const out: LatLng[] = [];
  for (let lat = 33.15; lat <= 38.65; lat += stepLat) {
    const stepLng = degLng(PREFETCH_STEP_M, lat);
    for (let lng = 125.1; lng <= 131.1; lng += stepLng) {
      const point = { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
      if (isPrefetchLand(point)) out.push(point);
    }
  }
  return out;
}
