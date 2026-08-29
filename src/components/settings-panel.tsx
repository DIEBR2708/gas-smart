"use client";

import {
  Clock,
  CreditCard,
  Fuel,
  Gauge,
  Route as RouteIcon,
  SlidersHorizontal,
} from "lucide-react";
import { DiscountEditor } from "@/components/discount-editor";
import { FillRecords } from "@/components/fill-records";
import { PlaceSearch } from "@/components/place-search";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  Brand,
  FillPolicy,
  FillRecord,
  FuelKind,
  NamedPlace,
  Preferences,
  Route,
  Vehicle,
} from "@/lib/domain/types";
import { BRAND_LABEL, FUEL_KIND_LABEL } from "@/lib/domain/types";
import { TIME_PACE, TIME_PACE_ORDER, timePaceFromKrw } from "@/lib/domain/time-pace";
import { fromSeoulInputValue, krw, liters, toSeoulInputValue } from "@/lib/format";
import { cn } from "@/lib/utils";

const FUEL_KINDS: FuelKind[] = ["gasoline", "diesel", "premium", "lpg"];

const FILL_MODES: { mode: FillPolicy["mode"]; label: string; hint: string }[] = [
  {
    mode: "toDestination",
    label: "필요한 만큼",
    hint: "목적지에서 예비량만 남도록 최소한만 넣습니다.",
  },
  {
    mode: "full",
    label: "가득",
    hint: "탱크를 채웁니다. 남는 연료는 시세로 환산해 비용에서 상계합니다.",
  },
  {
    mode: "fixedBudget",
    label: "금액 지정",
    hint: "정해진 금액만큼 넣습니다. 모자란 연료는 시세로 비용에 더합니다.",
  },
  {
    mode: "fixedLiters",
    label: "리터 지정",
    hint: "정해진 양만 넣습니다.",
  },
];

const BRANDS: Brand[] = ["SKE", "GSC", "HDO", "SOL", "RTE", "NHO", "ETC"];

interface Props {
  routes: Route[];
  routeId: string;
  origin: NamedPlace | null;
  destination: NamedPlace | null;
  departAt: Date;
  vehicle: Vehicle;
  preferences: Preferences;
  fills: FillRecord[];
  onRouteChange: (id: string) => void;
  onOriginChange: (place: NamedPlace) => void;
  onDestinationChange: (place: NamedPlace) => void;
  onDepartAtChange: (date: Date) => void;
  onVehicleChange: (patch: Partial<Vehicle>) => void;
  onPreferencesChange: (patch: Partial<Preferences>) => void;
  onFillsChange: (records: FillRecord[]) => void;
  onUserLocation?: (lat: number, lng: number) => void;
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof Fuel;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <Icon className="size-3.5" />
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="cursor-help text-sm text-foreground/85 underline decoration-dotted decoration-muted-foreground/60 underline-offset-4" />
              }
            >
              {label}
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{hint}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-sm text-foreground/85">{label}</span>
        )}
        {value && (
          <span className="font-mono text-sm text-primary">{value}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {options.map((option) => {
        const active = option.value === value;
        const button = (
          <button
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "w-full rounded-lg border px-2 py-1.5 text-xs transition-colors",
              active
                ? "border-primary/70 bg-primary/15 text-primary"
                : "border-border bg-input/20 text-muted-foreground hover:bg-input/40 hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
        if (!option.hint) {
          return (
            <span key={option.value} className="block">
              {button}
            </span>
          );
        }
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={<span className="block" />}>
              {button}
            </TooltipTrigger>
            <TooltipContent className="max-w-56">{option.hint}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function num(value: number | readonly number[]): number {
  return Array.isArray(value) ? value[0] : (value as number);
}

function seoulTodayAt(hour: number, minute: number): Date {
  const now = toSeoulInputValue(new Date()).slice(0, 10);
  return fromSeoulInputValue(
    `${now}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  );
}

export function SettingsPanel({
  routes,
  routeId,
  origin,
  destination,
  departAt,
  vehicle,
  preferences,
  fills,
  onRouteChange,
  onOriginChange,
  onDestinationChange,
  onDepartAtChange,
  onVehicleChange,
  onPreferencesChange,
  onFillsChange,
  onUserLocation,
}: Props) {
  const tankPercent = Math.round(
    (vehicle.currentFuelL / vehicle.tankCapacityL) * 100,
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle icon={RouteIcon}>경로</SectionTitle>
        <PlaceSearch
          id="origin"
          label="출발"
          value={origin}
          onChange={onOriginChange}
          allowGeolocation
          onLocated={onUserLocation}
        />
        <PlaceSearch
          id="destination"
          label="도착"
          value={destination}
          onChange={onDestinationChange}
          allowGeolocation
          onLocated={onUserLocation}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          지명·도로명으로 검색하거나 현재 위치를 쓰세요. 미리보기에서 위치가
          막히면 지도 위 검색창의 「지도에서」를 누른 뒤 지도를 찍으면 됩니다.
          아래 샘플 경로는 출발·도착을 한 번에 채웁니다.
        </p>
        <div className="space-y-1.5">
          {routes.map((route) => {
            const active = route.id === routeId;
            return (
              <button
                key={route.id}
                type="button"
                onClick={() => onRouteChange(route.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-primary/70 bg-primary/10"
                    : "border-border bg-input/20 hover:bg-input/40",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {route.origin.name} → {route.destination.name}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {(route.distanceM / 1000).toFixed(0)}km
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {route.summary}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <SectionTitle icon={Clock}>출발 시각</SectionTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          평일 출퇴근이면 우회 시간과 도착 시각을 정체 배수로 늘립니다. 카카오
          키가 있고 출발이 10분 뒤~48시간 안이면 미래운행정보 길찾기를 먼저
          칩니다.
        </p>
        <Input
          type="datetime-local"
          value={toSeoulInputValue(departAt)}
          onChange={(event) => {
            const next = fromSeoulInputValue(event.target.value);
            if (!Number.isNaN(next.getTime())) onDepartAtChange(next);
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { label: "지금", date: new Date() },
              { label: "출근 08:00", date: seoulTodayAt(8, 0) },
              { label: "퇴근 18:00", date: seoulTodayAt(18, 0) },
            ] as const
          ).map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => onDepartAtChange(chip.date)}
              className="rounded-md border border-border bg-input/20 px-2 py-1 text-[11px] text-muted-foreground hover:bg-input/40 hover:text-foreground"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <SectionTitle icon={Gauge}>차량</SectionTitle>

        <Field label="유종">
          <Segmented
            options={FUEL_KINDS.map((kind) => ({
              value: kind,
              label: FUEL_KIND_LABEL[kind].replace("자동차부탄(LPG)", "LPG"),
            }))}
            value={vehicle.fuelKind}
            onChange={(fuelKind) => onVehicleChange({ fuelKind })}
          />
        </Field>

        <Field
          label="실주행 연비"
          value={`${vehicle.kmPerLiter.toFixed(1)} km/L`}
          hint="공인연비가 아니라 직접 측정한 값을 넣으세요. 공인연비를 쓰면 절감액이 실제보다 크게 계산됩니다."
        >
          <Slider
            value={[vehicle.kmPerLiter]}
            min={4}
            max={25}
            step={0.1}
            onValueChange={(value) =>
              onVehicleChange({ kmPerLiter: num(value) })
            }
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tank" className="text-sm text-foreground/85">
              탱크 용량 (L)
            </Label>
            <Input
              id="tank"
              type="number"
              min={20}
              max={200}
              value={vehicle.tankCapacityL}
              onChange={(event) => {
                const tankCapacityL = Number(event.target.value);
                if (!Number.isFinite(tankCapacityL)) return;
                onVehicleChange({
                  tankCapacityL,
                  currentFuelL: Math.min(vehicle.currentFuelL, tankCapacityL),
                });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reserve" className="text-sm text-foreground/85">
              도착 시 예비량 (L)
            </Label>
            <Input
              id="reserve"
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={vehicle.reserveL}
              onChange={(event) => {
                const reserveL = Number(event.target.value);
                if (!Number.isFinite(reserveL)) return;
                onVehicleChange({ reserveL });
              }}
            />
          </div>
        </div>

        <Field
          label="현재 연료량"
          value={`${liters(vehicle.currentFuelL)} · ${tankPercent}%`}
          hint="이 값이 후보 범위를 결정합니다. 도달할 수 없는 주유소는 아예 추천하지 않습니다."
        >
          <Slider
            value={[vehicle.currentFuelL]}
            min={0}
            max={vehicle.tankCapacityL}
            step={0.5}
            onValueChange={(value) =>
              onVehicleChange({ currentFuelL: num(value) })
            }
          />
        </Field>
      </section>

      <Separator />

      <section className="space-y-4">
        <SectionTitle icon={Fuel}>주유 방식</SectionTitle>

        <Segmented
          options={FILL_MODES.map((m) => ({
            value: m.mode,
            label: m.label,
            hint: m.hint,
          }))}
          value={preferences.fillPolicy.mode}
          onChange={(mode) => {
            const next: FillPolicy =
              mode === "fixedBudget"
                ? { mode, krw: 50_000 }
                : mode === "fixedLiters"
                  ? { mode, liters: 30 }
                  : { mode: mode as "full" | "toDestination" };
            onPreferencesChange({ fillPolicy: next });
          }}
        />

        {preferences.fillPolicy.mode === "fixedBudget" && (
          <Field
            label="주유 금액"
            value={krw(preferences.fillPolicy.krw)}
          >
            <Slider
              value={[preferences.fillPolicy.krw]}
              min={10_000}
              max={200_000}
              step={5_000}
              onValueChange={(value) =>
                onPreferencesChange({
                  fillPolicy: { mode: "fixedBudget", krw: num(value) },
                })
              }
            />
          </Field>
        )}

        {preferences.fillPolicy.mode === "fixedLiters" && (
          <Field
            label="주유량"
            value={liters(preferences.fillPolicy.liters, 0)}
          >
            <Slider
              value={[preferences.fillPolicy.liters]}
              min={5}
              max={vehicle.tankCapacityL}
              step={1}
              onValueChange={(value) =>
                onPreferencesChange({
                  fillPolicy: { mode: "fixedLiters", liters: num(value) },
                })
              }
            />
          </Field>
        )}

        <Field
          label="공통 카드 할인"
          value={`${preferences.cardDiscountKrwPerL}원/L`}
          hint="모든 주유소에 적용되는 정액 할인입니다. 브랜드별로만 깎는 규칙은 아래 할인 프로필에 넣으세요. 둘을 같은 카드로 중복 입력하면 두 번 깎입니다."
        >
          <Slider
            value={[preferences.cardDiscountKrwPerL]}
            min={0}
            max={200}
            step={10}
            onValueChange={(value) =>
              onPreferencesChange({ cardDiscountKrwPerL: num(value) })
            }
          />
        </Field>
      </section>

      <Separator />

      <section className="space-y-3">
        <SectionTitle icon={CreditCard}>할인 프로필</SectionTitle>
        <DiscountEditor
          rules={preferences.discountRules}
          onChange={(discountRules) => onPreferencesChange({ discountRules })}
        />
      </section>

      <Separator />

      <section className="space-y-3">
        <SectionTitle icon={Gauge}>연비 학습</SectionTitle>
        <FillRecords
          records={fills}
          currentKmPerLiter={vehicle.kmPerLiter}
          onChange={onFillsChange}
          onApply={(kmPerLiter) => onVehicleChange({ kmPerLiter })}
        />
      </section>

      <Separator />

      <section className="space-y-4">
        <SectionTitle icon={SlidersHorizontal}>우회 허용치와 판단 기준</SectionTitle>

        <Field
          label="시간 여유"
          value={TIME_PACE[timePaceFromKrw(preferences.timeValueKrwPerMin)].label}
          hint="순위를 매길 때만 우회 시간을 돈으로 환산합니다. 목록에 보이는 금액은 실제로 쓰는 돈이고, 시간은 그 아래 +5분처럼 따로 적습니다."
        >
          <div className="grid grid-cols-3 gap-1.5">
            {TIME_PACE_ORDER.map((pace) => {
              const meta = TIME_PACE[pace];
              const active = timePaceFromKrw(preferences.timeValueKrwPerMin) === pace;
              return (
                <button
                  key={pace}
                  type="button"
                  onClick={() =>
                    onPreferencesChange({ timeValueKrwPerMin: meta.krwPerMin })
                  }
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs transition-colors",
                    active
                      ? "border-primary/70 bg-primary/15 text-primary"
                      : "border-border bg-input/20 text-muted-foreground hover:bg-input/40 hover:text-foreground",
                  )}
                >
                  <span className="block font-medium">{meta.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug opacity-80">
                    {pace === "rushed"
                      ? "가까운 곳 우선"
                      : pace === "relaxed"
                        ? "싼 곳 우선"
                        : "균형"}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="최대 우회 거리"
            value={`${preferences.maxDetourKm.toFixed(1)}km`}
          >
            <Slider
              value={[preferences.maxDetourKm]}
              min={0.5}
              max={20}
              step={0.5}
              onValueChange={(value) =>
                onPreferencesChange({ maxDetourKm: num(value) })
              }
            />
          </Field>
          <Field
            label="최대 우회 시간"
            value={`${preferences.maxDetourMin}분`}
          >
            <Slider
              value={[preferences.maxDetourMin]}
              min={2}
              max={60}
              step={1}
              onValueChange={(value) =>
                onPreferencesChange({ maxDetourMin: num(value) })
              }
            />
          </Field>
        </div>

        <Field
          label="이 금액 미만은 절약으로 보지 않음"
          value={krw(preferences.minMeaningfulSavingKrw)}
          hint="연비와 가격 추정에는 오차가 있습니다. 오차보다 작은 이득을 절약이라고 표시하면 사용자를 속이는 셈입니다."
        >
          <Slider
            value={[preferences.minMeaningfulSavingKrw]}
            min={0}
            max={5000}
            step={100}
            onValueChange={(value) =>
              onPreferencesChange({ minMeaningfulSavingKrw: num(value) })
            }
          />
        </Field>

        <div className="space-y-3 rounded-lg border border-border bg-input/15 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>셀프 주유소만 보기</span>
            <Switch
              checked={preferences.selfServiceOnly}
              onCheckedChange={(checked) =>
                onPreferencesChange({ selfServiceOnly: checked })
              }
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>
              고속도로 진출 회피
              <span className="block text-xs text-muted-foreground">
                본선을 벗어나면 통행료와 시간이 크게 늘어납니다
              </span>
            </span>
            <Switch
              checked={preferences.avoidHighwayExit}
              onCheckedChange={(checked) =>
                onPreferencesChange({ avoidHighwayExit: checked })
              }
            />
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-sm text-foreground/85">브랜드 제한</span>
          <div className="flex flex-wrap gap-1.5">
            {BRANDS.map((brand) => {
              const active = preferences.brands.includes(brand);
              return (
                <Badge
                  key={brand}
                  variant={active ? "default" : "outline"}
                  className="cursor-pointer select-none"
                  render={
                    <button
                      type="button"
                      onClick={() =>
                        onPreferencesChange({
                          brands: active
                            ? preferences.brands.filter((b) => b !== brand)
                            : [...preferences.brands, brand],
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
          {preferences.brands.length === 0 && (
            <p className="text-xs text-muted-foreground">
              선택하지 않으면 모든 브랜드를 비교합니다.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
