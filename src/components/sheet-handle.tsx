"use client";

import { useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 아래 패널의 높이를 손가락으로 정하는 손잡이.
 *
 * 폰에서는 지도와 결과 목록이 같은 화면을 나눠 쓴다. 지도를 넓게 보고 싶을
 * 때와 후보 목록을 길게 훑고 싶을 때가 번갈아 오므로, 두 단계로 접었다
 * 펴는 것만으로는 부족하다. 끌어서 원하는 높이에 둔다.
 *
 * 끌기는 높이만 바꾼다. 접고 펴는 것은 오른쪽 버튼만 한다. 끌다가 손이
 * 미끄러져 패널이 사라지거나, 높이를 잡으려 짚었을 뿐인데 접히면 방금 보던
 * 목록을 잃는다. 없어지는 동작은 명시적으로 누를 때만 일어나야 한다.
 *
 * 높이는 화면 대비 비율로 다룬다. 회전하거나 주소창이 접혀 화면 높이가
 * 바뀌어도 손으로 정한 배분이 유지된다.
 */

/** 끌어서 줄일 수 있는 가장 낮은 높이. 이 아래로는 버튼으로만 접는다. */
export const SHEET_MIN_RATIO = 0.16;
/** 지도가 아예 사라지지 않도록 남겨 두는 몫 */
export const SHEET_MAX_RATIO = 0.82;
/** 접기 전 높이를 기억해 두지 못했을 때 쓰는 기본값 */
export const SHEET_DEFAULT_RATIO = 0.58;

/** 이 정도 움직이기 전에는 높이를 건드리지 않는다 (px) */
const DRAG_SLOP_PX = 6;

interface Props {
  /** 0이면 접힌 상태. 그 외에는 세로 배분 비율 */
  ratio: number;
  onChange: (ratio: number) => void;
  /**
   * 접기와 펴기를 오간다.
   *
   * 접기 전 높이를 기억하는 일은 이 손잡이 밖에서 한다. 아래 탭 막대도 같은
   * 자리로 되돌려야 하는데, 기억이 여기 있으면 두 벌이 생긴다.
   */
  onToggle: () => void;
  /** 높이를 재는 기준이 되는 세로 배치 컨테이너 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 접혀 있을 때 손잡이에 남길 한 줄 요약 */
  label: string;
  className?: string;
}

export function SheetHandle({
  ratio,
  onChange,
  onToggle,
  containerRef,
  label,
  className,
}: Props) {
  const dragRef = useRef<{ y: number; travel: number } | null>(null);
  const open = ratio > 0;

  const ratioAt = (clientY: number): number => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.height === 0) return ratio;
    const next = (box.bottom - clientY) / box.height;
    return Math.min(Math.max(next, SHEET_MIN_RATIO), SHEET_MAX_RATIO);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { y: event.clientY, travel: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.travel = Math.max(drag.travel, Math.abs(event.clientY - drag.y));
    if (drag.travel < DRAG_SLOP_PX) return;
    const next = ratioAt(event.clientY);
    if (next !== ratio) onChange(next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const nudge = (delta: number) => {
    if (!open) return;
    onChange(
      Math.min(Math.max(ratio + delta, SHEET_MIN_RATIO), SHEET_MAX_RATIO),
    );
  };

  const Chevron = open ? ChevronDown : ChevronUp;

  return (
    <div className={cn("flex items-center gap-2 pr-1.5 pl-3", className)}>
      <div
        role="slider"
        tabIndex={open ? 0 : -1}
        aria-label="결과 패널 높이"
        aria-orientation="vertical"
        aria-valuemin={Math.round(SHEET_MIN_RATIO * 100)}
        aria-valuemax={Math.round(SHEET_MAX_RATIO * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={`화면의 ${Math.round(ratio * 100)}%`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          nudge(event.key === "ArrowUp" ? 0.08 : -0.08);
        }}
        className={cn(
          "flex min-w-0 flex-1 touch-none items-center gap-2 py-2 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50",
          open && "cursor-grab active:cursor-grabbing",
        )}
      >
        {open && (
          <span className="h-1 w-8 shrink-0 rounded-full bg-border" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {open ? "끌어서 높이 조절" : label}
        </span>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "결과 패널 접기" : "결과 패널 펴기"}
        onClick={onToggle}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-input/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Chevron className="size-4" />
      </button>
    </div>
  );
}

export default SheetHandle;
