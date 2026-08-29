"use client";

import type { RankedOption, Route, Vehicle } from "@/lib/domain/types";
import { liters } from "@/lib/format";

/**
 * 경로를 따라 연료가 어떻게 줄고 어디서 채워지는지 보여주는 그래프.
 *
 * 절감액 숫자만 보여주면 사용자는 "예비량을 깎아서 이득을 만든 것"인지
 * 구분할 수 없다. 잔량 곡선과 예비선을 같이 보여줘야 안전한 계획인지
 * 눈으로 확인할 수 있다.
 */

interface Props {
  route: Route;
  vehicle: Vehicle;
  option: RankedOption | null;
}

const W = 320;
const H = 84;
const PAD = { top: 10, right: 8, bottom: 16, left: 8 };

export function FuelTimeline({ route, vehicle, option }: Props) {
  const e = vehicle.kmPerLiter;
  const detourKm = option ? option.detour.extraDistanceM / 1000 : 0;
  const totalKm = route.distanceM / 1000 + detourKm;
  const alongKm = option ? option.detour.alongRouteM / 1000 + detourKm / 2 : null;

  const yMax = vehicle.tankCapacityL;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (km: number) => PAD.left + (km / totalKm) * plotW;
  const y = (l: number) =>
    PAD.top + plotH - (Math.max(0, Math.min(yMax, l)) / yMax) * plotH;

  const points: { km: number; l: number }[] = [];
  if (option && alongKm !== null) {
    const fuelAtPump = vehicle.currentFuelL - alongKm / e;
    points.push({ km: 0, l: vehicle.currentFuelL });
    points.push({ km: alongKm, l: fuelAtPump });
    points.push({ km: alongKm, l: fuelAtPump + option.litersToBuy });
    points.push({ km: totalKm, l: option.fuelAtDestinationL });
  } else {
    points.push({ km: 0, l: vehicle.currentFuelL });
    points.push({ km: totalKm, l: vehicle.currentFuelL - totalKm / e });
  }

  const line = points.map((p) => `${x(p.km)},${y(p.l)}`).join(" ");
  const area = `${PAD.left},${y(0)} ${line} ${x(totalKm)},${y(0)}`;
  const reserveY = y(vehicle.reserveL);
  const dry = points.some((p) => p.l < 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>연료 잔량</span>
        <span className="font-mono">
          {option
            ? `도착 시 ${liters(Math.max(0, option.fuelAtDestinationL))}`
            : `무주유 시 ${liters(vehicle.currentFuelL - totalKm / e)}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[84px] w-full"
        role="img"
        aria-label="경로에 따른 연료 잔량 변화"
      >
        <defs>
          <linearGradient id="fuelFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5b544" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f5b544" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        <rect
          x={PAD.left}
          y={reserveY}
          width={W - PAD.left - PAD.right}
          height={Math.max(0, y(0) - reserveY)}
          fill={dry ? "#f8717122" : "#f8717114"}
        />
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={reserveY}
          y2={reserveY}
          stroke="#f87171"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.7"
        />
        <text
          x={W - PAD.right}
          y={reserveY - 3}
          textAnchor="end"
          fontSize="8"
          fill="#f87171"
        >
          예비 {vehicle.reserveL}L
        </text>

        <polygon points={area} fill="url(#fuelFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#f5b544"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {option && alongKm !== null && (
          <>
            <line
              x1={x(alongKm)}
              x2={x(alongKm)}
              y1={PAD.top}
              y2={y(0)}
              stroke="#e2e8f0"
              strokeWidth="1"
              opacity="0.35"
            />
            <circle
              cx={x(alongKm)}
              cy={y(vehicle.currentFuelL - alongKm / e + option.litersToBuy)}
              r="3"
              fill="#f5b544"
            />
          </>
        )}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          strokeWidth="1"
          className="text-border"
        />
        <text x={PAD.left} y={H - 4} fontSize="8" fill="#94a3b8">
          {route.origin.name}
        </text>
        <text
          x={W - PAD.right}
          y={H - 4}
          textAnchor="end"
          fontSize="8"
          fill="#94a3b8"
        >
          {route.destination.name}
        </text>
      </svg>
    </div>
  );
}
