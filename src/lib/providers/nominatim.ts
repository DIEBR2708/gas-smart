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
  address?: {
    road?: string;
    pedestrian?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city?: string;
    town?: string;
    village?: string;
    house_number?: string;
  };
}

function headers(): HeadersInit {
  return { Accept: "application/json", "User-Agent": UA };
}

function addressLabel(hit: NominatimHit): string {
  const addr = hit.address;
  if (!addr) return "";
  const road = addr.road || addr.pedestrian;
  const area =
    addr.suburb || addr.neighbourhood || addr.quarter || addr.city || addr.town || addr.village;
  if (road && area) return `${area} ${road}`;
  return road || area || "";
}

function displayParts(hit: NominatimHit): string[] {
  return (hit.display_name || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^\d+$/.test(part));
}

/** 검색: 장소 이름을 우선한다. */
function searchLabel(hit: NominatimHit): string {
  const raw = (hit.name || "").trim();
  if (raw && !/^\d+$/.test(raw)) return raw;
  return displayParts(hit)[0] || addressLabel(hit) || "검색 위치";
}

/** 역지오코딩: 번지 대신 도로·동네를 보여 준다. */
function reverseLabel(hit: NominatimHit): string {
  return addressLabel(hit) || searchLabel(hit) || "현재 위치";
}

function toPlace(hit: NominatimHit, label: string): NamedPlace | null {
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 32 || lat > 39 || lng < 124 || lng > 132) return null;
  return { name: label.slice(0, 80), lat, lng };
}

export function parseNominatimReverse(hit: NominatimHit, lat: number, lng: number): NamedPlace {
  return (
    toPlace(hit, reverseLabel(hit)) ?? {
      name: reverseLabel(hit) || "현재 위치",
      lat,
      lng,
    }
  );
}

export function parseNominatimHits(hits: NominatimHit[], limit = 8): NamedPlace[] {
  const seen = new Set<string>();
  const out: NamedPlace[] = [];
  for (const hit of hits) {
    const place = toPlace(hit, searchLabel(hit));
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
  url.searchParams.set("addressdetails", "1");
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
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "ko");
  try {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return null;
    const json = (await res.json()) as NominatimHit;
    return parseNominatimReverse(json, lat, lng);
  } catch {
    return null;
  }
}
