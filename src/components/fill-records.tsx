"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/client-store";
import { fillEconomy, learnedKmPerLiter } from "@/lib/domain/economy";
import type { FillRecord } from "@/lib/domain/types";

interface Props {
  records: FillRecord[];
  currentKmPerLiter: number;
  onChange: (records: FillRecord[]) => void;
  onApply: (kmPerLiter: number) => void;
}

export function FillRecords({
  records,
  currentKmPerLiter,
  onChange,
  onApply,
}: Props) {
  const [kmDriven, setKmDriven] = useState("420");
  const [liters, setLiters] = useState("38");
  const learned = learnedKmPerLiter(records);

  const add = () => {
    const km = Number(kmDriven);
    const l = Number(liters);
    if (!Number.isFinite(km) || !Number.isFinite(l) || km < 3 || l < 0.5) return;
    onChange([
      ...records,
      { id: newId("fill"), at: new Date().toISOString(), kmDriven: km, liters: l },
    ]);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        직전 주유 이후 달린 거리와 이번에 넣은 양만 있으면 됩니다. 기록은 이
        브라우저에만 남고 서버로 보내지 않습니다. 두 건부터 가중평균으로
        실주행 연비를 추정합니다.
      </p>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          주행거리 (km)
          <Input
            type="number"
            min={3}
            value={kmDriven}
            onChange={(event) => setKmDriven(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          주입량 (L)
          <Input
            type="number"
            min={0.5}
            step={0.1}
            value={liters}
            onChange={(event) => setLiters(event.target.value)}
          />
        </label>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="size-3.5" />
          추가
        </Button>
      </div>

      {records.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          기록이 없습니다. 두 번 이상 넣으면 공인연비 대신 실측값을 쓸 수
          있습니다.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {records
            .slice()
            .reverse()
            .map((record) => (
              <li
                key={record.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-input/10 px-2.5 py-1.5 text-xs"
              >
                <span>
                  {record.kmDriven.toFixed(0)}km / {record.liters.toFixed(1)}L
                  <span className="ml-2 font-mono text-muted-foreground">
                    {fillEconomy(record).toFixed(1)} km/L
                  </span>
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() =>
                    onChange(records.filter((item) => item.id !== record.id))
                  }
                  aria-label="기록 삭제"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-input/15 px-3 py-2">
        <div className="text-xs">
          <div className="text-muted-foreground">학습된 연비</div>
          <div className="font-mono text-sm">
            {learned === null ? "기록 2건 필요" : `${learned.toFixed(1)} km/L`}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={learned === null || learned === currentKmPerLiter}
          onClick={() => learned !== null && onApply(learned)}
        >
          차량 연비에 적용
        </Button>
      </div>
    </div>
  );
}
