"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, MapPin } from "lucide-react";
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
}

export function PlaceSearch({
  id,
  label,
  value,
  onChange,
  allowGeolocation,
}: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [hits, setHits] = useState<NamedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 || q === value?.name) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      searchPlaces(q, controller.signal)
        .then((places) => {
          setHits(places);
          setOpen(places.length > 0);
        })
        .catch(() => {
          if (!controller.signal.aborted) setHits([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value?.name]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (place: NamedPlace) => {
    onChange(place);
    setQuery(place.name);
    setHits([]);
    setOpen(false);
    setGeoError(null);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setGeoError("이 브라우저는 위치 정보를 지원하지 않습니다.");
      return;
    }
    setGeoBusy(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        reverseGeocodePlace(pos.coords.latitude, pos.coords.longitude)
          .then((place) => {
            pick(
              place ?? {
                name: "현재 위치",
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              },
            );
          })
          .finally(() => setGeoBusy(false));
      },
      (err) => {
        setGeoBusy(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요."
            : "현재 위치를 읽지 못했습니다.",
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30_000 },
    );
  };

  return (
    <div ref={boxRef} className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
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
      <div className="relative">
        <Input
          id={id}
          value={query}
          autoComplete="off"
          placeholder="지명이나 주소를 입력"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => hits.length > 0 && setOpen(true)}
        />
        {searching && (
          <Loader2 className="absolute top-2.5 right-2.5 size-3.5 animate-spin text-muted-foreground" />
        )}
        {open && hits.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-background py-1 shadow-lg">
            {hits.map((place) => (
              <li key={`${place.name}-${place.lat}-${place.lng}`}>
                <button
                  type="button"
                  onClick={() => pick(place)}
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
            ))}
          </ul>
        )}
      </div>
      {geoError && <p className="text-[11px] text-amber-300">{geoError}</p>}
    </div>
  );
}
