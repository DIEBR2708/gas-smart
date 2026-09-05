"use client";

import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { RankedOption } from "@/lib/domain/types";
import { StationName } from "@/components/station-name";
import {
  km,
  krw,
  liters,
  minutes,
  perLiter,
  relativeTime,
  signedMinutes,
} from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  option: RankedOption;
  baseline: RankedOption | null;
  referencePriceKrwPerL: number;
}

function Row({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
      <div className="shrink-0 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}

export function CostBreakdown({
  option,
  baseline,
  referencePriceKrwPerL,
}: Props) {
  const station = option.station;
  const isBaseline = baseline?.station.id === station.id;
  const discount = option.listPriceKrwPerL - option.effectivePriceKrwPerL;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              <StationName
                name={station.name}
                brand={station.brand}
                className="text-base"
                tradeClassName="text-sm"
              />
            </h3>
            <p className="text-xs text-muted-foreground">
              {[
                station.isSelfService ? "셀프" : null,
                station.openingHours.allDay
                  ? "24시간"
                  : `${station.openingHours.open}~${station.openingHours.close}`,
                relativeTime(station.priceUpdatedAt),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Badge variant={isBaseline ? "secondary" : "default"}>
            {isBaseline ? "기준 경로" : `${option.rank}위`}
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
      </div>

      {option.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {option.warnings.map((warning) => (
            <li
              key={warning.code}
              className={cn(
                "flex gap-2 rounded-md px-2.5 py-2 text-xs",
                warning.severity === "error"
                  ? "bg-destructive/15 text-red-700 dark:text-red-300"
                  : warning.severity === "warn"
                    ? "bg-amber-500/12 text-amber-800 dark:text-amber-300"
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

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        표시 가격은 주유소가 신고한 값이라 현장 가격과 다를 수 있습니다.
      </p>
    </div>
  );
}
