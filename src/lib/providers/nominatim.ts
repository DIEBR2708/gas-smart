import type { NamedPlace } from "@/lib/domain/types";

/**
 * 카카오 로컬이 꺼져 있을 때 쓰는 주소 검색.
 * 공개 Nominatim은 초당 1회 제한이 있어 호출 전에 디바운스해야 한다.
 */

const SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const UA = "gas-smart/0.1 (refuel planner; local fallback when Kakao Local is off)";

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
}

function headers(): HeadersInit {
  return { Accept: "application/json", "User-Agent": UA };
}

function toPlace(hit: NominatimHit): NamedPlace | null {
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  const name = (hit.name || hit.display_name || "").split(",")[0]?.trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 32 || lat > 39 || lng < 124 || lng > 132) return null;
  return { name: name.slice(0, 80), lat, lng };
}

export function parseNominatimHits(hits: NominatimHit[], limit = 8): NamedPlace[] {
  const seen = new Set<string>();
  const out: NamedPlace[] = [];
  for (const hit of hits) {
    const place = toPlace(hit);
    if (!place) continue;
    const id = `${place.name}:${place.lat.toFixed(4)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchNominatim(
  query: string,
  limit = 8,
): Promise<NamedPlace[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const url = new URL(SEARCH_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("countrycodes", "kr");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("accept-language", "ko");
  try {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return [];
    const json = (await res.json()) as NominatimHit[];
    return parseNominatimHits(Array.isArray(json) ? json : [], limit);
  } catch {
    return [];
  }
}

export async function reverseNominatim(
  lat: number,
  lng: number,
): Promise<NamedPlace | null> {
  const url = new URL(REVERSE_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("accept-language", "ko");
  try {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return null;
    const json = (await res.json()) as NominatimHit;
    return (
      toPlace(json) ?? {
        name: json.display_name?.split(",")[0]?.trim() || "현재 위치",
        lat,
        lng,
      }
    );
  } catch {
    return null;
  }
}
