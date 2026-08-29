import { polylineLengthM } from "@/lib/domain/geo";
import type { LatLng, Route } from "@/lib/domain/types";

/**
 * 샘플 경로.
 *
 * 실제 고속도로·간선도로를 따라가는 좌표를 손으로 찍은 근사 형상이다.
 * 카카오모빌리티 길찾기 API 키가 있으면 KakaoRouteProvider가 이 자리를 대신한다.
 */

export interface NamedWaypoint extends LatLng {
  /** 인근 지명. 샘플 주유소 이름을 만들 때 쓴다. */
  name?: string;
}

export interface SampleRouteSeed {
  id: string;
  originName: string;
  destinationName: string;
  summary: string;
  /** 고속도로 위주 경로인지. 진출입 램프 비용 모델링에 쓴다. */
  highway: boolean;
  /** 평균 주행 속도 가정 (km/h) */
  avgSpeedKmh: number;
  tollKrw: number;
  waypoints: NamedWaypoint[];
}

export const SAMPLE_ROUTE_SEEDS: SampleRouteSeed[] = [
  {
    id: "seoul-daejeon",
    originName: "서울시청",
    destinationName: "대전시청",
    summary: "경부고속도로",
    highway: true,
    avgSpeedKmh: 76,
    tollKrw: 8100,
    waypoints: [
      { lat: 37.5663, lng: 126.9779, name: "서울시청" },
      { lat: 37.5253, lng: 127.0104, name: "한남대교" },
      { lat: 37.484, lng: 127.043, name: "양재" },
      { lat: 37.4402, lng: 127.0684, name: "청계산" },
      { lat: 37.3948, lng: 127.1112, name: "판교" },
      { lat: 37.3316, lng: 127.1078, name: "수원신갈" },
      { lat: 37.286, lng: 127.094, name: "신갈" },
      { lat: 37.24, lng: 127.114, name: "기흥" },
      { lat: 37.1874, lng: 127.0862, name: "동탄" },
      { lat: 37.145, lng: 127.07, name: "오산" },
      { lat: 37.0765, lng: 127.1149, name: "안성맞춤" },
      { lat: 36.99, lng: 127.19, name: "안성" },
      { lat: 36.8988, lng: 127.1445, name: "입장" },
      { lat: 36.81, lng: 127.16, name: "천안" },
      { lat: 36.7605, lng: 127.2088, name: "목천" },
      { lat: 36.6712, lng: 127.2937, name: "청주" },
      { lat: 36.5808, lng: 127.3611, name: "남이" },
      { lat: 36.485, lng: 127.4102, name: "신탄진" },
      { lat: 36.4064, lng: 127.4288, name: "회덕" },
      { lat: 36.3504, lng: 127.3845, name: "대전시청" },
    ],
  },
  {
    id: "gangnam-incheon-airport",
    originName: "강남역",
    destinationName: "인천공항 제1터미널",
    summary: "올림픽대로 · 인천국제공항고속도로",
    highway: true,
    avgSpeedKmh: 58,
    tollKrw: 7400,
    waypoints: [
      { lat: 37.4979, lng: 127.0276, name: "강남역" },
      { lat: 37.5089, lng: 126.9954, name: "반포" },
      { lat: 37.5205, lng: 126.9576, name: "동작" },
      { lat: 37.5252, lng: 126.9246, name: "여의도" },
      { lat: 37.5361, lng: 126.8877, name: "양화" },
      { lat: 37.5487, lng: 126.8511, name: "가양" },
      { lat: 37.559, lng: 126.8014, name: "김포공항" },
      { lat: 37.5498, lng: 126.7205, name: "북인천" },
      { lat: 37.5349, lng: 126.64, name: "청라" },
      { lat: 37.523, lng: 126.5752, name: "영종대교" },
      { lat: 37.4934, lng: 126.5149, name: "공항신도시" },
      { lat: 37.4491, lng: 126.451, name: "인천공항 제1터미널" },
    ],
  },
  {
    id: "suwon-gangneung",
    originName: "수원역",
    destinationName: "강릉역",
    summary: "영동고속도로",
    highway: true,
    avgSpeedKmh: 82,
    tollKrw: 15200,
    waypoints: [
      { lat: 37.2659, lng: 126.9999, name: "수원역" },
      { lat: 37.2861, lng: 127.0562, name: "영통" },
      { lat: 37.286, lng: 127.094, name: "신갈" },
      { lat: 37.2874, lng: 127.2103, name: "용인" },
      { lat: 37.3352, lng: 127.3402, name: "곤지암" },
      { lat: 37.2905, lng: 127.4405, name: "이천" },
      { lat: 37.3101, lng: 127.6103, name: "여주" },
      { lat: 37.3208, lng: 127.8302, name: "문막" },
      { lat: 37.3504, lng: 127.9506, name: "원주" },
      { lat: 37.4205, lng: 128.0803, name: "새말" },
      { lat: 37.4602, lng: 128.2301, name: "둔내" },
      { lat: 37.5504, lng: 128.3805, name: "면온" },
      { lat: 37.6402, lng: 128.5502, name: "진부" },
      { lat: 37.6903, lng: 128.7503, name: "대관령" },
      { lat: 37.7305, lng: 128.8503, name: "강릉" },
      { lat: 37.7644, lng: 128.8987, name: "강릉역" },
    ],
  },
];

export function seedToRoute(seed: SampleRouteSeed): Route {
  const polyline: LatLng[] = seed.waypoints.map(({ lat, lng }) => ({ lat, lng }));
  const distanceM = polylineLengthM(polyline);
  return {
    id: seed.id,
    origin: { ...seed.waypoints[0], name: seed.originName },
    destination: {
      ...seed.waypoints[seed.waypoints.length - 1],
      name: seed.destinationName,
    },
    polyline,
    distanceM,
    durationS: (distanceM / 1000 / seed.avgSpeedKmh) * 3600,
    tollKrw: seed.tollKrw,
    summary: seed.summary,
  };
}

export const SAMPLE_ROUTES: Route[] = SAMPLE_ROUTE_SEEDS.map(seedToRoute);

export function getSampleRoute(id: string): Route | undefined {
  return SAMPLE_ROUTES.find((r) => r.id === id);
}

export function getSampleRouteSeed(id: string): SampleRouteSeed | undefined {
  return SAMPLE_ROUTE_SEEDS.find((r) => r.id === id);
}
