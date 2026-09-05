"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 안에 든 UI를 두 손가락으로 키우고 줄이는 껍데기.
 *
 * 지도 위에 겹쳐 둔 검색창은 폰에서 글씨가 작고, 태블릿에서는 반대로 자리를
 * 많이 먹는다. 화면 전체를 확대하면 지도까지 같이 늘어나므로, 이 UI만
 * 따로 배율을 준다.
 *
 * 배율은 그리기만 바꾸는 transform이다. 그래서 스케일을 올려도 안쪽 요소의
 * 배치를 다시 계산하지 않는다. 대신 커진 만큼 오른쪽으로 삐져나가므로,
 * 레이아웃 폭을 배율로 나눠 화면 안에 남긴다.
 */

export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.5;
export const SCALE_STEP = 0.1;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(Math.max(scale, SCALE_MIN), SCALE_MAX);
}

interface Props {
  scale: number;
  onScaleChange: (scale: number) => void;
  /** 배율 1일 때의 최대 너비 (CSS 길이). 화면이 좁으면 화면에 맞춘다. */
  maxWidth: string;
  /** 좁은 화면에서 좌우로 남겨 둘 여백 (CSS 길이) */
  inset: string;
  className?: string;
  children: ReactNode;
}

export function PinchScale({
  scale,
  onScaleChange,
  maxWidth,
  inset,
  className,
  children,
}: Props) {
  const points = useRef(new Map<number, { x: number; y: number }>());
  const startRef = useRef<{ spread: number; scale: number } | null>(null);

  const spread = (): number => {
    const [a, b] = [...points.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2) {
      startRef.current = { spread: spread(), scale };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId)) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = startRef.current;
    if (!start || start.spread === 0 || points.current.size < 2) return;
    onScaleChange(clampScale((start.scale * spread()) / start.spread));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    points.current.delete(event.pointerId);
    if (points.current.size < 2) startRef.current = null;
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        width: `min(calc((100% - ${inset}) / ${scale}), ${maxWidth})`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
      className={cn("touch-none origin-top-left", className)}
    >
      {children}
    </div>
  );
}

export default PinchScale;
