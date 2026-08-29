"use client";

import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { newId } from "@/lib/client-store";
import type { Brand, DiscountRule } from "@/lib/domain/types";
import { BRAND_LABEL } from "@/lib/domain/types";

const BRANDS: Brand[] = ["SKE", "GSC", "HDO", "SOL", "RTE", "RTX", "NHO", "ETC"];

interface Props {
  rules: DiscountRule[];
  onChange: (rules: DiscountRule[]) => void;
}

export function DiscountEditor({ rules, onChange }: Props) {
  const add = () => {
    onChange([
      ...rules,
      {
        id: newId("disc"),
        name: "제휴 카드",
        enabled: true,
        flatKrwPerL: 60,
        rate: 0,
        brands: [],
      },
    ]);
  };

  const patch = (id: string, next: Partial<DiscountRule>) => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        위 슬라이더의 공통 할인에 더해, 브랜드별로만 적용되는 규칙을 넣을 수
        있습니다. 같은 주유소에 여러 규칙이 겹치면 정액은 더하고 정률은
        합성합니다.
      </p>
      {rules.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          아직 조건부 할인이 없습니다. SK만 60원/L, GS는 3%처럼 브랜드를 가릴 수
          있습니다.
        </p>
      )}
      <ul className="space-y-2">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="space-y-2 rounded-lg border border-border bg-input/10 p-3"
          >
            <div className="flex items-center gap-2">
              <Input
                value={rule.name}
                onChange={(event) => patch(rule.id, { name: event.target.value })}
                className="h-8"
              />
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => patch(rule.id, { enabled: checked })}
                aria-label="규칙 사용"
              />
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
                aria-label="규칙 삭제"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                정액 (원/L)
                <Input
                  type="number"
                  min={0}
                  max={500}
                  value={rule.flatKrwPerL}
                  onChange={(event) =>
                    patch(rule.id, { flatKrwPerL: Number(event.target.value) || 0 })
                  }
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                정률 (%)
                <Input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={Math.round(rule.rate * 1000) / 10}
                  onChange={(event) =>
                    patch(rule.id, {
                      rate: Math.min(0.5, Math.max(0, Number(event.target.value) / 100 || 0)),
                    })
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              {BRANDS.map((brand) => {
                const active = rule.brands.includes(brand);
                return (
                  <Badge
                    key={brand}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer select-none text-[10px]"
                    render={
                      <button
                        type="button"
                        onClick={() =>
                          patch(rule.id, {
                            brands: active
                              ? rule.brands.filter((item) => item !== brand)
                              : [...rule.brands, brand],
                          })
                        }
                      />
                    }
                  >
                    {BRAND_LABEL[brand]}
                  </Badge>
                );
              })}
            </div>
            {rule.brands.length === 0 && (
              <p className="text-[10px] text-muted-foreground">
                브랜드를 고르지 않으면 모든 주유소에 적용됩니다.
              </p>
            )}
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" variant="outline" onClick={add}>
        <Plus className="size-3.5" />
        할인 규칙 추가
      </Button>
    </div>
  );
}
