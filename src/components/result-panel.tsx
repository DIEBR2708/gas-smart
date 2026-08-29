"use client";

import {
  CheckCircle2,
  CircleSlash,
  Info,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { CostBreakdown } from "@/components/cost-breakdown";
import { FuelTimeline } from "@/components/fuel-timeline";
import type { RefuelPlan, Verdict } from "@/lib/domain/types";
import { BRAND_LABEL } from "@/lib/domain/types";
import { km, krw, liters, perLiter, signedKrw } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  plan: RefuelPlan | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const VERDICT_STYLE: Record<
  Verdict,
  { icon: typeof Info; tone: string; label: string }
> = {
  "detour-worth-it": {
    icon: TrendingDown,
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    label: "우회할 가치가 있음",
  },
  marginal: {
    icon: TriangleAlert,
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    label: "오차 범위 안쪽",
  },
  "stay-on-route": {
    icon: CheckCircle2,
    tone: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    label: "경로 유지가 최선",
  },
  "no-candidates": {
    icon: CircleSlash,
    tone: "border-border bg-input/25 text-muted-foreground",
    label: "후보 없음",
  },
  "no-refuel-needed": {
    icon: CheckCircle2,
    tone: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    label: "주유 불필요",
  },
};

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
}: Props) {
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 font-medium text-red-300">
          <TriangleAlert className="size-4" />
          계산에 실패했습니다
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (loading && !plan) return <LoadingState />;
  if (!plan) return <LoadingState />;

  const verdict = VERDICT_STYLE[plan.verdict];
  const VerdictIcon = verdict.icon;
  const selected =
    plan.options.find((o) => o.station.id === selectedId) ?? plan.best;

  return (
    <div className={cn("space-y-5", loading && "opacity-60 transition-opacity")}>
      <div className={cn("rounded-xl border p-4", verdict.tone)}>
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          <VerdictIcon className="size-4" />
          {verdict.label}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {plan.headline}
        </p>
        {plan.best && plan.verdict === "detour-worth-it" && (
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl leading-none font-semibold text-emerald-300">
              {krw(plan.best.savingKrw)}
            </span>
            <span className="pb-0.5 text-xs text-muted-foreground">
              절약 (최악의 경우 {signedKrw(plan.best.savingPessimisticKrw)})
            </span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-3">
        <FuelTimeline
          route={plan.route}
          vehicle={plan.vehicle}
          option={selected ?? null}
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
              정밀 비교 후보
            </dt>
          </div>
        </dl>
      </div>

      {plan.options.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <CircleSlash className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">비교할 주유소가 없습니다</p>
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
                실질 총비용 기준 정렬
              </span>
            </div>
            <ul className="space-y-1.5">
              {plan.options.map((option) => {
                const active = option.station.id === selected?.station.id;
                const isBest = option.station.id === plan.best?.station.id;
                const isBaseline =
                  option.station.id === plan.baseline?.station.id;
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
                          <span className="truncate text-sm">
                            {option.station.name}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-mono text-sm tabular-nums",
                            option.savingKrw > 0
                              ? "text-emerald-400"
                              : option.savingKrw < 0
                                ? "text-red-400"
                                : "text-muted-foreground",
                          )}
                        >
                          {isBaseline ? "기준" : signedKrw(option.savingKrw)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">
                          {perLiter(option.effectivePriceKrwPerL)}
                        </span>
                        <span>·</span>
                        <span>우회 {km(option.detour.extraDistanceM)}</span>
                        <span>·</span>
                        <span className="truncate">
                          {BRAND_LABEL[option.station.brand]}
                          {option.station.isSelfService && " 셀프"}
                        </span>
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
                timeValueKrwPerMin={plan.preferences.timeValueKrwPerMin}
              />
            </>
          )}
        </>
      )}

      {plan.excluded.length > 0 && (
        <details className="rounded-lg border border-border bg-input/10 px-3 py-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            제외된 주유소 {plan.excluded.length}곳과 이유
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            {plan.excluded.slice(0, 30).map((item) => (
              <li key={item.station.id} className="flex justify-between gap-3">
                <span className="truncate">{item.station.name}</span>
                <span className="shrink-0 text-muted-foreground/70">
                  {item.reason}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          {plan.meta.stationProvider}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {plan.meta.routeProvider}
        </Badge>
        <span>
          {plan.meta.candidateCount}곳 조회 →{" "}
          {plan.options.length}곳 정밀 계산
        </span>
      </div>
    </div>
  );
}
