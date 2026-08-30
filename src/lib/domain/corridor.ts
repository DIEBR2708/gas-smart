import { cumulativeDistances, haversineM, pointAtDistance } from "./geo";
import type { LatLng } from "./types";

/**
 * 경로 회랑 검색 계획.
 *
 * 반경 검색 API로 긴 경로를 덮으려면 경로를 여러 점으로 나눠 반복 호출해야
 * 한다. 이때 간격을 잘못 잡으면 인접한 두 원 사이의 "허리"에서 회랑 폭을
 * 다 덮지 못하고, 그 자리에 있는 주유소는 조용히 사라진다.
 *
 * 직선 구간이라면 조건이 간단하다. 반경 r인 원을 간격 s로 늘어놓았을 때
 * 두 원의 중간 지점에서 덮이는 최대 수직 거리는 sqrt(r^2 - (s/2)^2)이므로,
 * 회랑 반폭 w를 덮으려면 s <= 2*sqrt(r^2 - w^2)면 된다.
 *
 * 문제는 곡선이다. 꺾임각 theta인 정점 바깥쪽으로 w만큼 떨어진 지점은,
 * 정점에서 호길이 u만큼 떨어진 샘플로부터
 *   |ST|^2 = u^2 + w^2 + 2*u*w*sin(theta/2)
 * 만큼 떨어져 있다. 마지막 항이 곡선에서 커지는 벌점이다. u <= s/2를 넣고
 * |ST| <= r을 풀면
 *   s <= 2 * ( -w*sin(theta/2) + sqrt(w^2*sin^2(theta/2) + r^2 - w^2) )
 * 가 나온다. theta=0이면 직선 공식과 같아지고, theta=180도(유턴)면
 * 삼각부등식으로 얻는 가장 보수적인 한계 2*(r-w)로 수렴한다.
 *
 * 반경을 작게 잡을 이유는 없다. 호출 한 번의 비용은 반경과 무관하므로
 * 항상 API가 허용하는 최대 반경으로 요청하고, 원하는 회랑 폭에서 간격을
 * 역산하는 편이 호출 수도 적고 빈틈도 없다.
 */

/** 오피넷 `aroundAll.do`의 반경 상한 (m) */
export const STATION_SEARCH_MAX_RADIUS_M = 5000;

/**
 * 회랑 반폭은 검색 반경보다 이 비율까지만 허용한다.
 * 반폭이 반경과 같아지면 필요한 간격이 0으로 수렴해 어떤 간격으로도 덮을 수 없다.
 */
const MAX_HALF_WIDTH_RATIO = 0.9;

/**
 * 계산한 간격에 곱하는 안전 계수.
 * 위 식은 정점 하나를 가정한다. 한 구간 안에 꺾임이 여러 번 있으면 벌점이
 * 누적될 수 있어 여유를 둔다.
 */
const SAFETY_FACTOR = 0.9;

/** 너무 촘촘해져 호출이 폭발하지 않도록 두는 최소 간격 (m) */
const MIN_SAMPLE_INTERVAL_M = 600;

/**
 * 꺾임각을 잴 때 정점 양쪽에서 이 거리만큼 떨어진 점을 쓴다.
 * 카카오 경로는 수 미터마다 점이 찍혀 차선 흔들림이 90도로 보인다.
 * 실제 나들목은 이보다 훨씬 긴 구간에서 꺾이므로 덮는 폭은 그대로다.
 */
const TURN_LEG_M = 120;

export interface CorridorSearchPlan {
  /** 각 호출에 사용할 반경 (m) */
  searchRadiusM: number;
  /** 실제로 빈틈 없이 덮이는 회랑 반폭 (m) */
  coveredHalfWidthM: number;
  /** 경로 위 샘플 간격 (m) */
  intervalM: number;
  /** 예상 호출 횟수 */
  callCount: number;
  /** 요청한 회랑 반폭이 반경 상한 때문에 잘렸는가 */
  truncated: boolean;
  /** 계획에 반영한 경로 최대 꺾임각 (도) */
  maxTurnDeg: number;
}

function indexAtLeastM(
  cum: number[],
  fromIndex: number,
  direction: -1 | 1,
  minM: number,
): number {
  const start = cum[fromIndex] ?? 0;
  let i = fromIndex;
  while (i + direction >= 0 && i + direction < cum.length) {
    i += direction;
    if (Math.abs((cum[i] ?? 0) - start) >= minM) return i;
  }
  return i;
}

function turnAngleAtVertex(
  polyline: LatLng[],
  i: number,
  cum: number[],
): number {
  const prev = indexAtLeastM(cum, i, -1, TURN_LEG_M);
  const next = indexAtLeastM(cum, i, 1, TURN_LEG_M);
  if (prev === i || next === i) return 0;
  const a = polyline[prev];
  const b = polyline[i];
  const c = polyline[next];
  const ab = haversineM(a, b);
  const bc = haversineM(b, c);
  const ac = haversineM(a, c);
  if (ab === 0 || bc === 0) return 0;
  const cosInterior = (ab * ab + bc * bc - ac * ac) / (2 * ab * bc);
  const interior = Math.acos(Math.min(1, Math.max(-1, cosInterior)));
  return Math.PI - interior;
}

/** 폴리라인에서 가장 급한 꺾임각 (라디안). 직선이면 0. */
export function maxTurnAngleRad(polyline: LatLng[]): number {
  const cum = cumulativeDistances(polyline);
  let worst = 0;
  for (let i = 1; i < polyline.length - 1; i += 1) {
    worst = Math.max(worst, turnAngleAtVertex(polyline, i, cum));
  }
  return worst;
}

/** [fromM, toM] 구간의 정점 꺾임 중 가장 급한 각. */
export function maxTurnInRangeRad(
  polyline: LatLng[],
  fromM: number,
  toM: number,
  cum: number[] = cumulativeDistances(polyline),
): number {
  let worst = 0;
  for (let i = 1; i < polyline.length - 1; i += 1) {
    if (cum[i] < fromM || cum[i] > toM) continue;
    worst = Math.max(worst, turnAngleAtVertex(polyline, i, cum));
  }
  return worst;
}

/**
 * 회랑을 빈틈 없이 덮는 검색 중심점.
 *
 * 카카오 경로처럼 정점이 촘촘하면 램프 한 곳의 급커브가 경로 전체 간격을
 * 600m로 끌어내린다. 앞을 보고 그 구간의 꺾임만 반영하면 직선은 넓게,
 * 나들목만 촘촘히 친다. 덮는 폭은 그대로다.
 */
export function sampleCorridorCenters(
  polyline: LatLng[],
  halfWidthM: number,
  searchRadiusM: number = STATION_SEARCH_MAX_RADIUS_M,
): { point: LatLng; alongM: number }[] {
  if (polyline.length === 0) return [];
  const cum = cumulativeDistances(polyline);
  const total = cum[cum.length - 1] ?? 0;
  if (total <= 0) return [{ point: polyline[0], alongM: 0 }];

  const straightStep = corridorSampleIntervalM(searchRadiusM, halfWidthM, 0);
  const out: { point: LatLng; alongM: number }[] = [];
  let d = 0;
  while (d < total - 1) {
    out.push({ point: pointAtDistance(polyline, d, cum), alongM: d });
    const lookAheadTo = Math.min(total, d + straightStep);
    const localTurn = maxTurnInRangeRad(polyline, d, lookAheadTo, cum);
    const step = corridorSampleIntervalM(searchRadiusM, halfWidthM, localTurn);
    d += step;
  }
  const end = polyline[polyline.length - 1];
  const last = out[out.length - 1];
  if (!last || Math.abs(last.alongM - total) > 1) {
    out.push({ point: end, alongM: total });
  }
  return out;
}

/**
 * 회랑 반폭 halfWidthM을 빈틈 없이 덮는 샘플 간격 (m).
 * turnRad는 경로에서 가장 급한 꺾임각이다.
 */
export function corridorSampleIntervalM(
  searchRadiusM: number,
  halfWidthM: number,
  turnRad = 0,
): number {
  const w = Math.min(halfWidthM, searchRadiusM * MAX_HALF_WIDTH_RATIO);
  const bend = Math.sin(Math.min(Math.PI, Math.max(0, turnRad)) / 2);
  const inner = w * w * bend * bend + searchRadiusM * searchRadiusM - w * w;
  const raw = 2 * (-w * bend + Math.sqrt(Math.max(0, inner)));
  return Math.max(MIN_SAMPLE_INTERVAL_M, raw * SAFETY_FACTOR);
}

export function planCorridorSearch(
  polyline: LatLng[],
  requestedHalfWidthM: number,
  maxRadiusM: number = STATION_SEARCH_MAX_RADIUS_M,
): CorridorSearchPlan {
  const cum = cumulativeDistances(polyline);
  const routeDistanceM = cum[cum.length - 1] ?? 0;
  const searchRadiusM = maxRadiusM;
  const maxHalfWidthM = searchRadiusM * MAX_HALF_WIDTH_RATIO;
  const coveredHalfWidthM = Math.min(requestedHalfWidthM, maxHalfWidthM);
  const turnRad = maxTurnAngleRad(polyline);
  const intervalM = corridorSampleIntervalM(
    searchRadiusM,
    coveredHalfWidthM,
    turnRad,
  );
  const adaptiveCount = sampleCorridorCenters(
    polyline,
    coveredHalfWidthM,
    searchRadiusM,
  ).length;
  return {
    searchRadiusM,
    coveredHalfWidthM,
    intervalM,
    callCount: adaptiveCount,
    truncated: requestedHalfWidthM > maxHalfWidthM,
    maxTurnDeg: (turnRad * 180) / Math.PI,
  };
}
