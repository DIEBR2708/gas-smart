"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  applyThemeChoice,
  readThemeChoice,
  storeThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const CHOICES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "밝게", icon: Sun },
  { id: "dark", label: "어둡게", icon: Moon },
  { id: "system", label: "기기 설정", icon: Monitor },
];

export function ThemeToggle() {
  // 부트 스크립트와 같은 값을 읽어 시작한다. 둘이 어긋나면 화면이 번쩍인다.
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);

  // 개발 모드의 재마운트에서 React가 <html> 클래스를 초기화하므로 다시 입힌다.
  useLayoutEffect(() => {
    applyThemeChoice(choice);
  }, [choice]);

  useEffect(() => {
    if (choice !== "system" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyThemeChoice("system");
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [choice]);

  return (
    <div
      role="group"
      aria-label="화면 모드"
      className="flex items-center gap-0.5 rounded-lg bg-input/30 p-0.5"
    >
      {CHOICES.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={label}
                aria-pressed={choice === id}
                onClick={() => {
                  setChoice(id);
                  storeThemeChoice(id);
                }}
                className={cn(
                  "grid size-6 place-items-center rounded-md transition-colors",
                  choice === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            }
          />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
