import { NextResponse } from "next/server";
import { searchGazetteer, searchGazetteerPreferred } from "@/lib/data/places";
import {
  reverseGeocodeKakao,
  searchKakaoPlaces,
} from "@/lib/providers/kakao/local";
import { reverseNominatim, searchNominatim } from "@/lib/providers/nominatim";
import type { NamedPlace } from "@/lib/domain/types";
import { parseQueryCoord } from "@/lib/geolocation";

/**
 * 주소·지명 검색.
 * 카카오 로컬이 열려 있으면 그걸 쓰고, 꺼져 있으면 Nominatim으로 주소를 찾는다.
 * 지명 사전은 항상 뒤에 붙인다.
 */

/**
 * 한 글자마다 검색을 보내므로 같은 접두어가 몇 번씩 들어온다.
 * 카카오 로컬은 일일 한도가 있으니 짧게라도 캐시해 왕복과 쿼터를 아낀다.
 */
const SEARCH_CACHE_TTL_MS = 60_000;
const searchCache = new Map<
  string,
  { at: number; body: { places: NamedPlace[]; source: string } }
>();

function cachedSearch(key: string) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return hit.body;
}

function rememberSearch(
  key: string,
  body: { places: NamedPlace[]; source: string },
): void {
  if (searchCache.size > 200) {
    const now = Date.now();
    for (const [cached, entry] of searchCache) {
      if (now - entry.at >= SEARCH_CACHE_TTL_MS) searchCache.delete(cached);
    }
    if (searchCache.size > 200) searchCache.clear();
  }
  searchCache.set(key, { at: Date.now(), body });
}

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
  const lat = parseQueryCoord(url.searchParams.get("lat"));
  const lng = parseQueryCoord(url.searchParams.get("lng"));
  const kakaoKey = process.env.KAKAO_REST_API_KEY?.trim();

  if (lat != null && lng != null) {
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

  const cacheKey = query.toLowerCase();
  const cached = cachedSearch(cacheKey);
  if (cached) return NextResponse.json(cached);

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
  const body = { places, source };
  if (places.length > 0) rememberSearch(cacheKey, body);
  return NextResponse.json(body);
}
