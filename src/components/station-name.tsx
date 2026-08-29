import type { Brand } from "@/lib/domain/types";
import { BRAND_LABEL } from "@/lib/domain/types";
import { stationTradeName } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  brand: Brand;
  className?: string;
  brandClassName?: string;
  tradeClassName?: string;
}

/** 상표를 앞에 두고 상호는 옆에 작게 적는다. */
export function StationName({
  name,
  brand,
  className,
  brandClassName,
  tradeClassName,
}: Props) {
  const trade = stationTradeName(name, brand);
  const brandLabel = BRAND_LABEL[brand];
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1.5", className)}>
      <span className={cn("shrink-0 font-medium", brandClassName)}>
        {brandLabel}
      </span>
      {trade && trade !== brandLabel && (
        <span
          className={cn(
            "truncate text-[11px] font-normal text-muted-foreground",
            tradeClassName,
          )}
        >
          {trade}
        </span>
      )}
    </span>
  );
}
