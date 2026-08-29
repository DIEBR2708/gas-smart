"use client";

import {
  CheckCircle2,
  CircleSlash,
  Flag,
  Info,
  Route as RouteIcon,
  ShieldCheck,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { CostBreakdown } from "@/components/cost-breakdown";
import { FuelTimeline } from "@/components/fuel-timeline";
import type { ReportKind, RefuelPlan, StationReport, Verdict } from "@/lib/domain/types";
import { BRAND_LABEL } from "@/lib/domain/types";
import { km, krw, liters, perLiter, signedKrw } from "@/lib/format";
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
  reports?: StationReport[];
  onReport?: (stationId: string, stationName: string, kind: ReportKind) => void;
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
  "multi-stop": {
    icon: RouteIcon,
    tone: "border-violet-500/40 bg-violet-500/10 text-violet-300",
    label: "나눠 넣어야 함",
  },
};

const REPORT_ACTIONS: { kind: ReportKind; label: string }[] = [
  { kind: "price-mismatch", label: "현장 가격이 다름" },
  { kind: "closed", label: "영업하지 않음" },
  { kind: "gone", label: "폐업·이전" },
];

function ReportActions({
  stationId,
  stationName,
  reports,
  onReport,
}: {
  stationId: string;
  stationName: string;
  reports: StationReport[];
  onReport: (stationId: string, stationName: string, kind: ReportKind) => void;
}) {
  const existing = reports.find((item) => item.stationId === stationId);
  return (
    <div className="rounded-lg border border-border bg-input/10 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Flag className="size-3.5" />
        현장 제보
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        이 기기 안에만 남습니다. 폐업·휴업은 다음 계산에서 빼고, 가격 불일치는
        단가를 40원/L 비관적으로 올립니다.
      </p>
      {existing ? (
        <p className="mt-2 text-xs text-amber-300">
          이미 제보함:{" "}
          {REPORT_ACTIONS.find((item) => item.kind === existing.kind)?.label}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {REPORT_ACTIONS.map((action) => (
            <Button
              key={action.kind}
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onReport(stationId, stationName, action.kind)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
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
  reports = [],
  onReport,
}: Props) {
  if (error && !plan) {
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
      <div className={cn("rounded-xl border p-4", verdict.tone)}>
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          <VerdictIcon className="size-4" />
          {verdict.label}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {plan.headline}
        </p>
        {plan.best &&
          (plan.verdict === "detour-worth-it" || plan.verdict === "multi-stop") && (
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
                      name: stop.option.station.name,
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
                    <span className="block truncate text-sm">
                      {stop.option.station.name}
                    </span>
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
              {onReport && (
                <ReportActions
                  stationId={selected.station.id}
                  stationName={selected.station.name}
                  reports={reports}
                  onReport={onReport}
                />
              )}
            </>
          )}
        </>
      )}

      <SearchScope plan={plan} />

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

/**
 * 무엇을 봤고 무엇을 보지 않았는지 밝히는 패널.
 *
 * 결과 목록만 보여주면 사용자는 그것이 경로 주변 전수 비교라고 오해한다.
 * 회랑 밖은 조회조차 하지 않고, 조회한 것 중에서도 일부만 정밀 계산한다.
 * 그 경계를 숨기면 안 된다.
 */
function SearchScope({ plan }: { plan: RefuelPlan }) {
  const { meta } = plan;
  const grouped = new Map<string, string[]>();
  for (const item of plan.excluded) {
    const list = grouped.get(item.reason) ?? [];
    list.push(item.station.name);
    grouped.set(item.reason, list);
  }
  const reasons = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-input/10 p-3">
      <h3 className="text-xs font-semibold">이 결과가 본 범위</h3>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <dt>조회 회랑</dt>
        <dd className="text-right font-mono text-foreground/80">
          경로 좌우 {(meta.corridorHalfWidthM / 1000).toFixed(1)}km
        </dd>
        <dt>반경 검색 호출</dt>
        <dd className="text-right font-mono text-foreground/80">
          {meta.searchCallCount}회 · 반경 {(meta.searchRadiusM / 1000).toFixed(0)}km
        </dd>
        <dt>조회된 주유소</dt>
        <dd className="text-right font-mono text-foreground/80">
          {meta.candidateCount}곳
        </dd>
        <dt>실제 우회 경로까지 계산</dt>
        <dd className="text-right font-mono text-foreground/80">
          {meta.exactlyEvaluated}곳
        </dd>
      </dl>

      {meta.corridorTruncated && (
        <p className="flex gap-1.5 rounded-md bg-amber-500/12 px-2 py-1.5 text-[11px] text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            우회 허용치가 넓어 경로 좌우{" "}
            {(meta.requestedHalfWidthM / 1000).toFixed(1)}km까지 봐야 하지만,
            유가 API의 반경 상한(5km) 때문에{" "}
            {(meta.corridorHalfWidthM / 1000).toFixed(1)}km까지만 조회했습니다.
            더 멀리 있는 주유소는 이 목록에 없습니다.
          </span>
        </p>
      )}

      {meta.optimalityGuaranteed ? (
        <p className="flex gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
          <span>
            계산하지 않은 후보는 최소 우회(왕복 직선거리)만 가정해도 1위보다
            비쌉니다. 회랑 안에서 더 싼 선택은 없습니다.
          </span>
        </p>
      ) : (
        <p className="flex gap-1.5 rounded-md bg-amber-500/12 px-2 py-1.5 text-[11px] text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            계산 한도({meta.exactlyEvaluated}곳)에 걸려 남은 후보를 확인하지
            못했습니다. 더 나은 곳이 있을 수 있습니다.
          </span>
        </p>
      )}

      {reasons.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            제외된 {plan.excluded.length}곳을 이유별로 보기
          </summary>
          <ul className="mt-2 space-y-2">
            {reasons.map(([reason, names]) => (
              <li key={reason}>
                <div className="flex justify-between gap-2 text-[11px]">
                  <span className="text-foreground/80">{reason}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {names.length}곳
                  </span>
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                  {names.join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
