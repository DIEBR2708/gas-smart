"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crosshair, Loader2, MapPin, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NamedPlace } from "@/lib/domain/types";
import {
  geolocationAvailable,
  geolocationErrorText,
  isEmbeddedFrame,
  readDevicePosition,
} from "@/lib/geolocation";
import { reverseGeocodePlace, searchPlaces } from "@/lib/plan-client";
import { cn } from "@/lib/utils";

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
  const [hits, setHits] = useState<NamedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [emptyHint, setEmptyHint] = useState(false);
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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 || q === value?.name) {
      setEmptyHint(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      searchPlaces(q, controller.signal)
        .then((places) => {
          setHits(places);
          setEmptyHint(places.length === 0);
          setOpen(true);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setHits([]);
            setEmptyHint(true);
            setOpen(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 400);
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
    setHits([]);
    setOpen(false);
    setEmptyHint(false);
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
            className="fixed z-[2000] max-h-56 overflow-auto rounded-lg border border-border bg-background py-1 shadow-lg"
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
        <p className="text-[11px] text-amber-300">
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
