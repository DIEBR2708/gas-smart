"use client";

import { useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 아래 패널을 손가락으로 내리고 올리는 손잡이.
 *
 * 폰에서는 지도가 화면의 절반도 안 된다. 주유소 핀 사이를 두 손가락으로
 * 벌려 보려면 패널을 치울 수 있어야 한다. 눌러도 되고, 손잡이를 아래로
 * 끌어내려도 접힌다. 접힌 상태에서는 위로 끌어올린다.
 */

/** 이 정도 안에서 손을 떼면 끌기가 아니라 누른 것으로 본다 (px) */
const TAP_SLOP_PX = 6;
/** 이만큼 끌면 손을 떼기 전에 곧바로 접거나 편다 (px) */
const GESTURE_PX = 28;

interface Props {
  open: boolean;
  onChange: (open: boolean) => void;
  /** 접혀 있을 때 손잡이에 남길 한 줄 요약 */
  label: string;
  className?: string;
}

export function SheetHandle({ open, onChange, label, className }: Props) {
  const startY = useRef<number | null>(null);
  const travel = useRef(0);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startY.current = event.clientY;
    travel.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const dy = event.clientY - startY.current;
    travel.current = Math.max(travel.current, Math.abs(dy));
    if (dy > GESTURE_PX && open) {
      startY.current = null;
      onChange(false);
    } else if (dy < -GESTURE_PX && !open) {
      startY.current = null;
      onChange(true);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const tapped = startY.current !== null && travel.current < TAP_SLOP_PX;
    startY.current = null;
    if (tapped) onChange(!open);
  };

  const Chevron = open ? ChevronDown : ChevronUp;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={open ? "결과 패널 내리기" : "결과 패널 올리기"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onChange(!open);
      }}
      className={cn(
        "flex touch-none cursor-grab items-center gap-2 px-3 py-2 outline-none select-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className="h-1 w-8 shrink-0 rounded-full bg-border" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {open ? "아래로 끌어 내리기" : label}
      </span>
      <Chevron className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export default SheetHandle;
