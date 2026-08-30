import type {
  Detour,
  Preferences,
  Route,
  Station,
  Vehicle,
} from "./types";

/** 테스트와 초기 화면에서 공용으로 쓰는 기본값. */

export const DEFAULT_VEHICLE: Vehicle = {
  fuelKind: "gasoline",
  kmPerLiter: 11.5,
  tankCapacityL: 60,
  currentFuelL: 9,
  reserveL: 5,
};

export const DEFAULT_PREFERENCES: Preferences = {
  timeValueKrwPerMin: 150,
  cardDiscountKrwPerL: 60,
  extraDiscountRate: 0,
  maxDetourKm: 8,
  maxDetourMin: 15,
  // 실제 운전자 대부분은 가득 채운다. 기본값이 현실과 달라야 할 이유가 없다.
  fillPolicy: { mode: "full" },
  minMeaningfulSavingKrw: 500,
  selfServiceOnly: false,
  brands: [],
  avoidHighwayExit: false,
  discountRules: [],
};

/** 테스트용 단순 직선 경로. 정확히 100km. */
export function straightRoute(distanceKm = 100): Route {
  const degPerKm = 1 / 111.32;
  return {
    id: "test-straight",
    origin: { lat: 36, lng: 127, name: "출발" },
    destination: { lat: 36 + distanceKm * degPerKm, lng: 127, name: "도착" },
    polyline: [
      { lat: 36, lng: 127 },
      { lat: 36 + distanceKm * degPerKm, lng: 127 },
    ],
    distanceM: distanceKm * 1000,
    durationS: (distanceKm / 80) * 3600,
    tollKrw: 0,
    summary: "테스트 경로",
  };
}

export function testStation(overrides: Partial<Station> = {}): Station {
  return {
    id: "s1",
    name: "테스트주유소",
    brand: "SKE",
    isSelfService: true,
    lat: 36.2,
    lng: 127.01,
    prices: { gasoline: 1700, diesel: 1560 },
    priceUpdatedAt: new Date("2026-08-29T00:00:00Z").toISOString(),
    openingHours: { allDay: true },
    ...overrides,
  };
}

export function testDetour(overrides: Partial<Detour> = {}): Detour {
  return {
    extraDistanceM: 0,
    extraDurationS: 0,
    extraTollKrw: 0,
    alongRouteM: 40_000,
    offRouteM: 0,
    joinPoint: { lat: 36.36, lng: 127 },
    source: "routing-api",
    ...overrides,
  };
}
