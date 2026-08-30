import type { NamedPlace } from "@/lib/domain/types";

/**
 * 카카오 로컬 REST (주소·키워드·좌표 → 주소).
 * REST 키는 서버에서만 읽는다.
 */

const KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";
const COORD_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";

interface KakaoDocument {
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
}

interface KakaoSearchResponse {
  documents?: KakaoDocument[];
}

interface KakaoCoordResponse {
  documents?: {
    road_address?: { address_name?: string };
    address?: { address_name?: string };
  }[];
}

function headers(key: string): HeadersInit {
  return { Authorization: `KakaoAK ${key}` };
}

function toPlace(doc: KakaoDocument): NamedPlace | null {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const name =
    doc.place_name || doc.road_address_name || doc.address_name || "";
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name, lat, lng };
}

export async function searchKakaoPlaces(
  key: string,
  query: string,
  limit = 8,
): Promise<NamedPlace[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  const [keyword, address] = await Promise.all([
    fetchJson<KakaoSearchResponse>(
      `${KEYWORD_URL}?query=${encodeURIComponent(q)}&size=${limit}`,
      key,
    ),
    fetchJson<KakaoSearchResponse>(
      `${ADDRESS_URL}?query=${encodeURIComponent(q)}&size=${Math.min(5, limit)}`,
      key,
    ),
  ]);

  const seen = new Set<string>();
  const out: NamedPlace[] = [];
  for (const doc of [...(keyword?.documents ?? []), ...(address?.documents ?? [])]) {
    const place = toPlace(doc);
    if (!place) continue;
    const id = `${place.name}:${place.lat.toFixed(5)}:${place.lng.toFixed(5)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}

export async function reverseGeocodeKakao(
  key: string,
  lat: number,
  lng: number,
): Promise<NamedPlace | null> {
  const json = await fetchJson<KakaoCoordResponse>(
    `${COORD_URL}?x=${lng}&y=${lat}`,
    key,
  );
  const doc = json?.documents?.[0];
  const name =
    doc?.road_address?.address_name ?? doc?.address?.address_name ?? "현재 위치";
  return { name, lat, lng };
}

let kakaoLocalDisabled = false;

async function fetchJson<T>(url: string, key: string): Promise<T | null> {
  if (kakaoLocalDisabled) return null;
  try {
    const res = await fetch(url, {
      headers: headers(key),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 403) {
      kakaoLocalDisabled = true;
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
