import type { NamedPlace } from "@/lib/domain/types";

/**
 * 키 없이도 주소 검색이 동작하게 하는 지명 사전.
 * 카카오 로컬 API 키가 있으면 /api/places가 정확·접두 일치를 이 목록에서
 * 먼저 붙이고, 나머지 검색 결과 뒤에 다시 붙인다.
 */

type GazetteerEntry = NamedPlace & { aliases: string[] };

export const PLACE_GAZETTEER: GazetteerEntry[] = [
  { name: "서울시청", lat: 37.5663, lng: 126.9779, address: "서울 중구 세종대로 110", aliases: ["서울", "시청", "을지로"] },
  { name: "강남역", lat: 37.4979, lng: 127.0276, address: "서울 강남구 강남대로 396", aliases: ["강남"] },
  { name: "서울역", lat: 37.5547, lng: 126.9707, address: "서울 중구 한강대로 405", aliases: ["서울역"] },
  { name: "잠실역", lat: 37.5133, lng: 127.1001, address: "서울 송파구 올림픽로 293", aliases: ["잠실"] },
  { name: "수원역", lat: 37.2659, lng: 126.9999, address: "경기 수원시 팔달구 덕영대로 924", aliases: ["수원"] },
  { name: "수원신갈", lat: 37.3316, lng: 127.1078, address: "경기 용인시 기흥구", aliases: ["신갈"] },
  { name: "판교역", lat: 37.3948, lng: 127.1112, address: "경기 성남시 분당구 판교역로 160", aliases: ["판교"] },
  { name: "인천공항 제1터미널", lat: 37.4491, lng: 126.451, address: "인천 중구 공항로 272", aliases: ["인천공항", "공항", "icn"] },
  { name: "인천시청", lat: 37.4563, lng: 126.7052, address: "인천 남동구 정각로 29", aliases: ["인천"] },
  { name: "대전시청", lat: 36.3504, lng: 127.3845, address: "대전 서구 둔산로 100", aliases: ["대전"] },
  { name: "대전역", lat: 36.3324, lng: 127.4343, address: "대전 동구 중앙로 215", aliases: ["대전역"] },
  { name: "청주", lat: 36.6424, lng: 127.489, address: "충북 청주시 상당구", aliases: ["청주시"] },
  { name: "천안", lat: 36.8151, lng: 127.1139, address: "충남 천안시 동남구", aliases: ["천안시"] },
  { name: "천안아산역", lat: 36.7946, lng: 127.1045, address: "충남 아산시 배방읍", aliases: ["아산"] },
  { name: "강릉역", lat: 37.7644, lng: 128.8987, address: "강원 강릉시 용지로 176", aliases: ["강릉"] },
  { name: "원주", lat: 37.3422, lng: 127.9202, address: "강원 원주시", aliases: ["원주시"] },
  { name: "부산역", lat: 35.1151, lng: 129.0415, address: "부산 동구 중앙대로 206", aliases: ["부산"] },
  { name: "해운대", lat: 35.1631, lng: 129.1636, address: "부산 해운대구 해운대해변로", aliases: ["해운대구"] },
  { name: "대구시청", lat: 35.8714, lng: 128.6014, address: "대구 중구 공평로 88", aliases: ["대구"] },
  { name: "광주광역시청", lat: 35.1595, lng: 126.8526, address: "광주 서구 내방로 111", aliases: ["광주"] },
  { name: "전주", lat: 35.8242, lng: 127.148, address: "전북 전주시 완산구", aliases: ["전주시"] },
  { name: "제주공항", lat: 33.511, lng: 126.493, address: "제주 제주시 공항로 2", aliases: ["제주"] },
  { name: "춘천", lat: 37.8813, lng: 127.73, address: "강원 춘천시", aliases: ["춘천시"] },
  { name: "속초", lat: 38.207, lng: 128.5918, address: "강원 속초시", aliases: ["속초시"] },
  { name: "여의도", lat: 37.5219, lng: 126.9245, address: "서울 영등포구 여의대로", aliases: ["여의도역"] },
  { name: "홍대입구역", lat: 37.5572, lng: 126.9236, address: "서울 마포구 양화로 188", aliases: ["홍대", "홍대입구"] },
  { name: "성수역", lat: 37.5446, lng: 127.0559, address: "서울 성동구 아차산로 100", aliases: ["성수"] },
  { name: "광화문", lat: 37.5759, lng: 126.9769, address: "서울 종로구 세종대로", aliases: ["광화문역", "세종문화회관"] },
  { name: "용산역", lat: 37.5299, lng: 126.9648, address: "서울 용산구 한강대로 23길", aliases: ["용산"] },
  { name: "김포공항", lat: 37.5583, lng: 126.7906, address: "서울 강서구 하늘길 38", aliases: ["김포공항역"] },
  { name: "동대구역", lat: 35.8794, lng: 128.6284, address: "대구 동구 동대구로 550", aliases: ["동대구"] },
  { name: "울산시청", lat: 35.5384, lng: 129.3114, address: "울산 남구 중앙로 201", aliases: ["울산"] },
  { name: "창원", lat: 35.227, lng: 128.6811, address: "경남 창원시 성산구", aliases: ["창원시"] },
  { name: "포항", lat: 36.019, lng: 129.3435, address: "경북 포항시", aliases: ["포항시"] },
  { name: "세종시청", lat: 36.48, lng: 127.289, address: "세종특별자치시 한누리대로 2130", aliases: ["세종", "세종시"] },
  { name: "수원화성", lat: 37.2851, lng: 127.0119, address: "경기 수원시 팔달구 정조로", aliases: ["화성행궁"] },
  { name: "일산", lat: 37.658, lng: 126.77, address: "경기 고양시 일산서구", aliases: ["고양", "킨텍스"] },
  { name: "부천역", lat: 37.484, lng: 126.7828, address: "경기 부천시 부천로 1", aliases: ["부천"] },
  { name: "평택역", lat: 36.9908, lng: 127.0853, address: "경기 평택시 평택로 51", aliases: ["평택"] },
  { name: "의정부", lat: 37.7381, lng: 127.0337, address: "경기 의정부시", aliases: ["의정부역"] },
];

function toNamedPlace(place: GazetteerEntry): NamedPlace {
  return {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    ...(place.address ? { address: place.address } : {}),
  };
}

/** 0 정확, 1 접두, 2 포함. 아니면 -1 */
export function gazetteerMatchScore(
  place: GazetteerEntry,
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  const name = place.name.toLowerCase();
  const aliases = place.aliases.map((alias) => alias.toLowerCase());
  if (name === q || aliases.includes(q)) return 0;
  if (name.startsWith(q) || aliases.some((alias) => alias.startsWith(q))) return 1;
  if (name.includes(q) || aliases.some((alias) => alias.includes(q))) return 2;
  return -1;
}

export function searchGazetteer(query: string, limit = 8): NamedPlace[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  return PLACE_GAZETTEER.map((place) => ({
    place,
    score: gazetteerMatchScore(place, q),
  }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name, "ko"))
    .slice(0, limit)
    .map((row) => toNamedPlace(row.place));
}

/** 정확·접두 일치만. 가게 POI보다 앞에 올려 도시명을 살린다. */
export function searchGazetteerPreferred(
  query: string,
  limit = 2,
): NamedPlace[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  return PLACE_GAZETTEER.map((place) => ({
    place,
    score: gazetteerMatchScore(place, q),
  }))
    .filter((row) => row.score === 0 || row.score === 1)
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name, "ko"))
    .slice(0, limit)
    .map((row) => toNamedPlace(row.place));
}
