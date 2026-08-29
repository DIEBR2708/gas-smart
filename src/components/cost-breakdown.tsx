"use client";

import { AlertTriangle, ExternalLink, Info, Navigation } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { RankedOption, Route } from "@/lib/domain/types";
import { BRAND_LABEL } from "@/lib/domain/types";
import {
  cashCostKrw,
  displayStationName,
  km,
  krw,
  liters,
  minutes,
  perLiter,
  relativeTime,
  signedKrw,
  signedMinutes,
} from "@/lib/format";
import { kakaoMapRouteUrl, kakaoNaviDeepLink } from "@/lib/navi-links";
import { cn } from "@/lib/utils";

interface Props {
  option: RankedOption;
  baseline: RankedOption | null;
  route: Route;
  referencePriceKrwPerL: number;
}

function Row({
  label,
  value,
  detail,
  emphasis,
  negative,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className={cn("text-sm", emphasis && "font-semibold")}>{label}</div>
        {detail && (
          <div className="text-xs text-muted-foreground">{detail}</div>
        )}
      </div>
      <div
        className={cn(
          "shrink-0 font-mono text-sm tabular-nums",
          emphasis && "text-base font-semibold",
          negative && "text-emerald-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function CostBreakdown({
  option,
  baseline,
  route,
  referencePriceKrwPerL,
}: Props) {
  const station = option.station;
  const isBaseline = baseline?.station.id === station.id;
  const discount = option.listPriceKrwPerL - option.effectivePriceKrwPerL;

  const naviTarget = {
    lat: station.lat,
    lng: station.lng,
    name: displayStationName(station.name),
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              {displayStationName(station.name)}
            </h3>
            <p className="text-xs text-muted-foreground">
              {BRAND_LABEL[station.brand]}
              {station.isSelfService && " · 셀프"}
              {station.openingHours.allDay
                ? " · 24시간"
                : ` · ${station.openingHours.open}~${station.openingHours.close}`}
              {" · "}
              {relativeTime(station.priceUpdatedAt)}
            </p>
          </div>
          <Badge variant={isBaseline ? "secondary" : "default"}>
            {isBaseline ? "기준선" : `${option.rank}위`}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-input/15 p-2.5 text-center">
          <div>
            <div className="font-mono text-sm">{perLiter(option.effectivePriceKrwPerL)}</div>
            <div className="text-[11px] text-muted-foreground">할인 후 단가</div>
          </div>
          <div>
            <div className="font-mono text-sm">{km(option.detour.extraDistanceM)}</div>
            <div className="text-[11px] text-muted-foreground">우회 거리</div>
          </div>
          <div>
            <div className="font-mono text-sm">
              {minutes(option.detour.extraDurationS)}
            </div>
            <div className="text-[11px] text-muted-foreground">추가 시간</div>
          </div>
        </div>
      </div>

      <Separator />

      <div className="divide-y divide-border/60">
        <Row
          label="주유 결제액"
          detail={`${liters(option.litersToBuy)} × ${perLiter(option.effectivePriceKrwPerL)}${
            discount > 0 ? ` (표시가 ${perLiter(option.listPriceKrwPerL)}에서 ${Math.round(discount)}원 할인)` : ""
          }`}
          value={krw(option.outOfPocketKrw)}
        />
        <Row
          label="우회 시간"
          detail="순위 계산에만 반영하고, 아래 지출에는 넣지 않습니다"
          value={signedMinutes(option.detour.extraDurationS)}
        />
        {option.tollDeltaKrw !== 0 && (
          <Row
            label="통행료 증분"
            detail="고속도로를 진출·재진입하면 통행료가 다시 붙습니다"
            value={krw(option.tollDeltaKrw)}
          />
        )}
        {option.shortfallCostKrw > 0 && (
          <Row
            label="부족분 조달 비용"
            detail={`${liters(option.shortfallFuelL)}를 나중에 시세(${perLiter(referencePriceKrwPerL)})로 사야 합니다`}
            value={krw(option.shortfallCostKrw)}
          />
        )}
        {option.surplusCreditKrw > 0 && (
          <Row
            label="탱크에 남는 연료 가치"
            detail={`${liters(option.surplusFuelL)} × 시세 ${perLiter(referencePriceKrwPerL)} — 버린 돈이 아니라 자산이므로 상계합니다`}
            value={`-${krw(option.surplusCreditKrw)}`}
            negative
          />
        )}
        <Row
          label="실제 지출"
          detail={`주유·통행료·부족분에서 남는 연료 가치를 뺀 금액. 1L당 ${perLiter(option.krwPerUsefulLiter)}`}
          value={krw(cashCostKrw(option))}
          emphasis
        />
      </div>

      {baseline && !isBaseline && (
        <div className="space-y-2 rounded-lg border border-border bg-input/15 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              기준선({displayStationName(baseline.station.name)}) 대비
            </span>
            <span
              className={cn(
                "font-mono text-sm font-semibold",
                option.savingKrw >= 0 ? "text-emerald-400" : "text-red-400",
              )}
            >
              {signedKrw(cashCostKrw(baseline) - cashCostKrw(option))}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              연비 -15%, 가격 +25원/L, 우회 +25% 가정
            </span>
            <span
              className={cn(
                "font-mono text-sm",
                option.savingPessimisticKrw > 0
                  ? "text-emerald-400/80"
                  : "text-amber-400",
              )}
            >
              {signedKrw(option.savingPessimisticKrw)}
            </span>
          </div>
          {option.stockUpValueKrw > 100 && (
            <p className="flex gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                절감액 중{" "}
                <strong className="text-foreground">
                  {krw(option.stockUpValueKrw)}
                </strong>
                은 이번 여행에 쓰지 않고 탱크에 채워둔 싼 연료의 값입니다.
                지금 지갑에서 덜 나가는 돈은 아닙니다.
              </span>
            </p>
          )}
          {Number.isFinite(option.breakEvenDetourKm) &&
            option.breakEvenDetourKm > 0 && (
              <p className="flex gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  이 가격차라면 우회{" "}
                  <strong className="text-foreground">
                    {option.breakEvenDetourKm.toFixed(1)}km
                  </strong>
                  까지가 손익분기입니다. 실제 우회는{" "}
                  {km(option.detour.extraDistanceM)}입니다.
                </span>
              </p>
            )}
        </div>
      )}

      {option.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {option.warnings.map((warning) => (
            <li
              key={warning.code}
              className={cn(
                "flex gap-2 rounded-md px-2.5 py-2 text-xs",
                warning.severity === "error"
                  ? "bg-destructive/15 text-red-300"
                  : warning.severity === "warn"
                    ? "bg-amber-500/12 text-amber-300"
                    : "bg-input/25 text-muted-foreground",
              )}
            >
              {warning.severity === "info" ? (
                <Info className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="flex-1"
          nativeButton={false}
          render={<a href={kakaoNaviDeepLink(naviTarget)} />}
        >
          <Navigation className="size-4" />
          카카오내비로 안내
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          nativeButton={false}
          render={
            <a
              href={kakaoMapRouteUrl(route.origin, naviTarget, route.destination)}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <ExternalLink className="size-4" />
          지도에서 경로 보기
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        표시 가격은 주유소가 신고한 값이라 현장 가격과 다를 수 있습니다. 안내는
        출발 전에 확정하고, 주행 중에는 화면을 조작하지 마세요.
      </p>
    </div>
  );
}
