/**
 * 도메인 타입 정의.
 *
 * 이 프로젝트의 계산은 전부 "여행을 끝내는 데 드는 실질 총비용"을 기준으로 한다.
 * 리터당 표시가격은 비교 기준이 될 수 없다. 우회 연료, 시간, 통행료, 그리고
 * 도착 시 탱크에 남는 연료의 자산 가치까지 같은 단위(원)로 환산해야
 * 서로 다른 주유소를 공정하게 비교할 수 있다.
 */

export type FuelKind = "gasoline" | "premium" | "diesel" | "lpg";

export const FUEL_KIND_LABEL: Record<FuelKind, string> = {
  gasoline: "휘발유",
  premium: "고급휘발유",
  diesel: "경유",
  lpg: "자동차부탄(LPG)",
};

/** 오피넷 prodcd 코드 매핑 */
export const OPINET_PROD_CODE: Record<FuelKind, string> = {
  gasoline: "B027",
  premium: "B034",
  diesel: "D047",
  lpg: "K015",
};

export type Brand =
  | "SKE"
  | "GSC"
  | "HDO"
  | "SOL"
  | "RTE"
  | "RTX"
  | "NHO"
  | "ETC";

export const BRAND_LABEL: Record<Brand, string> = {
  SKE: "SK에너지",
  GSC: "GS칼텍스",
  HDO: "현대오일뱅크",
  SOL: "S-OIL",
  RTE: "자영알뜰",
  RTX: "고속도로알뜰",
  NHO: "농협알뜰",
  ETC: "자가상표",
};

export interface LatLng {
  lat: number;
  lng: number;
}

export interface NamedPlace extends LatLng {
  name: string;
  /** 도로명·지번. 검색 목록에 이름 아래로 보여 준다. */
  address?: string;
}

export interface Vehicle {
  fuelKind: FuelKind;
  /** 실주행 연비 (km/L). 공인연비가 아니라 사용자의 실측값을 기대한다. */
  kmPerLiter: number;
  /** 연료탱크 용량 (L) */
  tankCapacityL: number;
  /** 현재 연료량 (L) */
  currentFuelL: number;
  /**
   * 예비 연료 (L). 주유소에 도착할 때 이 선 아래로 내려가는 후보는 뺀다.
   * "필요한 만큼" 주입은 목적지에서 탱크의 20%를 남긴다.
   */
  reserveL: number;
}

export type FillPolicy =
  | { mode: "toDestination" }
  | { mode: "full" }
  | { mode: "fixedLiters"; liters: number }
  | { mode: "fixedBudget"; krw: number };

export interface Preferences {
  /**
   * 시간의 가치 (원/분). 우회로 늘어난 시간을 돈으로 환산하는 계수.
   * 0이면 "시간은 공짜"라는 뜻이고, 이 값이 커질수록 우회 추천이 줄어든다.
   */
  timeValueKrwPerMin: number;
  /** 제휴카드·멤버십의 리터당 정액 할인 (원/L) */
  cardDiscountKrwPerL: number;
  /** 결제수단 정률 할인 (0~1). 정액 할인 적용 후에 곱한다. */
  extraDiscountRate: number;
  /** 허용 최대 우회 거리 (km) */
  maxDetourKm: number;
  /** 허용 최대 우회 시간 (분) */
  maxDetourMin: number;
  fillPolicy: FillPolicy;
  /**
   * 추천으로 인정할 최소 순절감액 (원).
   * 모델 오차보다 작은 이득을 "절약"이라고 부르면 사용자를 속이는 것이다.
   */
  minMeaningfulSavingKrw: number;
  selfServiceOnly: boolean;
  /** 빈 배열이면 브랜드 제한 없음 */
  brands: Brand[];
  /** 고속도로 본선을 벗어나야 하는 주유소를 후보에서 제외 */
  avoidHighwayExit: boolean;
  /**
   * 카드·멤버십 할인 규칙. 브랜드가 비어 있으면 모든 주유소에 적용하고,
   * 지정되어 있으면 그 브랜드에서만 깎는다. 여러 규칙이 겹치면 정액은 더하고
   * 정률은 합성한다.
   */
  discountRules: DiscountRule[];
}

export interface DiscountRule {
  id: string;
  name: string;
  enabled: boolean;
  /** 리터당 정액 할인 (원/L) */
  flatKrwPerL: number;
  /** 정률 할인 (0~1) */
  rate: number;
  /** 빈 배열이면 모든 브랜드 */
  brands: Brand[];
}

export type ReportKind = "closed" | "price-mismatch" | "gone";

/** 사용자가 제보한 현장 정보. 기기 안에만 두고 서버에 계정으로 묶지 않는다. */
export interface StationReport {
  id: string;
  stationId: string;
  stationName: string;
  kind: ReportKind;
  note: string;
  reportedAt: string;
}

/** 연비 학습에 쓰는 주유 기록. 주행거리와 주입량만 있으면 된다. */
export interface FillRecord {
  id: string;
  at: string;
  kmDriven: number;
  liters: number;
}

export interface OpeningHours {
  /** 24시간 영업 */
  allDay: boolean;
  /** "06:00" 형식. allDay가 true면 무시된다. */
  open?: string;
  close?: string;
}

/**
 * 주유소가 본선 어느 쪽에 있는지.
 * 카카오 길찾기도 중앙분리대 유턴을 넣어 짧게 답하는 경우가 있어,
 * 힌트로 한 번 더 걸러 가짜 유턴을 나들목 회차로 바꾼다.
 */
export interface AccessHint {
  /** 진행 방향 기준 반대편 차선. 고속·자동차전용에서는 유턴이 아니라 나들목 회차 */
  oppositeSide: boolean;
  /** 고속도로 본선에서 진출해야 도달 가능 */
  requiresHighwayExit: boolean;
  /** 고속도로 본선상의 휴게소·졸음쉼터형 주유소 */
  onHighway: boolean;
}

export interface Station {
  id: string;
  name: string;
  brand: Brand;
  isSelfService: boolean;
  lat: number;
  lng: number;
  /** 유종별 표시가 (원/L). 미취급 유종은 키가 없다. */
  prices: Partial<Record<FuelKind, number>>;
  /** 가격 신고 시각 (ISO 8601). 신선도 경고의 근거. */
  priceUpdatedAt: string;
  openingHours: OpeningHours;
  address?: string;
  hasCarWash?: boolean;
  accessHint?: AccessHint;
}

export interface Route {
  id: string;
  origin: NamedPlace;
  destination: NamedPlace;
  /** 경로 형상. 인접한 점 사이는 직선으로 간주한다. */
  polyline: LatLng[];
  distanceM: number;
  durationS: number;
  tollKrw: number;
  /** 경로 요약 라벨 (예: "경부고속도로") */
  summary?: string;
  /**
   * 소요시간에 시간대별 정체가 이미 들어 있는가.
   * 카카오 미래운행정보 길찾기를 썼을 때 true. 휴리스틱 정체 배수를 또 곱하면
   * 이중 계상이 된다.
   */
  durationIncludesTraffic?: boolean;
  /**
   * 자동차로 갈 수 있는 경로인가.
   * false면 출발·도착 표시만 하고 선을 잇지 않는다.
   */
  driveable?: boolean;
  /**
   * 사용자가 고른 지점을 그대로 쓰지 못해 옮겼을 때의 설명.
   * 산 정상처럼 도로와 이어지지 않은 좌표는 가장 가까운 차량 진입 지점으로 옮긴다.
   */
  adjustedNote?: string;
}

export type DetourSource = "routing-api" | "geometric-estimate";

/** 기본 경로 대비 특정 주유소를 경유했을 때의 증분. */
export interface Detour {
  extraDistanceM: number;
  extraDurationS: number;
  extraTollKrw: number;
  /** 출발지에서 주유소 진입 지점까지의 본선 주행거리 (m) */
  alongRouteM: number;
  /** 주유소에서 본선까지의 직선 이탈 거리 (m). 표시·정렬용. */
  offRouteM: number;
  /** 본선 진입 지점 좌표. 지도에 우회 구간을 그릴 때 쓴다. */
  joinPoint: LatLng;
  source: DetourSource;
  /** 출발→주유소→도착 실도로(또는 근사) 형상. 선택 시 본선 대신 그린다. */
  viaPolyline?: LatLng[];
}

export type WarningCode =
  | "unreachable"
  | "low-margin-on-arrival"
  | "tank-capped"
  | "insufficient-to-destination"
  | "stale-price"
  | "closed-on-arrival"
  | "opposite-side"
  | "highway-exit"
  | "estimated-detour"
  | "user-reported"
  | "congested";

export interface Warning {
  code: WarningCode;
  message: string;
  severity: "info" | "warn" | "error";
}

/** 한 주유소에 대한 완전한 비용 평가 결과. */
export interface RefuelOption {
  station: Station;
  detour: Detour;

  /** 오피넷 표시가 (원/L) */
  listPriceKrwPerL: number;
  /** 할인 적용 후 실제 지불 단가 (원/L) */
  effectivePriceKrwPerL: number;

  /** 주유소 펌프 앞에 도착한 시점의 잔여 연료 (L) */
  fuelOnArrivalL: number;
  /** 현재 연료로 이 주유소까지 갈 수 있는가 */
  reachable: boolean;

  /** 실제로 주입하는 양 (L) */
  litersToBuy: number;
  /** 탱크 용량 때문에 원하는 양보다 적게 넣었는가 */
  tankCapped: boolean;
  /** 우회 때문에 추가로 태우는 연료 (L) */
  detourFuelL: number;
  /** 목적지 도착 시 잔여 연료 (L) */
  fuelAtDestinationL: number;
  /** 안전 예비량을 초과해 남는 연료 (L) — 자산으로 환산해 상계한다 */
  surplusFuelL: number;
  /**
   * 예비량을 채우지 못해 부족한 연료 (L).
   * 예산·탱크 제약으로 조금만 넣은 경우 발생한다. 어차피 나중에 사야 하므로
   * 경로 주변 시세로 값을 매겨 비용에 더해야 비교가 공정해진다.
   */
  shortfallFuelL: number;

  /** 실제 카드 결제액 (원) */
  outOfPocketKrw: number;
  /** 그중 우회 주행에 태워 없어지는 몫 (원). 정보성 표시용. */
  detourFuelCostKrw: number;
  /** 우회 시간의 기회비용 (원) */
  timeCostKrw: number;
  /** 기본 경로 대비 통행료 증분 (원) */
  tollDeltaKrw: number;
  /** 남는 연료를 경로 주변 시세로 환산한 크레딧 (원) */
  surplusCreditKrw: number;
  /** 부족분을 나중에 시세로 사야 하는 비용 (원) */
  shortfallCostKrw: number;

  /**
   * 정규화 총비용 (원).
   * outOfPocket + 시간 + 통행료 + 부족분 - 남는연료가치.
   * 모든 후보를 "도착 시 예비량만 남긴 상태"로 맞춘 뒤 비교하기 위한 값이다.
   */
  normalizedCostKrw: number;
  /** 이번 여행에서 실제로 소비되는 1L당 실질 단가 (원/L) */
  krwPerUsefulLiter: number;

  warnings: Warning[];
}

export interface RankedOption extends RefuelOption {
  /** 기준선 대비 절감액 (원). 음수면 손해. */
  savingKrw: number;
  /**
   * 비관 시나리오(연비 -15%, 대상 가격 +25원/L, 우회거리 +25%)에서의 절감액.
   * 이 값이 0 이하면 절감이 모델 오차에 묻힌다는 뜻이다.
   */
  savingPessimisticKrw: number;
  /**
   * 이 주유소가 기준선을 계속 이기려면 우회가 최대 몇 km까지 가능한지.
   * 사용자에게 "왜 이 정도 가격차는 우회할 가치가 없는지"를 설명하는 숫자.
   */
  breakEvenDetourKm: number;
  /**
   * 절감액 중 "이번 여행에 쓰지 않고 탱크에 채워둔 싼 연료"에서 나온 몫 (원).
   *
   * 가득 주유에서는 절감액의 상당 부분이 가격차가 아니라 물량에서 나온다.
   * 나중에 쓸 연료를 싸게 선구매한 것이니 실제 이득이 맞지만, 지금 당장
   * 지갑에서 덜 나가는 돈은 아니다. 섞어서 보여주면 과장이 된다.
   */
  stockUpValueKrw: number;
  rank: number;
}

export type Verdict =
  /** 우회해서 특정 주유소로 가는 편이 분명히 이득 */
  | "detour-worth-it"
  /** 이득이 있긴 하지만 모델 오차 범위에 묻힌다 */
  | "marginal"
  /** 우회할 이유가 없다. 가장 가까운 곳에서 넣는 게 낫다. */
  | "stay-on-route"
  /** 후보가 없다 */
  | "no-candidates"
  /** 이번 구간은 주유가 아예 필요 없다 */
  | "no-refuel-needed"
  /** 탱크 하나로 목적지까지 못 가 두 번 이상 넣어야 한다 */
  | "multi-stop";

export interface RefuelPlan {
  route: Route;
  vehicle: Vehicle;
  preferences: Preferences;
  /** 목적지 없이 지금 자리 주변만 볼 때 */
  nearby?: boolean;
  /** 우회 없이 그대로 갔을 때 필요한 최소 주유량 (L) */
  litersRequiredWithoutDetour: number;
  /** 무주유로 목적지까지 도달 가능한가 (예비량 포함) */
  canReachWithoutRefueling: boolean;
  /** 경로 주변 시세 중위값 (원/L). 남는 연료 환산과 기준선 계산에 쓴다. */
  referencePriceKrwPerL: number;
  /** "그냥 지나가다 가장 가까운 곳에서 넣기" 시나리오 */
  baseline: RankedOption | null;
  best: RankedOption | null;
  options: RankedOption[];
  /** 도달 불가·시간초과 등으로 제외된 후보와 이유 */
  excluded: { station: Station; reason: string }[];
  verdict: Verdict;
  /** 사용자에게 보여줄 한 줄 결론 */
  headline: string;
  /**
   * 탱크 제약 때문에 두 번 이상 넣어야 할 때의 방문 순서.
   * 한 번으로 충분하면 최적안 하나만 들어 있다. 비어 있으면 주유 불가다.
   */
  itinerary: ItineraryStop[];
  meta: PlanMeta;
}

export interface ItineraryStop {
  option: RankedOption;
  /** 이 정류에서 실제로 넣는 양. 중간 정류는 '다음까지 갈 만큼'일 수 있다. */
  litersToBuy: number;
  /** full = 가득, enough = 다음 싼 곳까지, last = 사용자 정책 */
  fillReason: "enough-for-next" | "fill-full" | "last-stop" | "only-stop";
  outOfPocketKrw: number;
  fuelOnArrivalL: number;
  fuelOnDepartL: number;
}

/**
 * 이 계획이 무엇을 봤고 무엇을 보지 않았는지.
 *
 * "빠진 주유소는 없나"라는 질문에 답할 수 있어야 한다. 조회 범위와 계산
 * 범위를 숨기면 사용자는 결과를 전수 비교로 오해한다.
 */
export interface PlanMeta {
  stationProvider: string;
  routeProvider: string;
  detourSource: DetourSource;
  computedAt: string;

  /** 회랑 안에서 조회된 주유소 수 */
  candidateCount: number;
  /** 실제 우회 경로까지 정밀 계산한 주유소 수 */
  exactlyEvaluated: number;

  /** 빈틈 없이 덮은 회랑 반폭 (m) */
  corridorHalfWidthM: number;
  /** 사용자의 우회 허용치가 요구하는 회랑 반폭 (m) */
  requestedHalfWidthM: number;
  /** 반경 상한 때문에 회랑이 잘렸는가 */
  corridorTruncated: boolean;
  /** 각 반경 검색에 사용한 반경 (m) */
  searchRadiusM: number;
  /** 경로를 덮는 데 필요한 반경 검색 호출 횟수 */
  searchCallCount: number;

  /**
   * 정밀 계산에서 제외한 후보가 최적안을 이길 수 없음을 증명했는가.
   *
   * false면 쿼터 상한에 걸려 계산을 멈춘 것이고, 보지 않은 후보 중에 더
   * 나은 것이 있을 수 있다. 이 경우 화면에 반드시 알려야 한다.
   */
  optimalityGuaranteed: boolean;
}
