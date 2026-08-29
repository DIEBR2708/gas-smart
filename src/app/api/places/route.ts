import { NextResponse } from "next/server";
import { searchGazetteer } from "@/lib/data/places";
import {
  reverseGeocodeKakao,
  searchKakaoPlaces,
} from "@/lib/providers/kakao/local";
import type { NamedPlace } from "@/lib/domain/types";

/**
 * 주소·지명 검색. 카카오 로컬 키가 있으면 그 결과를 앞에 두고,
 * 없어도 지명 사전으로 동작한다.
 */

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
    if (kakaoKey) {
      place = (await reverseGeocodeKakao(kakaoKey, lat, lng)) ?? place;
    }
    return NextResponse.json({ places: [place], source: kakaoKey ? "kakao" : "device" });
  }

  if (query.length < 1) {
    return NextResponse.json({ places: [], source: "gazetteer" });
  }

  const gazetteer = searchGazetteer(query, 8);
  if (!kakaoKey) {
    return NextResponse.json({ places: gazetteer, source: "gazetteer" });
  }

  try {
    const live = await searchKakaoPlaces(kakaoKey, query, 8);
    const seen = new Set(live.map((p) => `${p.name}:${p.lat.toFixed(4)}`));
    const merged = [
      ...live,
      ...gazetteer.filter((p) => !seen.has(`${p.name}:${p.lat.toFixed(4)}`)),
    ].slice(0, 8);
    return NextResponse.json({
      places: merged,
      source: live.length > 0 ? "mixed" : "gazetteer",
    });
  } catch {
    return NextResponse.json({ places: gazetteer, source: "gazetteer" });
  }
}
