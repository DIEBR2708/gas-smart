"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Loader2,
  Map as MapIcon,
  Minus,
  Plus,
  Route as RouteIcon,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { ApplyDock } from "@/components/apply-dock";
import {
  clampScale,
  PinchScale,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
} from "@/components/pinch-scale";
import { ResultPanel } from "@/components/result-panel";
import { SearchPanel } from "@/components/search-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { SHEET_DEFAULT_RATIO, SheetHandle } from "@/components/sheet-handle";
import { SwipePages } from "@/components/swipe-pages";
import { ThemeToggle } from "@/components/theme-toggle";
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
  loadPanelLayout,
  loadSession,
  saveDiscountRules,
  savePanelLayout,
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
import { changedSettingLabels } from "@/lib/settings-diff";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

const RouteMap = dynamic(() => import("@/components/route-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

interface Props {
  routes: Route[];
}

/**
 * 아래 패널이 보여 줄 쪽.
 *
 * `search`는 폰 배치에만 있다. 넓은 화면에서는 같은 입력이 지도 위 카드로
 * 떠 있어서, 패널에까지 두면 같은 것이 두 군데가 된다.
 */
type Tab = "result" | "settings" | "search";

const PHONE_TABS: Tab[] = ["result", "settings", "search"];
const WIDE_TABS: Tab[] = ["result", "settings"];

const TAB_META: Record<Tab, { label: string; icon: typeof MapIcon }> = {
  result: { label: "추천 결과", icon: MapIcon },
  settings: { label: "차량·조건", icon: SlidersHorizontal },
  search: { label: "경로 찾기", icon: RouteIcon },
};

/**
 * 폰에서 아래 탭 막대가 차지하는 높이 (px).
 *
 * 떠 있는 "변경사항 적용" 카드를 그 위로 밀어 두는 데만 쓴다. 막대의 실제
 * 높이는 아래 JSX가 정하므로, 그 여백을 바꾸면 이 값도 같이 봐야 한다.
 */
const PHONE_TAB_BAR_PX = 56;

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
    layout: loadPanelLayout(),
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
  /*
    차량·조건은 편집한 즉시 반영하지 않는다. 슬라이더를 한 칸 밀 때마다 경로를
    다시 계산하면 조회가 줄줄이 나가고 화면이 계속 비워진다. 편집은 초안(draft)에
    모아 두고, 떠 있는 카드에서 "적용"을 눌렀을 때만 아래 값으로 옮긴다.
  */
  const [vehicle, setVehicle] = useState<Vehicle>(boot.vehicle);
  const [preferences, setPreferences] = useState<Preferences>(boot.preferences);
  const [draftVehicle, setDraftVehicle] = useState<Vehicle>(boot.vehicle);
  const [draftPreferences, setDraftPreferences] = useState<Preferences>(
    boot.preferences,
  );
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("result");
  /* 폰에서만 의미가 있다. lg 이상에서는 지도와 패널이 나란히 놓인다. */
  const [searchOpen, setSearchOpen] = useState(true);
  const [cardScale, setCardScale] = useState(
    () => clampScale(boot.layout.cardScale ?? 1),
  );
  const [sheetRatio, setSheetRatio] = useState(
    () => boot.layout.sheetRatio ?? SHEET_DEFAULT_RATIO,
  );
  /**
   * 접기 전 높이. 다시 펼 때 그 자리로 돌려놓는다.
   *
   * 손잡이로 끌어 접든 탭을 다시 눌러 접든 같은 자리로 돌아와야 하므로,
   * 기억은 두 곳이 함께 보는 여기에 둔다.
   */
  const openRatioRef = useRef(
    sheetRatio > 0 ? sheetRatio : SHEET_DEFAULT_RATIO,
  );
  useEffect(() => {
    if (sheetRatio > 0) openRatioRef.current = sheetRatio;
  }, [sheetRatio]);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [mapPick, setMapPick] = useState<"origin" | "destination" | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [previewRoute, setPreviewRoute] = useState<Route | null>(null);
  /**
   * 사용자가 고른 주유소를 정밀 계산 맨 앞으로 보내달라는 요청.
   *
   * `key`는 이 요청이 어느 출발·도착 조합에서 나왔는지다. 출발지나 도착지가
   * 바뀌면 키가 어긋나 저절로 무효가 된다. 따로 지우는 코드를 두면 그 초기화가
   * 또 한 번의 재조회를 부른다.
   */
  const [priority, setPriority] = useState<{ id: string; key: string } | null>(
    null,
  );

  /*
    폰 배치인지 넓은 배치인지는 대부분 CSS(`lg:`)로 가른다. 여기까지 올린
    것은 아래 패널에 몇 쪽이 들어가는지가 스와이프가 어디까지 넘어가는지를
    정하기 때문이다. 그건 보이고 안 보이고가 아니라 동작이다.
  */
  const phoneLayout = useMediaQuery(PHONE_LAYOUT);
  const tabs = phoneLayout ? PHONE_TABS : WIDE_TABS;
  /* 폰에서 경로 쪽을 보다가 화면이 넓어지면 갈 곳이 없다. 결과로 돌려보낸다. */
  const activeTab: Tab = tabs.includes(tab) ? tab : "result";
  const collapsed = phoneLayout && sheetRatio === 0;

  /**
   * 아래 탭을 눌렀을 때.
   *
   * 다른 탭으로 옮기는 것만으로는 접지 않는다. 보려고 누른 탭이 방금 보던
   * 목록을 치워 버리면 안 된다. 다만 지금 보고 있는 탭을 다시 누른 것은
   * 치우자는 뜻이므로 접고, 접힌 상태에서 누르면 접기 전 높이로 펴 준다.
   */
  const selectTab = useCallback(
    (next: Tab) => {
      setTab(next);
      if (!phoneLayout) return;
      if (sheetRatio === 0) setSheetRatio(openRatioRef.current);
      else if (next === activeTab) setSheetRatio(0);
    },
    [phoneLayout, sheetRatio, activeTab],
  );

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

  /* 끌고 있는 동안에는 프레임마다 값이 바뀐다. 손을 멈춘 뒤에 한 번 남긴다. */
  useEffect(() => {
    const timer = setTimeout(
      () => savePanelLayout({ cardScale, sheetRatio }),
      300,
    );
    return () => clearTimeout(timer);
  }, [cardScale, sheetRatio]);

  /*
    계획을 다시 부르는 기준은 좌표다. 지도를 찍은 뒤 주소가 늦게 도착해 이름만
    바뀌는 경우까지 재조회하면, 같은 자리를 두 번 계산하며 화면이 다시 비워진다.
  */
  const originKey = origin ? `${origin.lat},${origin.lng}` : "";
  const destinationKey = destination ? `${destination.lat},${destination.lng}` : "";
  const corridorKey = `${searchMode}|${originKey}|${destinationKey}`;
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
      let gotPartial = false;
      fetchPlan(
        {
          routeId,
          searchMode,
          origin: from ?? undefined,
          destination: searchMode === "nearby" ? undefined : to ?? undefined,
          vehicle,
          preferences,
          departAt: departAt.toISOString(),
          priorityStationId:
            priority?.key === corridorKey ? priority.id : undefined,
        },
        controller.signal,
        {
          onRoute: (route) => {
            if (seq !== requestSeq.current) return;
            setPreviewRoute(route);
          },
          /*
            어림 순위가 먼저 온다. 정밀 계산을 기다리는 4초 동안 화면을
            비워 두지 않으려는 것이므로, 도착하는 대로 바로 건다.
          */
          onPlan: (partial) => {
            if (seq !== requestSeq.current) return;
            gotPartial = true;
            setData(partial);
            setError(null);
            setFromCache(false);
            setCachedAt(null);
          },
        },
      )
        .then((response) => {
          if (seq !== requestSeq.current) return;
          setData(response);
          setError(null);
          setFromCache(false);
          setCachedAt(null);
          // 어림값은 저장하지 않는다. 다음에 켰을 때 그게 확정처럼 보인다.
          if (!response.plan.meta.provisional) cachePlan(response);
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
          /*
            어림 순위는 이미 화면에 있다. 정밀 계산만 실패한 것이므로 지난번
            저장본으로 되돌리면 오히려 오래된 값으로 후퇴한다. 사유만 알리고,
            "곧 정확해진다"는 표시는 거둔다.
          */
          if (gotPartial) {
            setError(message);
            setData((current) =>
              current?.plan.meta.provisional
                ? {
                    ...current,
                    plan: {
                      ...current.plan,
                      meta: { ...current.plan.meta, provisional: false },
                    },
                  }
                : current,
            );
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
    corridorKey,
    priority,
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

  /*
    고른 곳의 실제 경유 경로를 먼저 가져온다.

    아직 어림값만 있는 주유소를 눌렀다면, 그 한 곳을 정밀 계산 맨 앞으로
    보내 다시 요청한다. 진행 중이던 요청은 취소되지만 이미 나간 길찾기
    결과는 서버 캐시에 남으므로 버려지는 것은 대기 시간뿐이다.
  */
  const handleSelect = useCallback(
    (id: string) => {
      if (mapPick) return;
      const next = selectedId === id ? null : id;
      setSelectedId(next);
      setTab("result");
      if (!next || fromCache || searchMode === "nearby") return;
      const option = data?.plan.options.find((o) => o.station.id === next);
      if (option && option.detour.source === "geometric-estimate") {
        setPriority({ id: next, key: corridorKey });
      }
    },
    [mapPick, selectedId, fromCache, searchMode, data, corridorKey],
  );

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

  /**
   * 지도를 눌러 좌표를 찍는 모드로 들어간다.
   *
   * 폰에서는 아래 패널이 지도를 절반쯤 덮는다. 찍으라고 해 놓고 찍을 자리를
   * 가려 두면 안 되므로, 지정을 시작할 때 패널을 내려 준다.
   */
  const requestMapPick = useCallback(
    (next: "origin" | "destination" | null) => {
      setMapPick(next);
      if (next && phoneLayout) setSheetRatio(0);
    },
    [phoneLayout],
  );

  /* 지도 위 카드와 아래 패널이 같은 입력을 쓴다. 넘길 것을 한 군데 모은다. */
  const searchControls = {
    searchMode,
    onSearchModeChange: (mode: "route" | "nearby") => {
      setSearchMode(mode);
      // 목적지가 없는 모드로 가면, 목적지를 찍으려던 참이었어도 찍을 곳이 없다.
      setMapPick((current) =>
        mode === "route" ? null : current === "destination" ? null : current,
      );
    },
    origin,
    destination,
    onOriginChange: setOrigin,
    onDestinationChange: setDestination,
    mapPick,
    onMapPickChange: requestMapPick,
    onLocated: (lat: number, lng: number) => setUserLocation({ lat, lng }),
  };

  const plan = data?.plan ?? null;
  const isSample = data?.dataMode !== "live";
  const pendingChanges = changedSettingLabels(
    { vehicle, preferences },
    { vehicle: draftVehicle, preferences: draftPreferences },
  );
  const searchSummary =
    searchMode === "nearby"
      ? (origin?.name ?? "위치 지정")
      : `${origin?.name ?? "출발"} → ${destination?.name ?? "도착"}`;

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
          <ThemeToggle />
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

      <div
        ref={layoutRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
      >
        {/*
          막은 지도를 덮되, 가리는 동안에도 눌러야 하는 검색창과 범례는 그 위에
          남는다. 쌓임 순서는 globals.css의 --layer-* 에 모아 두었다.
          나타나는 것만 늦춘다. 캐시에서 바로 돌아오는 조회까지 덮으면 깜빡임만 남는다.
        */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[var(--layer-map-veil)] flex items-center justify-center bg-slate-900/25 backdrop-blur-[1px] transition-opacity duration-200 dark:bg-slate-950/45",
            loading ? "opacity-100 delay-200" : "opacity-0 delay-0",
          )}
          aria-hidden={!loading}
        >
          <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
            <Loader2 className="size-4 animate-spin text-primary" />
            {searchMode === "nearby" ? "주변 주유소 찾는 중" : "경로 로드중"}
          </div>
        </div>
        {/*
          지도는 아래 패널이 놓아 준 자리를 전부 가져간다. 패널 높이는
          사용자가 손잡이로 정하므로 여기서는 남은 공간을 채우기만 한다.
          Leaflet은 컨테이너 크기 변화를 ResizeObserver로 받아 다시 그린다.
        */}
        <div className="relative min-h-[4rem] flex-1 lg:h-auto lg:min-h-0">
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
          {/*
            지도 위에 겹쳐 둔 검색창은 넓은 화면에서만 쓴다. 폰에서는 같은
            입력이 아래 패널의 "경로 찾기" 쪽으로 들어간다. 좁은 화면에서
            지도를 반쯤 가리는 카드는 얻는 것보다 잃는 것이 크다.

            넓은 화면에서도 지도를 넓게 보고 싶을 때가 있으므로 접을 수 있게
            둔다. 접으면 출발·도착만 남은 알약이 되고, 누르면 다시 펴진다.
          */}
          {!phoneLayout && !searchOpen && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="pointer-events-auto absolute top-3 left-3 z-[var(--layer-map-control)] flex max-w-[min(calc(100%-1.5rem),20.5rem)] items-center gap-2 rounded-full border border-border bg-background/92 py-2 pr-3 pl-2.5 shadow-lg backdrop-blur"
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs font-medium">{searchSummary}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          )}
          {!phoneLayout && (
            <PinchScale
              scale={cardScale}
              onScaleChange={setCardScale}
              maxWidth="20.5rem"
              inset="1.5rem"
              className={cn(
                "pointer-events-auto absolute top-3 left-3 z-[var(--layer-map-control)] rounded-xl border border-border bg-background/92 p-3 shadow-lg backdrop-blur",
                !searchOpen && "hidden",
              )}
            >
              <SearchPanel
                {...searchControls}
                idPrefix="map"
                actions={
                  <>
                    {/*
                      두 손가락으로 카드를 집어 키울 수 있지만, 마우스에는
                      그런 동작이 없다. 같은 일을 하는 버튼을 함께 둔다.
                    */}
                    <button
                      type="button"
                      aria-label="검색창 작게"
                      disabled={cardScale <= SCALE_MIN}
                      onClick={() =>
                        setCardScale(clampScale(cardScale - SCALE_STEP))
                      }
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-input/40 hover:text-foreground disabled:opacity-35"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="검색창 크게"
                      disabled={cardScale >= SCALE_MAX}
                      onClick={() =>
                        setCardScale(clampScale(cardScale + SCALE_STEP))
                      }
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-input/40 hover:text-foreground disabled:opacity-35"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label="검색창 접기"
                            onClick={() => setSearchOpen(false)}
                            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-input/40 hover:text-foreground"
                          >
                            <ChevronUp className="size-4" />
                          </button>
                        }
                      />
                      <TooltipContent>
                        접어서 지도 넓게 보기. 두 손가락으로 집으면 크기가 바뀝니다.
                      </TooltipContent>
                    </Tooltip>
                  </>
                }
              />
            </PinchScale>
          )}
          <div className="pointer-events-none absolute top-3 right-3 z-[var(--layer-map-control)] hidden flex-col gap-1 rounded-lg border border-border bg-background/85 px-2.5 py-2 text-[11px] backdrop-blur sm:flex">
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

        {/*
          패널 높이는 손잡이로 정한다. 폰에서만 쓰는 값이므로 lg 이상에서는
          CSS가 auto로 되돌리고, 지도와 나란히 놓인 예전 배치를 그대로 쓴다.
        */}
        <aside
          style={
            {
              "--sheet-h": sheetRatio > 0 ? `${(sheetRatio * 100).toFixed(1)}%` : "auto",
            } as React.CSSProperties
          }
          className="flex h-[var(--sheet-h,auto)] min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-border lg:h-auto lg:w-[420px] lg:flex-none lg:border-t-0 lg:border-l xl:w-[460px]"
        >
          <SheetHandle
            ratio={sheetRatio}
            onChange={setSheetRatio}
            onCollapse={() => setSheetRatio(0)}
            containerRef={layoutRef}
            className={cn("shrink-0 lg:hidden", collapsed && "hidden")}
          />

          {/*
            폰에서는 이 막대가 화면 맨 아래에 놓인다. 엄지가 닿는 자리이고,
            접었을 때 남는 것도 이 막대뿐이다. 넓은 화면에서는 옆에 세워진
            패널의 머리말이므로 위로 올라간다.
          */}
          <div
            className={cn(
              "flex shrink-0 gap-1 border-border p-2",
              phoneLayout
                ? "order-last border-t pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                : "border-b",
            )}
          >
            {tabs.map((name) => (
              <TabButton
                key={name}
                active={!collapsed && name === activeTab}
                onClick={() => selectTab(name)}
                icon={TAB_META[name].icon}
              >
                {TAB_META[name].label}
              </TabButton>
            ))}
          </div>

          <SwipePages
            index={tabs.indexOf(activeTab)}
            onIndexChange={(next) => setTab(tabs[next])}
            className={cn(collapsed && "hidden")}
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
              vehicle={draftVehicle}
              preferences={draftPreferences}
              nearby={searchMode === "nearby"}
              onVehicleChange={(patch) =>
                setDraftVehicle((current) => ({ ...current, ...patch }))
              }
              onPreferencesChange={(patch) =>
                setDraftPreferences((current) => ({ ...current, ...patch }))
              }
            />
            {phoneLayout && (
              <SearchPanel {...searchControls} idPrefix="sheet" />
            )}
          </SwipePages>
        </aside>
      </div>

      <ApplyDock
        bottomInset={phoneLayout ? PHONE_TAB_BAR_PX : 0}
        labels={pendingChanges}
        onApply={() => {
          setVehicle(draftVehicle);
          setPreferences(draftPreferences);
        }}
        onRevert={() => {
          setDraftVehicle(vehicle);
          setDraftPreferences(preferences);
        }}
      />
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
