import { NextResponse } from "next/server";
import { lookupCoordinate, lookupPlaces } from "@/lib/engine/places-engine";
import { parseQueryCoord } from "@/lib/geolocation";
import "@/lib/server-bootstrap";

/**
 * 장소 검색 엔진을 감싸는 전송 계층. 검색 자체는 places-engine이 한다.
 * 안드로이드 앱에는 이 라우트가 없고 화면이 엔진을 직접 부른다.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const lat = parseQueryCoord(url.searchParams.get("lat"));
  const lng = parseQueryCoord(url.searchParams.get("lng"));

  if (lat != null && lng != null) {
    return NextResponse.json(await lookupCoordinate(lat, lng));
  }
  return NextResponse.json(await lookupPlaces(query));
}
