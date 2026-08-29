import { cumulativeDistances, pointAtDistance } from "@/lib/domain/geo";
import type { Brand, FuelKind, Route, Station } from "@/lib/domain/types";
import { BRAND_LABEL } from "@/lib/domain/types";
import { SAMPLE_ROUTE_SEEDS, type SampleRouteSeed } from "./sample-routes";

/**
 * 샘플 주유소 생성기.
 *
 * 실제 주유소가 아니라, 오피넷 응답의 통계적 성질(브랜드별 가격대, 셀프 할인,
 * 고속도로 프리미엄, 알뜰주유소, 신고 시각의 편차)을 흉내낸 결정론적 합성
 * 데이터다. 시드가 고정이라 매번 같은 결과가 나오고, 따라서 화면과 테스트가
 * 재현 가능하다.
 *
 * 오피넷 인증키를 넣으면 OpinetStationProvider가 이 데이터를 대체한다.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2026년 상반기 전국 평균 수준을 가정한 기준가 (원/L) */
const BASE_PRICE: Record<FuelKind, number> = {
  gasoline: 1687,
  premium: 1974,
  diesel: 1561,
  lpg: 1118,
};

/** 브랜드별 리터당 가격 성향 (원/L) */
const BRAND_PRICE_DELTA: Record<Brand, number> = {
  SKE: 28,
  GSC: 20,
  HDO: -4,
  SOL: 10,
  RTE: -46,
  RTX: 42,
  NHO: -38,
  ETC: -28,
};

const BRAND_POOL: Brand[] = [
  "SKE",
  "SKE",
  "GSC",
  "GSC",
  "HDO",
  "SOL",
  "RTE",
  "NHO",
  "ETC",
];

const NAME_SUFFIX = ["주유소", "셀프주유소", "직영주유소", "에너지", "오일"];

/** 수도권은 임대료 탓에 비싸고, 지방 국도변은 싸다. 위도로 아주 거칠게 근사. */
function regionAdjustment(lat: number): number {
  if (lat > 37.4) return 46;
  if (lat > 37.0) return 18;
  if (lat > 36.6) return -6;
  return -22;
}

interface GenerateOptions {
  /** 주유소를 배치할 간격 (m) */
  spacingM: number;
}

function generateForSeed(
  seed: SampleRouteSeed,
  options: GenerateOptions,
  now: Date,
): Station[] {
  const polyline = seed.waypoints.map(({ lat, lng }) => ({ lat, lng }));
  const cum = cumulativeDistances(polyline);
  const totalM = cum[cum.length - 1];

  // 경로 id에서 안정적인 정수 시드를 만든다.
  let hash = 2166136261;
  for (const ch of seed.id) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  }
  const rand = mulberry32(hash);

  const stations: Station[] = [];
  let index = 0;

  for (
    let alongM = options.spacingM * 0.6;
    alongM < totalM - 800;
    alongM += options.spacingM * (0.72 + rand() * 0.62)
  ) {
    index += 1;
    const anchor = pointAtDistance(polyline, alongM, cum);
    const next = pointAtDistance(polyline, Math.min(totalM, alongM + 300), cum);

    // 진행 방향에 수직인 단위 벡터 (위경도 스케일 보정 포함)
    const latScale = 1 / 111_320;
    const lngScale = 1 / (111_320 * Math.cos((anchor.lat * Math.PI) / 180));
    const dLat = next.lat - anchor.lat;
    const dLng = next.lng - anchor.lng;
    const norm = Math.hypot(dLat / latScale, dLng / lngScale) || 1;
    // 좌측 법선. 한국은 우측통행이므로 좌측은 반대편 차선이다.
    const nLat = (-dLng / lngScale / norm) * latScale;
    const nLng = (dLat / latScale / norm) * lngScale;

    const onLeft = rand() < 0.45;
    const roll = rand();
    // 대부분은 도로에 붙어 있고, 일부는 한참 안쪽에 있다.
    const offsetM =
      roll < 0.35
        ? 90 + rand() * 260
        : roll < 0.75
          ? 400 + rand() * 1400
          : 1900 + rand() * 2400;

    const signed = onLeft ? offsetM : -offsetM;
    const lat = anchor.lat + nLat * signed;
    const lng = anchor.lng + nLng * signed;

    const isRestArea = seed.highway && offsetM < 320 && rand() < 0.42;
    const requiresHighwayExit = seed.highway && !isRestArea && offsetM > 500;
    const brand: Brand = isRestArea
      ? "RTX"
      : BRAND_POOL[Math.floor(rand() * BRAND_POOL.length)];
    const isSelfService = isRestArea ? false : rand() < 0.62;

    const nearestName =
      seed.waypoints.reduce<{ name: string; d: number }>(
        (acc, wp) => {
          if (!wp.name) return acc;
          const d = Math.hypot(wp.lat - lat, wp.lng - lng);
          return d < acc.d ? { name: wp.name, d } : acc;
        },
        { name: seed.summary, d: Number.POSITIVE_INFINITY },
      ).name;

    const region = regionAdjustment(lat);
    const highwayPremium = isRestArea ? 118 : 0;
    const selfDiscount = isSelfService ? -38 : 22;
    const noise = Math.round((rand() - 0.5) * 88);

    const priceFor = (kind: FuelKind) =>
      Math.round(
        BASE_PRICE[kind] +
          BRAND_PRICE_DELTA[brand] +
          region +
          highwayPremium +
          selfDiscount +
          noise +
          (rand() - 0.5) * 12,
      );

    const prices: Partial<Record<FuelKind, number>> = {
      gasoline: priceFor("gasoline"),
      diesel: priceFor("diesel"),
    };
    if (rand() < 0.45) prices.premium = priceFor("premium");
    if (rand() < 0.3 && !isRestArea) prices.lpg = priceFor("lpg");

    // 가격 신고 시각. 대부분 하루 안쪽이지만 며칠 묵은 곳도 섞여 있다.
    const staleRoll = rand();
    const ageH = staleRoll < 0.7 ? rand() * 14 : 40 + rand() * 90;

    const allDay = isRestArea || rand() < 0.45;
    const eveningClose = rand() < 0.5 ? "22:00" : "23:30";

    stations.push({
      id: `${seed.id}-${String(index).padStart(3, "0")}`,
      name: `${BRAND_LABEL[brand]} ${nearestName}${isRestArea ? "휴게소" : ""}${
        isRestArea ? "주유소" : NAME_SUFFIX[Math.floor(rand() * NAME_SUFFIX.length)]
      }`,
      brand,
      isSelfService,
      lat,
      lng,
      prices,
      priceUpdatedAt: new Date(now.getTime() - ageH * 3_600_000).toISOString(),
      openingHours: allDay
        ? { allDay: true }
        : { allDay: false, open: "06:00", close: eveningClose },
      address: `${nearestName} 인근 (샘플 데이터)`,
      hasCarWash: rand() < 0.35,
      accessHint: {
        oppositeSide: onLeft,
        requiresHighwayExit,
        onHighway: isRestArea,
      },
    });
  }

  return stations;
}

let cache: { key: string; stations: Station[] } | null = null;

/**
 * 샘플 주유소 전체 목록.
 * 가격 신고 시각을 "지금" 기준으로 만들기 때문에 시간 단위로 캐시를 갱신한다.
 */
export function getSampleStations(now = new Date()): Station[] {
  const key = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  if (cache?.key === key) return cache.stations;

  const stations = SAMPLE_ROUTE_SEEDS.flatMap((seed) =>
    generateForSeed(seed, { spacingM: seed.highway ? 4200 : 3000 }, now),
  );
  cache = { key, stations };
  return stations;
}

/**
 * 사용자가 고른 임의 경로 위에 합성 주유소를 깐다.
 * 오피넷 키가 없을 때 주소 검색으로 만든 경로가 빈 회랑이 되지 않게 한다.
 */
export function getStationsForRoute(route: Route, now = new Date()): Station[] {
  const sampleIds = new Set(SAMPLE_ROUTE_SEEDS.map((seed) => seed.id));
  if (sampleIds.has(route.id)) return [];
  return generateForSeed(
    {
      id: route.id.replace(/[^a-zA-Z0-9가-힣_-]/g, "").slice(0, 40) || "custom",
      originName: route.origin.name,
      destinationName: route.destination.name,
      summary: route.summary ?? "사용자 경로",
      highway: Boolean(route.summary?.includes("고속")),
      avgSpeedKmh: 70,
      tollKrw: 0,
      waypoints: route.polyline.map((p, i) => ({
        ...p,
        name:
          i === 0
            ? route.origin.name
            : i === route.polyline.length - 1
              ? route.destination.name
              : undefined,
      })),
    },
    { spacingM: 3600 },
    now,
  );
}
