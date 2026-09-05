"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crosshair, Loader2, MapPin, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchGazetteer } from "@/lib/data/places";
import type { NamedPlace } from "@/lib/domain/types";
import {
  geolocationAvailable,
  geolocationErrorText,
  isEmbeddedFrame,
  readDevicePosition,
} from "@/lib/geolocation";
import { reverseGeocodePlace, searchPlaces } from "@/lib/plan-client";
import { cn } from "@/lib/utils";

/**
 * 이미 받아 본 검색어의 결과. 한 글자 지웠다가 다시 치는 동안 네트워크를
 * 기다리지 않게 한다. 탭을 닫으면 사라지는 정도의 수명이면 충분하다.
 */
const RESULT_CACHE = new Map<string, NamedPlace[]>();

function cacheKey(query: string): string {
  return query.trim().toLowerCase();
}

function rememberResult(query: string, places: NamedPlace[]): void {
  const key = cacheKey(query);
  if (!key) return;
  if (RESULT_CACHE.size > 60) RESULT_CACHE.clear();
  RESULT_CACHE.set(key, places);
}

function sameQuery(a: string, b: string): boolean {
  return cacheKey(a) === cacheKey(b);
}

/**
 * 서버 응답을 기다리는 동안 바로 보여줄 목록.
 *
 * 한 글자마다 왕복을 기다리면 목록이 늦게 뜬다. 내장 지명 사전과, 방금 받은
 * 더 짧은 검색어의 결과에서 추려 먼저 채운다. 서버 응답이 오면 교체된다.
 */
function instantHits(query: string, limit = 8): NamedPlace[] {
  const key = cacheKey(query);
  if (!key) return [];
  const exact = RESULT_CACHE.get(key);
  if (exact) return exact;

  let narrowed: NamedPlace[] = [];
  let narrowedFrom = "";
  for (const [cached, places] of RESULT_CACHE) {
    if (!key.startsWith(cached) || cached.length <= narrowedFrom.length) continue;
    const matches = places.filter((place) =>
      `${place.name} ${place.address ?? ""}`.toLowerCase().includes(key),
    );
    if (matches.length === 0) continue;
    narrowed = matches;
    narrowedFrom = cached;
  }

  const out: NamedPlace[] = [];
  const seen = new Set<string>();
  for (const place of [...searchGazetteer(query, limit), ...narrowed]) {
    const id = `${place.name}:${place.lat.toFixed(4)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}

interface Props {
  id: string;
  label: string;
  value: NamedPlace | null;
  onChange: (place: NamedPlace) => void;
  allowGeolocation?: boolean;
  onRequestMapPick?: () => void;
  mapPickActive?: boolean;
  onLocated?: (lat: number, lng: number) => void;
}

export function PlaceSearch({
  id,
  label,
  value,
  onChange,
  allowGeolocation,
  onRequestMapPick,
  mapPickActive,
  onLocated,
}: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [remote, setRemote] = useState<{
    query: string;
    places: NamedPlace[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [menuBox, setMenuBox] = useState<DOMRect | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!value) return;
    setQuery(value.name);
  }, [value]);

  const hits = useMemo(() => {
    if (remote && sameQuery(remote.query, query)) return remote.places;
    return instantHits(query);
  }, [remote, query]);

  /** 서버가 이 검색어로 빈 목록을 준 경우에만. 기다리는 중에는 띄우지 않는다. */
  const emptyHint =
    query.trim().length > 0 &&
    remote !== null &&
    sameQuery(remote.query, query) &&
    remote.places.length === 0;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 || q === value?.name) return;
    const controller = new AbortController();
    // 사전·직전 결과로 목록이 이미 차 있으므로, 왕복은 짧게 모아 한 번만 보낸다.
    const timer = setTimeout(() => {
      setSearching(true);
      searchPlaces(q, controller.signal)
        .then((places) => {
          rememberResult(q, places);
          setRemote({ query: q, places });
          setOpen(true);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setRemote({ query: q, places: [] });
            setOpen(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value?.name]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (boxRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuBox(null);
      return;
    }
    const update = () => {
      const el = inputRef.current;
      if (el) setMenuBox(el.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, hits.length, emptyHint, query]);

  const pick = (place: NamedPlace) => {
    onChange(place);
    setQuery(place.name);
    setOpen(false);
    setGeoError(null);
  };

  const refineName = async (lat: number, lng: number) => {
    try {
      const place = await reverseGeocodePlace(lat, lng);
      if (place) pick(place);
    } catch {
      /* 좌표는 이미 넣었다 */
    }
  };

  const locate = () => {
    if (!geolocationAvailable()) {
      setGeoError(
        window.isSecureContext
          ? "이 브라우저는 위치 정보를 지원하지 않습니다. 지도를 눌러 주세요."
          : "위치는 https 또는 localhost에서만 됩니다. 지도를 눌러 지정해 주세요.",
      );
      onRequestMapPick?.();
      return;
    }
    setGeoBusy(true);
    setGeoError(null);
    void readDevicePosition()
      .then((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        onLocated?.(lat, lng);
        pick({ name: "현재 위치", lat, lng });
        void refineName(lat, lng);
      })
      .catch((err: { code?: number }) => {
        onRequestMapPick?.();
        setGeoError(
          geolocationErrorText(err?.code ?? 2, isEmbeddedFrame()),
        );
      })
      .finally(() => setGeoBusy(false));
  };

  const menu =
    open &&
    menuBox &&
    (hits.length > 0 || emptyHint) &&
    typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            role="listbox"
            className="fixed z-[var(--layer-suggestion)] max-h-56 overflow-auto rounded-lg border border-border bg-background py-1 shadow-lg"
            style={{
              top: menuBox.bottom + 4,
              left: menuBox.left,
              width: Math.max(menuBox.width, 220),
            }}
          >
            {hits.length === 0 ? (
              <li className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                검색 결과가 없습니다. 강남역, 대전시청처럼 지명이나 도로명
                주소를 조금 더 적어 보세요.
              </li>
            ) : (
              hits.map((place) => (
                <li key={`${place.name}-${place.lat}-${place.lng}`}>
                  <button
                    type="button"
                    role="option"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(place);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-input/40",
                      value?.name === place.name && "bg-primary/10",
                    )}
                  >
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate">{place.name}</span>
                      {place.address && place.address !== place.name ? (
                        <span className="block truncate text-[11px] leading-snug text-muted-foreground">
                          {place.address}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div ref={boxRef} className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex shrink-0 items-center gap-0.5">
          {onRequestMapPick && (
            <Button
              type="button"
              size="xs"
              variant={mapPickActive ? "default" : "ghost"}
              onClick={onRequestMapPick}
              aria-pressed={mapPickActive}
            >
              <MapPinned className="size-3" />
              지도에서
            </Button>
          )}
          {allowGeolocation && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={locate}
              disabled={geoBusy}
            >
              {geoBusy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Crosshair className="size-3" />
              )}
              현재 위치
            </Button>
          )}
        </div>
      </div>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          value={query}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          placeholder="지명이나 도로명 주소, 예: 강남역, 테헤란로 427"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => (hits.length > 0 || emptyHint) && setOpen(true)}
        />
        {searching && (
          <Loader2 className="absolute top-2.5 right-2.5 size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {menu}
      {mapPickActive && (
        <p className="text-[11px] text-primary">
          지도에서 {label} 지점을 눌러 주세요.
        </p>
      )}
      {geoError && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          {geoError}
          {isEmbeddedFrame() ? (
            <>
              {" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() =>
                  window.open(window.location.href, "_blank", "noopener")
                }
              >
                새 탭에서 열기
              </button>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
