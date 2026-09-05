"use client";

import {
  Children,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const IGNORE =
  'input, textarea, select, button, a, [role="slider"], [data-slot="slider"], [data-slot="switch"]';

function isSwipeBlocked(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(IGNORE));
}

interface Props {
  index: number;
  onIndexChange: (index: number) => void;
  children: ReactNode;
  className?: string;
}

/**
 * 여러 쪽을 가로로 밀어서 넘긴다.
 * 세로 스크롤과 슬라이더 조작은 가로 스와이프로 가로채지 않는다.
 */
export function SwipePages({
  index,
  onIndexChange,
  children,
  className,
}: Props) {
  /*
    Children.toArray는 `{조건 && <쪽/>}`이 남긴 false를 걸러 낸다. 걸러 내지
    않으면 화면에 없는 쪽이 자리만 차지해, 끝에서 빈 칸으로 한 번 더 넘어간다.
  */
  const pages = Children.toArray(children);
  const count = Math.max(1, pages.length);
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
      const next = index + (nextDrag < 0 ? 1 : -1);
      onIndexChange(Math.min(count - 1, Math.max(0, next)));
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
    // 양 끝에서는 끌리는 양을 줄여, 더 넘어갈 곳이 없다는 것을 손으로 알린다.
    if (index === 0 && next > 0) next *= 0.22;
    if (index === count - 1 && next < 0) next *= 0.22;
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

  /*
    안쪽 띠는 쪽 수만큼 넓고, 한 쪽은 그 1/count 다. 그래서 한 칸 넘기는 거리는
    화면 너비이자 띠 기준으로는 (100/count)% 다.
  */
  const pageWidth = 100 / count;

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
        className="flex h-full"
        style={{
          width: `${count * 100}%`,
          transform: `translate3d(calc(${-index * pageWidth}% + ${dragX}px), 0, 0)`,
          transition: dragging
            ? "none"
            : "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {pages.map((page, at) => (
          <div
            key={at}
            className="thin-scroll h-full min-h-0 overflow-y-auto overscroll-y-contain p-4"
            style={{ width: `${pageWidth}%` }}
          >
            {page}
          </div>
        ))}
      </div>
    </div>
  );
}
