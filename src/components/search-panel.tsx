"use client";

import type { ReactNode } from "react";
import { PlaceSearch } from "@/components/place-search";
import type { NamedPlace } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/**
 * 어디서 어디로 갈지 정하는 입력 묶음.
 *
 * 두 자리에 놓인다. 넓은 화면에서는 지도 위에 떠 있는 카드 안에, 폰에서는
 * 아래 패널의 한 쪽으로 들어간다. 지도를 반쯤 가리는 카드는 화면이 좁을수록
 * 손해가 커서, 폰에서는 탭으로 접어 두는 편이 낫다.
 *
 * 두 자리에 같은 것을 두 벌 그리지 않으려고 떼어 냈다. 상태는 하나도 갖지
 * 않는다. 배치에 따라 다르게 보여야 하는 것은 `actions`로만 받는다.
 */

type SearchMode = "route" | "nearby";
type PickTarget = "origin" | "destination";

interface Props {
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  origin: NamedPlace | null;
  destination: NamedPlace | null;
  onOriginChange: (place: NamedPlace | null) => void;
  onDestinationChange: (place: NamedPlace | null) => void;
  /** 지금 지도를 눌러 지정하기를 기다리는 칸. 없으면 null */
  mapPick: PickTarget | null;
  onMapPickChange: (next: PickTarget | null) => void;
  onLocated: (lat: number, lng: number) => void;
  /** 입력 id 앞에 붙일 말. 같은 화면에 두 벌이 떠도 id가 겹치지 않게 한다. */
  idPrefix: string;
  /** 모드 전환 오른쪽에 덧붙일 것 (배율·접기 등). 배치마다 다르다. */
  actions?: ReactNode;
  className?: string;
}

export function SearchPanel({
  searchMode,
  onSearchModeChange,
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  mapPick,
  onMapPickChange,
  onLocated,
  idPrefix,
  actions,
  className,
}: Props) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-input/30 p-0.5">
          <ModeButton
            active={searchMode === "route"}
            onClick={() => onSearchModeChange("route")}
          >
            경로에서
          </ModeButton>
          <ModeButton
            active={searchMode === "nearby"}
            onClick={() => onSearchModeChange("nearby")}
          >
            이 자리에서
          </ModeButton>
        </div>
        {actions}
      </div>

      <PlaceSearch
        id={`${idPrefix}-origin`}
        label={searchMode === "nearby" ? "위치" : "출발"}
        value={origin}
        onChange={(place) => {
          onOriginChange(place);
          onMapPickChange(null);
        }}
        allowGeolocation
        onLocated={onLocated}
        mapPickActive={mapPick === "origin"}
        onRequestMapPick={() =>
          onMapPickChange(mapPick === "origin" ? null : "origin")
        }
      />

      {searchMode === "route" && (
        <PlaceSearch
          id={`${idPrefix}-destination`}
          label="도착"
          value={destination}
          onChange={(place) => {
            onDestinationChange(place);
            onMapPickChange(null);
          }}
          allowGeolocation
          onLocated={onLocated}
          mapPickActive={mapPick === "destination"}
          onRequestMapPick={() =>
            onMapPickChange(mapPick === "destination" ? null : "destination")
          }
        />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export default SearchPanel;
