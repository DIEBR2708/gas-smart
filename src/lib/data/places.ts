import type { NamedPlace } from "@/lib/domain/types";

/**
 * 키 없이도 주소 검색이 동작하게 하는 지명 사전.
 * 카카오 로컬 API 키가 있으면 /api/places가 그 결과를 이 목록 앞에 붙인다.
 */
export const PLACE_GAZETTEER: (NamedPlace & { aliases: string[] })[] = [
  { name: "서울시청", lat: 37.5663, lng: 126.9779, aliases: ["서울", "시청", "을지로"] },
  { name: "강남역", lat: 37.4979, lng: 127.0276, aliases: ["강남"] },
  { name: "서울역", lat: 37.5547, lng: 126.9707, aliases: ["서울역"] },
  { name: "잠실역", lat: 37.5133, lng: 127.1001, aliases: ["잠실"] },
  { name: "수원역", lat: 37.2659, lng: 126.9999, aliases: ["수원"] },
  { name: "수원신갈", lat: 37.3316, lng: 127.1078, aliases: ["신갈"] },
  { name: "판교역", lat: 37.3948, lng: 127.1112, aliases: ["판교"] },
  { name: "인천공항 제1터미널", lat: 37.4491, lng: 126.451, aliases: ["인천공항", "공항", "icn"] },
  { name: "인천시청", lat: 37.4563, lng: 126.7052, aliases: ["인천"] },
  { name: "대전시청", lat: 36.3504, lng: 127.3845, aliases: ["대전"] },
  { name: "대전역", lat: 36.3324, lng: 127.4343, aliases: ["대전역"] },
  { name: "청주", lat: 36.6424, lng: 127.489, aliases: ["청주시"] },
  { name: "천안", lat: 36.8151, lng: 127.1139, aliases: ["천안시"] },
  { name: "천안아산역", lat: 36.7946, lng: 127.1045, aliases: ["아산"] },
  { name: "강릉역", lat: 37.7644, lng: 128.8987, aliases: ["강릉"] },
  { name: "원주", lat: 37.3422, lng: 127.9202, aliases: ["원주시"] },
  { name: "부산역", lat: 35.1151, lng: 129.0415, aliases: ["부산"] },
  { name: "해운대", lat: 35.1631, lng: 129.1636, aliases: ["해운대구"] },
  { name: "대구시청", lat: 35.8714, lng: 128.6014, aliases: ["대구"] },
  { name: "광주광역시청", lat: 35.1595, lng: 126.8526, aliases: ["광주"] },
  { name: "전주", lat: 35.8242, lng: 127.148, aliases: ["전주시"] },
  { name: "제주공항", lat: 33.511, lng: 126.493, aliases: ["제주"] },
  { name: "춘천", lat: 37.8813, lng: 127.73, aliases: ["춘천시"] },
  { name: "속초", lat: 38.207, lng: 128.5918, aliases: ["속초시"] },
  { name: "여의도", lat: 37.5219, lng: 126.9245, aliases: ["여의도역"] },
  { name: "홍대입구역", lat: 37.5572, lng: 126.9236, aliases: ["홍대", "홍대입구"] },
  { name: "성수역", lat: 37.5446, lng: 127.0559, aliases: ["성수"] },
  { name: "광화문", lat: 37.5759, lng: 126.9769, aliases: ["광화문역", "세종문화회관"] },
  { name: "용산역", lat: 37.5299, lng: 126.9648, aliases: ["용산"] },
  { name: "김포공항", lat: 37.5583, lng: 126.7906, aliases: ["김포공항역"] },
  { name: "동대구역", lat: 35.8794, lng: 128.6284, aliases: ["동대구"] },
  { name: "울산시청", lat: 35.5384, lng: 129.3114, aliases: ["울산"] },
  { name: "창원", lat: 35.227, lng: 128.6811, aliases: ["창원시"] },
  { name: "포항", lat: 36.019, lng: 129.3435, aliases: ["포항시"] },
  { name: "세종시청", lat: 36.48, lng: 127.289, aliases: ["세종", "세종시"] },
  { name: "수원화성", lat: 37.2851, lng: 127.0119, aliases: ["화성행궁"] },
  { name: "일산", lat: 37.658, lng: 126.77, aliases: ["고양", "킨텍스"] },
  { name: "부천역", lat: 37.484, lng: 126.7828, aliases: ["부천"] },
  { name: "평택역", lat: 36.9908, lng: 127.0853, aliases: ["평택"] },
  { name: "의정부", lat: 37.7381, lng: 127.0337, aliases: ["의정부역"] },
];

export function searchGazetteer(query: string, limit = 8): NamedPlace[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  return PLACE_GAZETTEER.filter(
    (place) =>
      place.name.toLowerCase().includes(q) ||
      place.aliases.some((alias) => alias.toLowerCase().includes(q)),
  )
    .slice(0, limit)
    .map(({ name, lat, lng }) => ({ name, lat, lng }));
}
