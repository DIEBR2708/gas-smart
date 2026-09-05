"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, Map as MapIcon, SlidersHorizontal } from "lucide-react";
import { PlaceSearch } from "@/components/place-search";
import { ResultPanel } from "@/components/result-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { SwipePages } from "@/components/swipe-pages";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  cachePlan,
  loadCachedPlan,
  loadDiscountRules,
  loadSession,
  saveDiscountRules,
  saveSession,
} from "@/lib/client-store";
import {
  carUnreachableReason,
  isUnreachableByCarMessage,
} from "@/lib/domain/driving-region";
import { DEFAULT_PREFERENCES, DEFAULT_VEHICLE } from "@/lib/domain/fixtures";
import { nearbySearchRoute } from "@/lib/domain/nearby";
import { disconnectedEndpointsRoute } from "@/lib/domain/route-build";
import type {
  LatLng,
  NamedPlace,
  Preferences,
  Route,
  Vehicle,
} from "@/lib/domain/types";
import { fetchPlan, reverseGeocodePlace, type PlanResponse } from "@/lib/plan-client";
import { cn } from "@/lib/utils";

const RouteMap = dynamic(() => import("@/components/route-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

interface Props {
  routes: Route[];
}

type Tab = "result" | "settings";

function initialPlannerState(routes: Route[]) {
  const session = loadSession();
  const rules = loadDiscountRules();
  const sample = routes.find((r) => r.id === session?.routeId) ?? routes[0];
  const parsedDepart = session?.departAt ? new Date(session.departAt) : null;
  return {
    routeId: sample.id,
    origin: session?.origin ?? sample.origin,
    destination: session?.destination ?? sample.destination,
    searchMode:
      session?.searchMode === "nearby"
        ? ("nearby" as const)
        : ("route" as const),
    departAt:
      parsedDepart && !Number.isNaN(parsedDepart.getTime())
        ? parsedDepart
        : new Date(),
    vehicle: session?.vehicle ?? DEFAULT_VEHICLE,
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...session?.preferences,
      discountRules: session?.preferences.discountRules ?? rules,
    },
  };
}

export function Planner({ routes }: Props) {
  const [boot] = useState(() => initialPlannerState(routes));
  const [routeId] = useState(boot.routeId);
  const [origin, setOrigin] = useState<NamedPlace | null>(boot.origin);
  const [destination, setDestination] = useState<NamedPlace | null>(
    boot.destination,
  );
  const [searchMode, setSearchMode] = useState<"route" | "nearby">(
    boot.searchMode,
  );
  const [departAt] = useState(boot.departAt);
  const [vehicle, setVehicle] = useState<Vehicle>(boot.vehicle);
  const [preferences, setPreferences] = useState<Preferences>(boot.preferences);
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("result");
  const [mapPick, setMapPick] = useState<"origin" | "destination" | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [previewRoute, setPreviewRoute] = useState<Route | null>(null);

  const requestSeq = useRef(0);

  const trackingLocation = userLocation !== null;
  useEffect(() => {
    if (!trackingLocation || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [trackingLocation]);

  useEffect(() => {
    saveSession({
      vehicle,
      preferences,
      routeId,
      origin,
      destination,
      departAt: departAt.toISOString(),
      searchMode,
    });
    saveDiscountRules(preferences.discountRules);
  }, [vehicle, preferences, routeId, origin, destination, departAt, searchMode]);

  /*
    계획을 다시 부르는 기준은 좌표다. 지도를 찍은 뒤 주소가 늦게 도착해 이름만
    바뀌는 경우까지 재조회하면, 같은 자리를 두 번 계산하며 화면이 다시 비워진다.
  */
  const originKey = origin ? `${origin.lat},${origin.lng}` : "";
  const destinationKey = destination ? `${destination.lat},${destination.lng}` : "";
  const originRef = useRef(origin);
  const destinationRef = useRef(destination);
  useEffect(() => {
    originRef.current = origin;
    destinationRef.current = destination;
  }, [origin, destination]);

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeq.current;

    const timer = setTimeout(() => {
      const from = originRef.current;
      const to = destinationRef.current;
      if (searchMode === "nearby" && !from) {
        setData(null);
        setError("이 자리에서 찾으려면 위치를 지정해 주세요.");
        setFromCache(false);
        setCachedAt(null);
        setSelectedId(null);
        setLoading(false);
        return;
      }
      const blocked =
        searchMode === "route" && from && to
          ? carUnreachableReason(from, to)
          : null;
      if (blocked) {
        setData(null);
        setError(blocked);
        setFromCache(false);
        setCachedAt(null);
        setSelectedId(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setPreviewRoute(null);
      fetchPlan(
        {
          routeId,
          searchMode,
          origin: from ?? undefined,
          destination: searchMode === "nearby" ? undefined : to ?? undefined,
          vehicle,
          preferences,
          departAt: departAt.toISOString(),
        },
        controller.signal,
        (route) => {
          if (seq !== requestSeq.current) return;
          setPreviewRoute(route);
        },
      )
        .then((response) => {
          if (seq !== requestSeq.current) return;
          setData(response);
          setError(null);
          setFromCache(false);
          setCachedAt(null);
          cachePlan(response);
          setSelectedId((current) => {
            const stillThere = response.plan.options.some(
              (o) => o.station.id === current,
            );
            return stillThere ? current : null;
          });
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || seq !== requestSeq.current) return;
          const message =
            cause instanceof Error ? cause.message : "알 수 없는 오류";
          const cached = loadCachedPlan();
          if (isUnreachableByCarMessage(message)) {
            setData(null);
            setFromCache(false);
            setCachedAt(null);
            setError(message);
            setSelectedId(null);
            return;
          }
          if (cached) {
            setData(cached.response);
            setFromCache(true);
            setCachedAt(cached.savedAt);
            setError(message);
            setSelectedId(null);
          } else {
            setError(message);
          }
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    routeId,
    originKey,
    destinationKey,
    vehicle,
    preferences,
    departAt,
    searchMode,
  ]);

  const unreachable =
    Boolean(error && isUnreachableByCarMessage(error)) &&
    Boolean(origin && destination);
  const displayRoute =
    searchMode === "nearby" && origin
      ? previewRoute && previewRoute.id.startsWith("nearby:")
        ? previewRoute
        : data?.plan.nearby
          ? data.plan.route
          : nearbySearchRoute(origin)
      : unreachable && origin && destination
        ? disconnectedEndpointsRoute(origin, destination)
        : previewRoute ??
          data?.plan.route ??
          routes.find((r) => r.id === routeId) ??
          routes[0];

  const handleSelect = useCallback((id: string) => {
    if (mapPick) return;
    setSelectedId((current) => (current === id ? null : id));
    setTab("result");
  }, [mapPick]);

  /**
   * 찍은 좌표를 먼저 넣고, 주소는 나중에 채운다.
   * 역지오코딩을 기다렸다가 넣으면 지도를 눌러도 몇 초 동안 아무 일도
   * 일어나지 않는 것처럼 보인다. 경로 계산에 필요한 것은 좌표뿐이다.
   */
  const applyPickedPoint = useCallback(
    (lat: number, lng: number) => {
      const target = mapPick;
      if (!target) return;
      const picked: NamedPlace = { name: "지도에서 지정", lat, lng };
      if (target === "origin") setOrigin(picked);
      else setDestination(picked);
      setMapPick(null);
      setError(null);

      void (async () => {
        let named: NamedPlace | null = null;
        try {
          named = await reverseGeocodePlace(lat, lng);
        } catch {
          /* 좌표만으로도 경로를 계산할 수 있다 */
        }
        if (!named) return;
        // 이름만 바꾼다. 좌표를 역지오코딩 결과로 덮으면 사용자가 찍은
        // 자리에서 수십 m 밀려난다.
        const labelled: NamedPlace = { ...named, lat, lng };
        const stillPicked = (current: NamedPlace | null) =>
          current !== null && current.lat === lat && current.lng === lng;
        if (target === "origin") {
          setOrigin((current) => (stillPicked(current) ? labelled : current));
        } else {
          setDestination((current) =>
            stillPicked(current) ? labelled : current,
          );
        }
      })();
    },
    [mapPick],
  );

  const plan = data?.plan ?? null;
  const isSample = data?.dataMode !== "live";

  /*
    캐시에서 바로 돌아오는 조회까지 화면을 덮으면 깜빡임만 남는다.
    사람이 "느리다"고 느끼기 시작하는 지점에서만 가린다.
  */
  const [veiled, setVeiled] = useState(false);
  useEffect(() => {
    if (!loading) {
      setVeiled(false);
      return;
    }
    const timer = setTimeout(() => setVeiled(true), 220);
    return () => clearTimeout(timer);
  }, [loading]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <MapIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {searchMode === "nearby"
                ? "이 자리에서 가장 싸게 넣기"
                : "경로 위에서 가장 싸게 넣기"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {searchMode === "nearby"
                ? "목적지 없이, 여기서 갈 수 있는 주유소만 비교합니다."
                : "가격만 비교하지 않습니다. 우회 연료·시간·통행료까지 더한 실질 비용으로 고릅니다."}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {loading && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <Badge
                variant={fromCache ? "destructive" : isSample ? "secondary" : "default"}
                className="gap-1"
              >
                <FlaskConical className="size-3" />
                {fromCache
                  ? "캐시된 계획"
                  : isSample
                    ? "가상 주유소"
                    : "실시간 데이터"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {fromCache
                ? "통신에 실패해 기기에 저장해 둔 마지막 결과를 보여 줍니다."
                : isSample
                  ? "오피넷 인증키가 없어 주유소를 합성해서 보여 줍니다. 지도 위 위치와 이름은 실제가 아닙니다. .env.local에 OPINET_CERT_KEY를 넣으면 실제 주유소로 바뀝니다."
                  : "오피넷 유가와 카카오모빌리티 경로를 실시간으로 조회하고 있습니다."}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* 검색창과 범례(z-500)는 덮지 않는다. 가리는 동안에도 목적지는 바꿀 수 있어야 한다. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[400] flex items-start justify-center bg-slate-950/45 pt-24 backdrop-blur-[1px] transition-opacity duration-200 lg:items-center lg:pt-0",
            veiled ? "opacity-100" : "opacity-0",
          )}
          aria-hidden={!veiled}
        >
          <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
            <Loader2 className="size-4 animate-spin text-primary" />
            {searchMode === "nearby" ? "주변 주유소 찾는 중" : "경로 로드중"}
          </div>
        </div>
        <div className="relative h-[42dvh] min-h-[220px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <RouteMap
            route={displayRoute}
            options={plan?.options ?? []}
            shapes={data?.shapes ?? {}}
            selectedId={selectedId}
            bestId={plan?.best?.station.id ?? null}
            onSelect={handleSelect}
            pickEnabled={mapPick !== null}
            onPickPoint={(lat, lng) => void applyPickedPoint(lat, lng)}
            userLocation={
              userLocation ??
              (origin?.name === "현재 위치" ? origin : null)
            }
          />
          <div className="pointer-events-auto absolute top-3 left-3 z-[500] w-[min(calc(100%-1.5rem),20.5rem)] space-y-2 rounded-xl border border-border bg-background/92 p-3 shadow-lg backdrop-blur">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-input/30 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setSearchMode("route");
                  setMapPick(null);
                }}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  searchMode === "route"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                경로에서
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchMode("nearby");
                  setMapPick((current) =>
                    current === "destination" ? null : current,
                  );
                }}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  searchMode === "nearby"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                이 자리에서
              </button>
            </div>
            <PlaceSearch
              id="map-origin"
              label={searchMode === "nearby" ? "위치" : "출발"}
              value={origin}
              onChange={(place) => {
                setOrigin(place);
                setMapPick(null);
              }}
              allowGeolocation
              onLocated={(lat, lng) => setUserLocation({ lat, lng })}
              mapPickActive={mapPick === "origin"}
              onRequestMapPick={() =>
                setMapPick((current) => (current === "origin" ? null : "origin"))
              }
            />
            {searchMode === "route" && (
              <PlaceSearch
                id="map-destination"
                label="도착"
                value={destination}
                onChange={(place) => {
                  setDestination(place);
                  setMapPick(null);
                }}
                allowGeolocation
                onLocated={(lat, lng) => setUserLocation({ lat, lng })}
                mapPickActive={mapPick === "destination"}
                onRequestMapPick={() =>
                  setMapPick((current) =>
                    current === "destination" ? null : "destination",
                  )
                }
              />
            )}
          </div>
          <div className="pointer-events-none absolute top-3 right-3 z-[500] hidden flex-col gap-1 rounded-lg border border-border bg-background/85 px-2.5 py-2 text-[11px] backdrop-blur sm:flex">
            {searchMode === "route" && (
              <Legend color="#60a5fa" label="본선 경로" />
            )}
            <Legend
              color="#f5b544"
              label={searchMode === "nearby" ? "선택한 주유소" : "선택한 주유소 경유"}
            />
            <Legend color="#4ade80" label="가까운 곳보다 이득" />
            <Legend color="#94a3b8" label="차이 미미" />
            <Legend color="#f87171" label="가까운 곳보다 손해" />
            <span className="pt-0.5 text-[10px] text-muted-foreground">
              {searchMode === "nearby"
                ? "주유소를 누르면 가는 길"
                : "주유소를 누르면 경유 경로"}
            </span>
          </div>
        </div>

        <aside className="flex min-h-0 w-full flex-1 flex-col overflow-hidden border-t border-border lg:w-[420px] lg:flex-none lg:border-t-0 lg:border-l xl:w-[460px]">
          <div className="flex shrink-0 gap-1 border-b border-border p-2">
            <TabButton
              active={tab === "result"}
              onClick={() => setTab("result")}
              icon={MapIcon}
            >
              추천 결과
            </TabButton>
            <TabButton
              active={tab === "settings"}
              onClick={() => setTab("settings")}
              icon={SlidersHorizontal}
            >
              차량·조건
            </TabButton>
          </div>

          <SwipePages
            index={tab === "result" ? 0 : 1}
            onIndexChange={(next) => setTab(next === 0 ? "result" : "settings")}
          >
            <ResultPanel
              plan={plan}
              loading={loading}
              error={error}
              selectedId={selectedId}
              onSelect={handleSelect}
              fromCache={fromCache}
              cachedAt={cachedAt}
              sampleStations={isSample && !fromCache}
            />
            <SettingsPanel
              vehicle={vehicle}
              preferences={preferences}
              onVehicleChange={(patch) =>
                setVehicle((current) => ({ ...current, ...patch }))
              }
              onPreferencesChange={(patch) =>
                setPreferences((current) => ({ ...current, ...patch }))
              }
            />
          </SwipePages>
        </aside>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        className="size-2.5 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof MapIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-input/30 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

export default Planner;
