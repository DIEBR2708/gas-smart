"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crosshair, Loader2, MapPin, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NamedPlace } from "@/lib/domain/types";
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

  const applyCoords = async (lat: number, lng: number) => {
    onLocated?.(lat, lng);
    try {
      const place = await reverseGeocodePlace(lat, lng);
      pick(place ?? { name: "현재 위치", lat, lng });
    } catch {
      pick({ name: "현재 위치", lat, lng });
    }
  };

  const locate = () => {
    if (!window.isSecureContext) {
      setGeoError("위치는 https 또는 localhost에서만 됩니다. 지도를 눌러 지정해 주세요.");
      onRequestMapPick?.();
      return;
    }
    if (!navigator.geolocation) {
      setGeoError("이 브라우저는 위치 정보를 지원하지 않습니다. 지도를 눌러 주세요.");
      onRequestMapPick?.();
      return;
    }
    if (window.self !== window.top) {
      setGeoError(
        "미리보기 창에서는 브라우저가 위치를 막을 수 있습니다. 허용하거나 지도를 눌러 주세요.",
      );
    }
    setGeoBusy(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyCoords(pos.coords.latitude, pos.coords.longitude).finally(() =>
          setGeoBusy(false),
        );
      },
      (err) => {
        setGeoBusy(false);
        onRequestMapPick?.();
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError(
            "위치 권한이 거부되었습니다. 주소창 자물쇠에서 허용하거나, 지도를 눌러 지정하세요.",
          );
          return;
        }
        setGeoError("현재 위치를 읽지 못했습니다. 지도를 눌러 출발·도착을 찍어 주세요.");
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 },
    );
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
                    <span>
                      <span className="block">{place.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                      </span>
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
          placeholder="지명이나 주소, 예: 강남역, 전주시청"
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
      {geoError && <p className="text-[11px] text-amber-300">{geoError}</p>}
    </div>
  );
}
