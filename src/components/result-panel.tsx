"use client";

import { CircleSlash, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { CostBreakdown } from "@/components/cost-breakdown";
import { FuelTimeline } from "@/components/fuel-timeline";
import { shouldSuggestSkipRefuel } from "@/lib/domain/cost";
import { isUnreachableByCarMessage } from "@/lib/domain/driving-region";
import { FUEL_KIND_LABEL, type RankedOption, type RefuelPlan } from "@/lib/domain/types";
import { StationName } from "@/components/station-name";
import {
  cashCostKrw,
  km,
  stationHeading,
  krw,
  liters,
  perLiter,
  signedMinutes,
} from "@/lib/format";
import { kakaoMapMultiStopUrl } from "@/lib/navi-links";
import { cn } from "@/lib/utils";

interface Props {
  plan: RefuelPlan | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  fromCache?: boolean;
  cachedAt?: string | null;
}

function compareSaving(option: RankedOption, baseline: RankedOption | null) {
  if (!baseline) return 0;
  return cashCostKrw(baseline) - cashCostKrw(option);
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function ResultPanel({
  plan,
  loading,
  error,
  selectedId,
  onSelect,
  fromCache,
  cachedAt,
}: Props) {
  if (error && !plan) {
    const unreachable = isUnreachableByCarMessage(error);
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 font-medium text-red-300">
          <TriangleAlert className="size-4" />
          {unreachable ? "자동차로 갈 수 없는 구간" : "계산에 실패했습니다"}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        {unreachable && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            제주·울릉처럼 배로만 이어진 곳은 직선으로 잇지 않습니다. 육지 안의
            출발·도착을 골라 주세요.
          </p>
        )}
      </div>
    );
  }

  if (loading && !plan) return <LoadingState />;
  if (!plan) return <LoadingState />;

  const selected =
    plan.options.find((o) => o.station.id === selectedId) ?? plan.best;

  const FILL_REASON: Record<
    (typeof plan.itinerary)[number]["fillReason"],
    string
  > = {
    "enough-for-next": "다음 싼 곳까지",
    "fill-full": "가득",
    "last-stop": "목적지 예비량",
    "only-stop": "한 번만",
  };

  return (
    <div className={cn("space-y-5", loading && "opacity-60 transition-opacity")}>
      {shouldSuggestSkipRefuel(plan.vehicle, plan.route, plan.options) && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-100">
          <p className="font-medium">주유소 들를 필요 없습니다</p>
          <p className="mt-1 text-xs leading-relaxed text-sky-100/80">
            목적지까지 그냥 가도 연료가 남고, 도착지 근처에도 주유소가 있습니다.
            아래는 그래도 넣고 싶을 때 비교입니다.
          </p>
        </div>
      )}
      {fromCache && (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            통신에 실패해 기기에 남겨 둔 마지막 계획을 보여 줍니다
            {cachedAt ? ` (${new Date(cachedAt).toLocaleString("ko-KR")})` : ""}
            {error ? ` · ${error}` : ""}. 숫자는 지금 유가·정체가 아닙니다.
          </span>
        </div>
      )}
      {plan.itinerary.length >= 2 && (
        <div className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">나눠 넣는 순서</h2>
            <Button
              size="xs"
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={kakaoMapMultiStopUrl([
                    plan.route.origin,
                    ...plan.itinerary.map((stop) => ({
                      name: stationHeading(
                        stop.option.station.name,
                        stop.option.station.brand,
                      ),
                      lat: stop.option.station.lat,
                      lng: stop.option.station.lng,
                    })),
                    plan.route.destination,
                  ])}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              지도에서 일정 보기
            </Button>
          </div>
          <ol className="space-y-1.5">
            {plan.itinerary.map((stop, index) => (
              <li key={`${stop.option.station.id}-${index}`}>
                <button
                  type="button"
                  onClick={() => onSelect(stop.option.station.id)}
                  className="flex w-full items-start gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-2 text-left hover:bg-input/30"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-violet-500/80 text-[10px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <StationName
                      name={stop.option.station.name}
                      brand={stop.option.station.brand}
                      className="text-sm"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {FILL_REASON[stop.fillReason]} · {liters(stop.litersToBuy)} ·{" "}
                      {krw(stop.outOfPocketKrw)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card/60 p-3">
        <FuelTimeline
          route={plan.route}
          vehicle={plan.vehicle}
          option={selected ?? null}
          itinerary={plan.itinerary}
        />
        <Separator className="my-3" />
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div>
            <dd className="font-mono text-sm">
              {plan.canReachWithoutRefueling
                ? "0L"
                : liters(plan.litersRequiredWithoutDetour)}
            </dd>
            <dt className="text-[11px] text-muted-foreground">필요 주유량</dt>
          </div>
          <div>
            <dd className="font-mono text-sm">
              {perLiter(plan.referencePriceKrwPerL)}
            </dd>
            <dt className="text-[11px] text-muted-foreground">경로 주변 시세</dt>
          </div>
          <div>
            <dd className="font-mono text-sm">{plan.options.length}곳</dd>
            <dt className="text-[11px] text-muted-foreground">
              {FUEL_KIND_LABEL[plan.vehicle.fuelKind]} 후보
            </dt>
          </div>
        </dl>
      </div>

      {plan.options.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <CircleSlash className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">
            {FUEL_KIND_LABEL[plan.vehicle.fuelKind]} 주유소가 없습니다
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            우회 허용 거리·시간을 늘리거나 브랜드 조건을 풀어 보세요.
            {plan.excluded.length > 0 &&
              ` 지금은 ${plan.excluded.length}곳이 조건에서 걸러졌습니다.`}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">후보 비교</h2>
              <span className="text-[11px] text-muted-foreground">
                절약 · 작게는 실제 지출
              </span>
            </div>
            <ul className="space-y-1.5">
              {plan.options.map((option) => {
                const active = option.station.id === selected?.station.id;
                const isBest = option.station.id === plan.best?.station.id;
                const spend = cashCostKrw(option);
                const saving = compareSaving(option, plan.baseline);
                const isBaseline =
                  plan.baseline?.station.id === option.station.id;
                return (
                  <li key={option.station.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(option.station.id)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary/70 bg-primary/10"
                          : "border-border bg-input/15 hover:bg-input/35",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                              isBest
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary text-secondary-foreground",
                            )}
                          >
                            {option.rank}
                          </span>
                          <StationName
                            name={option.station.name}
                            brand={option.station.brand}
                            className="text-sm"
                          />
                        </span>
                        <span className="flex shrink-0 items-baseline justify-end gap-1.5">
                          <span
                            className={cn(
                              "font-mono text-sm font-semibold tabular-nums",
                              isBaseline
                                ? "text-muted-foreground"
                                : saving > 50
                                  ? "text-emerald-400"
                                  : saving < -50
                                    ? "text-red-400"
                                    : "text-muted-foreground",
                            )}
                          >
                            {isBaseline
                              ? "기준 경로"
                              : saving > 50
                                ? `${krw(saving)} 절약`
                                : saving < -50
                                  ? `${krw(-saving)} 손해`
                                  : "차이 없음"}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {krw(spend)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">
                          {signedMinutes(option.detour.extraDurationS)}
                        </span>
                        <span>·</span>
                        <span className="font-mono">
                          {perLiter(option.effectivePriceKrwPerL)}
                        </span>
                        <span>·</span>
                        <span>우회 {km(option.detour.extraDistanceM)}</span>
                        {option.station.isSelfService && (
                          <>
                            <span>·</span>
                            <span>셀프</span>
                          </>
                        )}
                        {option.warnings.some((w) => w.severity === "warn") && (
                          <TriangleAlert className="size-3 shrink-0 text-amber-400" />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {selected && (
            <>
              <Separator />
              <CostBreakdown
                option={selected}
                baseline={plan.baseline}
                route={plan.route}
                referencePriceKrwPerL={plan.referencePriceKrwPerL}
              />
            </>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          {plan.meta.stationProvider}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {plan.meta.routeProvider}
        </Badge>
      </div>
    </div>
  );
}
