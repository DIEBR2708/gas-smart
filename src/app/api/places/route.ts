import { NextResponse } from "next/server";
import { searchGazetteer, searchGazetteerPreferred } from "@/lib/data/places";
import {
  reverseGeocodeKakao,
  searchKakaoPlaces,
} from "@/lib/providers/kakao/local";
import { reverseNominatim, searchNominatim } from "@/lib/providers/nominatim";
import type { NamedPlace } from "@/lib/domain/types";

/**
 * 주소·지명 검색.
 * 카카오 로컬이 열려 있으면 그걸 쓰고, 꺼져 있으면 Nominatim으로 주소를 찾는다.
 * 지명 사전은 항상 뒤에 붙인다.
 */

function mergePlaces(lists: NamedPlace[][], limit = 8): NamedPlace[] {
  const seen = new Set<string>();
  const out: NamedPlace[] = [];
  for (const list of lists) {
    for (const place of list) {
      const id = `${place.name}:${place.lat.toFixed(4)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(place);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const kakaoKey = process.env.KAKAO_REST_API_KEY?.trim();

  if (latRaw && lngRaw && Number.isFinite(lat) && Number.isFinite(lng)) {
    let place: NamedPlace = { name: "현재 위치", lat, lng };
    let source: "kakao" | "nominatim" | "device" = "device";
    if (kakaoKey) {
      const kakao = await reverseGeocodeKakao(kakaoKey, lat, lng);
      if (kakao && kakao.name !== "현재 위치") {
        place = kakao;
        source = "kakao";
      }
    }
    if (source === "device") {
      const osm = await reverseNominatim(lat, lng);
      if (osm) {
        place = osm;
        source = "nominatim";
      }
    }
    return NextResponse.json({ places: [place], source });
  }

  if (query.length < 1) {
    return NextResponse.json({ places: [], source: "gazetteer" });
  }

  const gazetteer = searchGazetteer(query, 8);
  const gazetteerTop = searchGazetteerPreferred(query, 2);
  let kakao: NamedPlace[] = [];
  if (kakaoKey) {
    try {
      kakao = await searchKakaoPlaces(kakaoKey, query, 8);
    } catch {
      kakao = [];
    }
  }
  const osm = kakao.length > 0 ? [] : await searchNominatim(query, 8);
  const places = mergePlaces([gazetteerTop, kakao, osm, gazetteer]);
  const source =
    kakao.length > 0 ? "mixed" : osm.length > 0 ? "nominatim" : "gazetteer";
  return NextResponse.json({ places, source });
}
