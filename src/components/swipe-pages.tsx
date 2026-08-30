"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const IGNORE =
  'input, textarea, select, button, a, [role="slider"], [data-slot="slider"], [data-slot="switch"]';

function isSwipeBlocked(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(IGNORE));
}

interface Props {
  index: 0 | 1;
  onIndexChange: (index: 0 | 1) => void;
  children: [ReactNode, ReactNode];
  className?: string;
}

/**
 * 두 페이지를 가로로 밀어서 넘긴다.
 * 세로 스크롤과 슬라이더 조작은 가로 스와이프로 가로채지 않는다.
 */
export function SwipePages({
  index,
  onIndexChange,
  children,
  className,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{
    x: number;
    y: number;
    lock: "h" | "v" | null;
    pointerId: number;
  } | null>(null);
  const dragRef = useRef(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const finish = (nextDrag: number) => {
    const width = viewportRef.current?.clientWidth ?? 1;
    const threshold = Math.min(72, width * 0.18);
    if (Math.abs(nextDrag) > threshold) {
      onIndexChange(nextDrag < 0 ? 1 : 0);
    }
    startRef.current = null;
    dragRef.current = 0;
    setDragX(0);
    setDragging(false);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isSwipeBlocked(event.target)) return;
    startRef.current = {
      x: event.clientX,
      y: event.clientY,
      lock: null,
      pointerId: event.pointerId,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.lock) {
      if (Math.hypot(dx, dy) < 10) return;
      start.lock = Math.abs(dx) > Math.abs(dy) * 1.15 ? "h" : "v";
      if (start.lock === "h") {
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    if (start.lock !== "h") return;
    event.preventDefault();
    const width = viewportRef.current?.clientWidth ?? 1;
    let next = dx;
    if (index === 0 && next > 0) next *= 0.22;
    if (index === 1 && next < 0) next *= 0.22;
    next = Math.max(-width, Math.min(width, next));
    dragRef.current = next;
    setDragX(next);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (start.lock === "h") finish(dragRef.current);
    else startRef.current = null;
  };

  return (
    <div
      ref={viewportRef}
      className={cn("min-h-0 flex-1 overflow-hidden touch-pan-y", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="flex h-full w-[200%]"
        style={{
          transform: `translate3d(calc(${index === 0 ? "0%" : "-50%"} + ${dragX}px), 0, 0)`,
          transition: dragging ? "none" : "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div className="thin-scroll h-full w-1/2 min-h-0 overflow-y-auto overscroll-y-contain p-4">
          {children[0]}
        </div>
        <div className="thin-scroll h-full w-1/2 min-h-0 overflow-y-auto overscroll-y-contain p-4">
          {children[1]}
        </div>
      </div>
    </div>
  );
}
