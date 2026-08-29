"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Loader2, Map as MapIcon, SlidersHorizontal } from "lucide-react";
import { ResultPanel } from "@/components/result-panel";
import { SettingsPanel } from "@/components/settings-panel";
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
  loadFills,
  loadReports,
  loadSession,
  saveDiscountRules,
  saveFills,
  saveReports,
  saveSession,
  newId,
} from "@/lib/client-store";
import { DEFAULT_PREFERENCES, DEFAULT_VEHICLE } from "@/lib/domain/fixtures";
import type {
  NamedPlace,
  Preferences,
  ReportKind,
  Route,
  StationReport,
  Vehicle,
} from "@/lib/domain/types";
import { fetchPlan, type PlanResponse } from "@/lib/plan-client";
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
    fills: loadFills(),
    reports: loadReports(),
  };
}

export function Planner({ routes }: Props) {
  const [boot] = useState(() => initialPlannerState(routes));
  const [routeId, setRouteId] = useState(boot.routeId);
  const [origin, setOrigin] = useState<NamedPlace | null>(boot.origin);
  const [destination, setDestination] = useState<NamedPlace | null>(
    boot.destination,
  );
  const [departAt, setDepartAt] = useState(boot.departAt);
  const [vehicle, setVehicle] = useState<Vehicle>(boot.vehicle);
  const [preferences, setPreferences] = useState<Preferences>(boot.preferences);
  const [fills, setFills] = useState(boot.fills);
  const [reports, setReports] = useState(boot.reports);
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("result");

  const requestSeq = useRef(0);

  useEffect(() => {
    saveSession({
      vehicle,
      preferences,
      routeId,
      origin,
      destination,
      departAt: departAt.toISOString(),
    });
    saveDiscountRules(preferences.discountRules);
    saveFills(fills);
    saveReports(reports);
  }, [vehicle, preferences, routeId, origin, destination, departAt, fills, reports]);

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeq.current;

    const timer = setTimeout(() => {
      setLoading(true);
      fetchPlan(
        {
          routeId,
          origin: origin ?? undefined,
          destination: destination ?? undefined,
          vehicle,
          preferences,
          departAt: departAt.toISOString(),
          reports,
        },
        controller.signal,
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
            return stillThere
              ? current
              : (response.plan.best?.station.id ??
                  response.plan.itinerary[0]?.option.station.id ??
                  null);
          });
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || seq !== requestSeq.current) return;
          const message =
            cause instanceof Error ? cause.message : "알 수 없는 오류";
          const cached = loadCachedPlan();
          if (cached) {
            setData(cached.response);
            setFromCache(true);
            setCachedAt(cached.savedAt);
            setError(message);
            setSelectedId(
              cached.response.plan.best?.station.id ??
                cached.response.plan.itinerary[0]?.option.station.id ??
                null,
            );
          } else {
            setError(message);
          }
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [routeId, origin, destination, vehicle, preferences, departAt, reports]);

  const displayRoute = data?.plan.route ??
    routes.find((r) => r.id === routeId) ??
    routes[0];

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setTab("result");
  }, []);

  const handleSampleRoute = useCallback(
    (id: string) => {
      const next = routes.find((r) => r.id === id);
      if (!next) return;
      setRouteId(id);
      setOrigin(next.origin);
      setDestination(next.destination);
    },
    [routes],
  );

  const handleReport = useCallback(
    (stationId: string, stationName: string, kind: ReportKind) => {
      const report: StationReport = {
        id: newId("rep"),
        stationId,
        stationName,
        kind,
        note: "",
        reportedAt: new Date().toISOString(),
      };
      setReports((current) => [
        ...current.filter((item) => item.stationId !== stationId),
        report,
      ]);
    },
    [],
  );

  const plan = data?.plan ?? null;
  const isSample = data?.dataMode !== "live";
  const itineraryIds = useMemo(
    () => plan?.itinerary.map((stop) => stop.option.station.id) ?? [],
    [plan],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <MapIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              경로 위에서 가장 싸게 넣기
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              가격만 비교하지 않습니다. 우회 연료·시간·통행료까지 더한 실질
              비용으로 고릅니다.
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
                    ? "샘플 데이터"
                    : "실시간 데이터"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {fromCache
                ? "통신에 실패해 기기에 저장해 둔 마지막 결과를 보여 줍니다."
                : isSample
                  ? "오피넷·카카오 API 키가 없어 합성 샘플 데이터로 동작합니다. 계산 로직은 실데이터와 동일합니다."
                  : "오피넷 유가와 카카오모빌리티 경로를 실시간으로 조회하고 있습니다."}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[42vh] min-h-[260px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <RouteMap
            route={displayRoute}
            options={plan?.options ?? []}
            shapes={data?.shapes ?? {}}
            selectedId={selectedId}
            bestId={plan?.best?.station.id ?? null}
            itineraryIds={itineraryIds}
            onSelect={handleSelect}
          />
          <div className="pointer-events-none absolute top-3 right-3 z-[500] hidden flex-col gap-1 rounded-lg border border-border bg-background/85 px-2.5 py-2 text-[11px] backdrop-blur sm:flex">
            <Legend color="#f5b544" label="최저 실질비용" />
            <Legend color="#4ade80" label="기준선보다 이득" />
            <Legend color="#94a3b8" label="차이 미미" />
            <Legend color="#f87171" label="기준선보다 손해" />
          </div>
        </div>

        <aside className="flex min-h-0 w-full flex-col border-t border-border lg:w-[420px] lg:border-t-0 lg:border-l xl:w-[460px]">
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

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "result" ? (
              <ResultPanel
                plan={plan}
                loading={loading}
                error={error}
                selectedId={selectedId}
                onSelect={setSelectedId}
                fromCache={fromCache}
                cachedAt={cachedAt}
                reports={reports}
                onReport={handleReport}
              />
            ) : (
              <SettingsPanel
                routes={routes}
                routeId={routeId}
                origin={origin}
                destination={destination}
                departAt={departAt}
                vehicle={vehicle}
                preferences={preferences}
                fills={fills}
                onRouteChange={handleSampleRoute}
                onOriginChange={setOrigin}
                onDestinationChange={setDestination}
                onDepartAtChange={setDepartAt}
                onVehicleChange={(patch) =>
                  setVehicle((current) => ({ ...current, ...patch }))
                }
                onPreferencesChange={(patch) =>
                  setPreferences((current) => ({ ...current, ...patch }))
                }
                onFillsChange={setFills}
              />
            )}
          </div>
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
