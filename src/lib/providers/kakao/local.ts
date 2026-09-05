import { haversineM } from "@/lib/domain/geo";
import type { NamedPlace } from "@/lib/domain/types";

/**
 * 카카오 로컬 REST (주소·키워드·좌표 → 주소).
 * REST 키는 서버에서만 읽는다.
 */

const KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";
const COORD_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";
const CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";

interface KakaoDocument {
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
  /** 중심 좌표를 준 검색에서만 채워진다 (m) */
  distance?: string;
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

/** 도로명·번지가 보이면 가게보다 주소 문서를 앞에 둔다. */
export function looksLikeRoadAddress(query: string): boolean {
  const q = query.trim();
  return /(?:대로|번길|로|길)\s*\d+/.test(q) || /[동가]\s*\d+/.test(q);
}

function toPlace(doc: KakaoDocument): NamedPlace | null {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const address =
    (doc.road_address_name || doc.address_name || "").trim() || undefined;
  const name = (doc.place_name || address || "").trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return address ? { name, lat, lng, address } : { name, lat, lng };
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

  const keywordDocs = keyword?.documents ?? [];
  const addressDocs = address?.documents ?? [];
  const ordered = looksLikeRoadAddress(q)
    ? [...addressDocs, ...keywordDocs]
    : [...keywordDocs, ...addressDocs];

  const seen = new Set<string>();
  const out: NamedPlace[] = [];
  for (const doc of ordered) {
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

/**
 * 차가 실제로 들어갈 수 있는 시설만 고른다.
 * 주유소·주차장은 진입로가 반드시 있고, 편의점은 산간에서도 도로변에 있다.
 */
const CAR_ACCESSIBLE_CATEGORIES = ["OL7", "PK6", "CS2"] as const;
/** 카카오 반경 검색 상한은 20km다. 가까운 곳부터 훑어 호출을 아낀다. */
const SNAP_RADII_M = [1_500, 6_000, 20_000];

export interface RoadSnap {
  place: NamedPlace;
  /** 원래 지점에서 옮겨간 거리 (m) */
  distanceM: number;
}

/**
 * 산 정상처럼 도로와 이어지지 않은 좌표를 가장 가까운 차량 진입 지점으로 옮긴다.
 * 카카오 길찾기는 도로에서 멀리 떨어진 좌표를 받으면 경로 자체를 만들지 않는다.
 */
export async function snapToRoadKakao(
  key: string,
  lat: number,
  lng: number,
): Promise<RoadSnap | null> {
  for (const radius of SNAP_RADII_M) {
    const pages = await Promise.all(
      CAR_ACCESSIBLE_CATEGORIES.map((code) =>
        fetchJson<KakaoSearchResponse>(
          `${CATEGORY_URL}?category_group_code=${code}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=5`,
          key,
        ),
      ),
    );
    let best: RoadSnap | null = null;
    for (const page of pages) {
      for (const doc of page?.documents ?? []) {
        const place = toPlace(doc);
        if (!place) continue;
        const parsed = Number(doc.distance);
        const distanceM = Number.isFinite(parsed)
          ? parsed
          : haversineM({ lat, lng }, place);
        if (!best || distanceM < best.distanceM) best = { place, distanceM };
      }
    }
    if (best) return best;
  }
  return null;
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
