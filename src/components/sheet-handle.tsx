"use client";

import { useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 아래 패널의 높이를 손가락으로 정하는 손잡이.
 *
 * 폰에서는 지도와 결과 목록이 같은 화면을 나눠 쓴다. 지도를 넓게 보고 싶을
 * 때와 후보 목록을 길게 훑고 싶을 때가 번갈아 오므로, 두 단계로 접었다
 * 펴는 것만으로는 부족하다. 끌어서 원하는 높이에 두고, 끝까지 내리면
 * 손잡이만 남는다.
 *
 * 높이는 화면 대비 비율로 다룬다. 회전하거나 주소창이 접혀 화면 높이가
 * 바뀌어도 손으로 정한 배분이 유지된다.
 */

/** 이 아래로 내리면 접힌 것으로 본다 */
export const SHEET_MIN_RATIO = 0.16;
/** 지도가 아예 사라지지 않도록 남겨 두는 몫 */
export const SHEET_MAX_RATIO = 0.82;
/** 접기 전 높이를 기억해 두지 못했을 때 쓰는 기본값 */
export const SHEET_DEFAULT_RATIO = 0.58;

/** 이 정도 안에서 손을 떼면 끌기가 아니라 누른 것으로 본다 (px) */
const TAP_SLOP_PX = 6;

interface Props {
  /** 0이면 접힌 상태. 그 외에는 세로 배분 비율 */
  ratio: number;
  onChange: (ratio: number) => void;
  /** 높이를 재는 기준이 되는 세로 배치 컨테이너 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 접혀 있을 때 손잡이에 남길 한 줄 요약 */
  label: string;
  className?: string;
}

export function SheetHandle({
  ratio,
  onChange,
  containerRef,
  label,
  className,
}: Props) {
  const dragRef = useRef<{ y: number; travel: number } | null>(null);
  /** 접기 전 높이. 다시 펼 때 그 자리로 돌려놓는다. */
  const lastOpenRef = useRef(ratio > 0 ? ratio : SHEET_DEFAULT_RATIO);
  const open = ratio > 0;

  const ratioAt = (clientY: number): number => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.height === 0) return ratio;
    const next = (box.bottom - clientY) / box.height;
    if (next < SHEET_MIN_RATIO) return 0;
    return Math.min(next, SHEET_MAX_RATIO);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { y: event.clientY, travel: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.travel = Math.max(drag.travel, Math.abs(event.clientY - drag.y));
    if (drag.travel < TAP_SLOP_PX) return;
    const next = ratioAt(event.clientY);
    if (next > 0) lastOpenRef.current = next;
    if (next !== ratio) onChange(next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.travel >= TAP_SLOP_PX) return;
    toggle();
  };

  const toggle = () => {
    onChange(open ? 0 : lastOpenRef.current);
  };

  const nudge = (delta: number) => {
    const raw = Math.min(ratio + delta, SHEET_MAX_RATIO);
    const next = raw < SHEET_MIN_RATIO ? 0 : raw;
    if (next > 0) lastOpenRef.current = next;
    onChange(next);
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
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          nudge(event.key === "ArrowUp" ? 0.08 : -0.08);
        }
      }}
      className={cn(
        "flex touch-none cursor-grab items-center gap-2 px-3 py-2 outline-none select-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className="h-1 w-8 shrink-0 rounded-full bg-border" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {open ? "끌어서 높이 조절" : label}
      </span>
      <Chevron className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export default SheetHandle;
