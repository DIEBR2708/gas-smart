"use client";

import { useEffect, useRef, useState } from "react";
import { Check, GripHorizontal, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadDockPosition, saveDockPosition } from "@/lib/client-store";
import { summarizeChanges } from "@/lib/settings-diff";

/**
 * 바꾼 조건을 모아 두고 "적용"을 눌렀을 때만 경로를 다시 계산하게 하는 카드.
 *
 * 화면 어디에 두는지는 사용자가 정한다. 지도 위 주유소를 가리는 자리에 고정해
 * 두면, 비교하려던 후보가 카드에 덮여 보이지 않는다. 옮긴 자리는 기기에 남긴다.
 */

/** 뷰포트 밖으로 나가지 않도록 남겨 두는 여백 (px) */
const EDGE_MARGIN = 12;
/** 위치를 저장한 적이 없을 때 쓰는 카드 너비 추정값 (px) */
const ASSUMED_WIDTH = 300;

interface Position {
  x: number;
  y: number;
}

function clamp(x: number, y: number, width: number, height: number): Position {
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(x, EDGE_MARGIN), maxX),
    y: Math.min(Math.max(y, EDGE_MARGIN), maxY),
  };
}

/** 처음에는 오른쪽 아래. 지도와 결과 목록 위쪽을 되도록 비워 둔다. */
function defaultPosition(): Position {
  if (typeof window === "undefined") return { x: EDGE_MARGIN, y: EDGE_MARGIN };
  return clamp(
    window.innerWidth - ASSUMED_WIDTH - 20,
    window.innerHeight - 132,
    ASSUMED_WIDTH,
    112,
  );
}

interface Props {
  /** 적용을 기다리는 항목의 이름. 비어 있으면 카드를 띄우지 않는다. */
  labels: string[];
  onApply: () => void;
  onRevert: () => void;
}

export function ApplyDock({ labels, onApply, onRevert }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<{ dx: number; dy: number } | null>(null);
  const [position, setPosition] = useState<Position>(
    () => loadDockPosition() ?? defaultPosition(),
  );

  useEffect(() => {
    const onResize = () => {
      const card = cardRef.current;
      if (!card) return;
      setPosition((current) =>
        clamp(current.x, current.y, card.offsetWidth, card.offsetHeight),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card || event.button !== 0) return;
    const box = card.getBoundingClientRect();
    grabRef.current = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const grab = grabRef.current;
    const card = cardRef.current;
    if (!grab || !card) return;
    setPosition(
      clamp(
        event.clientX - grab.dx,
        event.clientY - grab.dy,
        card.offsetWidth,
        card.offsetHeight,
      ),
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!grabRef.current) return;
    grabRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const card = cardRef.current;
    if (card) {
      const box = card.getBoundingClientRect();
      saveDockPosition({ x: box.left, y: box.top });
    }
  };

  /** 키보드만 쓰는 사용자를 위한 이동. 한 번에 한 칸씩 밀어 준다. */
  const nudge = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 12;
    const delta: Record<string, Position> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = delta[event.key];
    const card = cardRef.current;
    if (!move || !card) return;
    event.preventDefault();
    const next = clamp(
      position.x + move.x,
      position.y + move.y,
      card.offsetWidth,
      card.offsetHeight,
    );
    setPosition(next);
    saveDockPosition(next);
  };

  if (labels.length === 0) return null;

  return (
    <div
      ref={cardRef}
      role="region"
      aria-label="적용하지 않은 조건 변경"
      style={{ left: position.x, top: position.y }}
      className="fixed z-[var(--layer-apply-dock)] w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-primary/40 bg-background/97 shadow-2xl ring-1 ring-primary/10 backdrop-blur"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="카드 위치 옮기기. 방향키로도 옮길 수 있습니다."
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={nudge}
        className="flex touch-none cursor-grab items-center gap-1.5 border-b border-border bg-input/25 px-2.5 py-1.5 text-xs text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <GripHorizontal className="size-3.5" />
        <span>끌어서 옮기기</span>
        <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {labels.length}개 대기
        </span>
      </div>

      <div className="space-y-2 p-3">
        <div>
          <p className="text-sm font-semibold">변경사항 적용</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            바꾼 항목: {summarizeChanges(labels)}. 적용을 누르기 전까지 경로는 다시
            계산하지 않습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={onApply}>
            <Check />
            적용
          </Button>
          <Button size="sm" variant="outline" onClick={onRevert}>
            <Undo2 />
            되돌리기
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ApplyDock;
