import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 위경도를 국소 평면좌표(m)로 근사한다.
 * 수 km 규모의 투영·수선 계산에서는 오차가 무시할 수준이고,
 * 삼각함수 호출을 줄여 후보 수백 개를 훑을 때 훨씬 빠르다.
 */
function toLocalMeters(p: LatLng, originLat: number): { x: number; y: number } {
  return {
    x: p.lng * DEG * EARTH_RADIUS_M * Math.cos(originLat * DEG),
    y: p.lat * DEG * EARTH_RADIUS_M,
  };
}

/** 폴리라인의 각 정점까지의 누적 거리(m). 길이는 polyline과 같다. */
export function cumulativeDistances(polyline: LatLng[]): number[] {
  const out = new Array<number>(polyline.length);
  out[0] = 0;
  for (let i = 1; i < polyline.length; i += 1) {
    out[i] = out[i - 1] + haversineM(polyline[i - 1], polyline[i]);
  }
  return out;
}

export function polylineLengthM(polyline: LatLng[]): number {
  const cum = cumulativeDistances(polyline);
  return cum[cum.length - 1] ?? 0;
}

export interface Projection {
  /** 폴리라인 위의 가장 가까운 점 */
  point: LatLng;
  /** 그 점까지의 경로 누적 거리 (m) */
  alongM: number;
  /** 대상 점에서 폴리라인까지의 직선 거리 (m) */
  offsetM: number;
  /** 수선이 내려간 구간의 인덱스 (polyline[i] -> polyline[i+1]) */
  segmentIndex: number;
  /**
   * 진행 방향 기준 좌우 판별. 양수면 진행 방향의 왼쪽.
   * 한국은 우측통행이므로 왼쪽에 있는 주유소는 대체로 반대편 차선이다.
   */
  side: number;
}

/** 점을 폴리라인에 수선으로 투영한다. */
export function projectOntoPolyline(
  target: LatLng,
  polyline: LatLng[],
  cum: number[] = cumulativeDistances(polyline),
): Projection {
  const originLat = target.lat;
  const t = toLocalMeters(target, originLat);

  let best: Projection | null = null;

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = toLocalMeters(polyline[i], originLat);
    const b = toLocalMeters(polyline[i + 1], originLat);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq === 0) continue;

    let u = ((t.x - a.x) * abx + (t.y - a.y) * aby) / lenSq;
    u = Math.max(0, Math.min(1, u));

    const px = a.x + u * abx;
    const py = a.y + u * aby;
    const offsetM = Math.hypot(t.x - px, t.y - py);

    if (best && offsetM >= best.offsetM) continue;

    const segLenM = cum[i + 1] - cum[i];
    const cross = abx * (t.y - a.y) - aby * (t.x - a.x);

    best = {
      point: {
        lat: polyline[i].lat + u * (polyline[i + 1].lat - polyline[i].lat),
        lng: polyline[i].lng + u * (polyline[i + 1].lng - polyline[i].lng),
      },
      alongM: cum[i] + u * segLenM,
      offsetM,
      segmentIndex: i,
      side: Math.sign(cross),
    };
  }

  if (!best) {
    return {
      point: polyline[0],
      alongM: 0,
      offsetM: haversineM(target, polyline[0]),
      segmentIndex: 0,
      side: 0,
    };
  }
  return best;
}

/** 경로 시작점에서 distanceM 만큼 진행한 지점의 좌표. */
export function pointAtDistance(
  polyline: LatLng[],
  distanceM: number,
  cum: number[] = cumulativeDistances(polyline),
): LatLng {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, distanceM));
  for (let i = 0; i < polyline.length - 1; i += 1) {
    if (d <= cum[i + 1]) {
      const segLen = cum[i + 1] - cum[i];
      const u = segLen === 0 ? 0 : (d - cum[i]) / segLen;
      return {
        lat: polyline[i].lat + u * (polyline[i + 1].lat - polyline[i].lat),
        lng: polyline[i].lng + u * (polyline[i + 1].lng - polyline[i].lng),
      };
    }
  }
  return polyline[polyline.length - 1];
}

/**
 * 경로를 일정 간격으로 샘플링한다.
 *
 * 오피넷 `aroundAll.do`는 반경 최대 5km라서 경로 전체를 한 번에 덮을 수 없다.
 * 간격을 반경보다 촘촘하게 잡아야 원들이 겹쳐 사각지대가 생기지 않는다.
 */
export function sampleAlongRoute(
  polyline: LatLng[],
  intervalM: number,
  cum: number[] = cumulativeDistances(polyline),
): { point: LatLng; alongM: number }[] {
  const total = cum[cum.length - 1];
  const out: { point: LatLng; alongM: number }[] = [];
  for (let d = 0; d < total; d += intervalM) {
    out.push({ point: pointAtDistance(polyline, d, cum), alongM: d });
  }
  out.push({ point: polyline[polyline.length - 1], alongM: total });
  return out;
}

/**
 * 두 점을 잇는 완만한 곡선. 우회 구간을 지도에 그릴 때 직선보다 도로처럼 보인다.
 * 실제 경로 API를 붙이면 이 함수 대신 반환된 우회 구간 형상을 쓰면 된다.
 */
export function curveBetween(a: LatLng, b: LatLng, bulge = 0.18): LatLng[] {
  const mid = {
    lat: (a.lat + b.lat) / 2 - (b.lng - a.lng) * bulge,
    lng: (a.lng + b.lng) / 2 + (b.lat - a.lat) * bulge,
  };
  const out: LatLng[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const w0 = (1 - t) ** 2;
    const w1 = 2 * (1 - t) * t;
    const w2 = t * t;
    out.push({
      lat: w0 * a.lat + w1 * mid.lat + w2 * b.lat,
      lng: w0 * a.lng + w1 * mid.lng + w2 * b.lng,
    });
  }
  return out;
}
