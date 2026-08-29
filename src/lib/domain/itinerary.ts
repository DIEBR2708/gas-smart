import type { ItineraryStop, RankedOption, Route, Vehicle } from "./types";

/**
 * 탱크 제약 아래의 최소 비용 주유 순서.
 *
 * 상태: (지금 선 주유소, 도착 직후 잔량). 결정은 "얼마나 넣고 다음에 어디로 갈지".
 * 1차원·가격이 알려진 경우에는 아래 greedy가 최적이다 (Gas Station Problem).
 *
 *  - 출발지에서는 넣을 수 없다. 현재 연료로 닿는 곳 중 단가가 가장 싼 곳에 선다.
 *  - 선 곳에서 가득 채우면 닿는 후보 중 더 싼 곳이 있으면, 그중 가장 앞선
 *    곳까지 갈 만큼만 넣는다.
 *  - 더 싼 곳이 없으면 가득 채우고, 닿는 곳 중 가장 싼 곳으로 간다.
 *  - 마지막 정류에서 목적지 예비량을 채울 수 있으면 일정을 끝낸다.
 */

const TRANSIT_RESERVE_L = 0.8;

export interface ItineraryInput {
  route: Route;
  vehicle: Vehicle;
  options: RankedOption[];
  fillFullAtLast: boolean;
}

export function travelKmBetween(
  fromAlongM: number,
  fromExtraM: number,
  toAlongM: number,
  toExtraM: number,
): number {
  return (
    Math.max(0, toAlongM - fromAlongM) / 1000 +
    fromExtraM / 2000 +
    toExtraM / 2000
  );
}

export function planItinerary(input: ItineraryInput): ItineraryStop[] {
  const { route, vehicle, options, fillFullAtLast } = input;
  const e = vehicle.kmPerLiter;
  const destAlong = route.distanceM;

  const destNeedL = (alongM: number, extraM: number) =>
    travelKmBetween(alongM, extraM, destAlong, 0) / e + vehicle.reserveL;

  const sorted = [...options].sort(
    (a, b) => a.detour.alongRouteM - b.detour.alongRouteM,
  );
  if (sorted.length === 0) return [];
  if (vehicle.currentFuelL >= destNeedL(0, 0)) return [];

  const reachableNow = sorted.filter((option) => {
    const need =
      travelKmBetween(0, 0, option.detour.alongRouteM, option.detour.extraDistanceM) /
        e +
      TRANSIT_RESERVE_L;
    return vehicle.currentFuelL >= need;
  });
  if (reachableNow.length === 0) return [];

  const first = reachableNow.reduce((best, option) =>
    option.effectivePriceKrwPerL < best.effectivePriceKrwPerL ? option : best,
  );

  const stops: ItineraryStop[] = [];
  let current = first;
  let fuel =
    vehicle.currentFuelL -
    travelKmBetween(0, 0, first.detour.alongRouteM, first.detour.extraDistanceM) /
      e;

  const pushStop = (
    option: RankedOption,
    liters: number,
    fillReason: ItineraryStop["fillReason"],
    arrivalFuel: number,
  ) => {
    const litersToBuy = Math.max(
      0,
      Math.min(liters, vehicle.tankCapacityL - Math.max(0, arrivalFuel)),
    );
    stops.push({
      option,
      litersToBuy,
      fillReason,
      outOfPocketKrw: option.effectivePriceKrwPerL * litersToBuy,
      fuelOnArrivalL: arrivalFuel,
      fuelOnDepartL: arrivalFuel + litersToBuy,
    });
    return arrivalFuel + litersToBuy;
  };

  let guard = 0;
  while (guard < 16) {
    guard += 1;
    const along = current.detour.alongRouteM;
    const extra = current.detour.extraDistanceM;
    const maxFillable = Math.max(0, vehicle.tankCapacityL - Math.max(0, fuel));
    const remainToDest = destNeedL(along, extra) - Math.max(0, fuel);

    if (remainToDest <= maxFillable + 1e-6) {
      const liters = fillFullAtLast ? maxFillable : Math.max(0, remainToDest);
      pushStop(
        current,
        liters,
        stops.length === 0 ? "only-stop" : "last-stop",
        fuel,
      );
      break;
    }

    const onward = sorted.filter((option) => {
      if (option.detour.alongRouteM <= along + 80) return false;
      const need =
        travelKmBetween(
          along,
          extra,
          option.detour.alongRouteM,
          option.detour.extraDistanceM,
        ) /
          e +
        TRANSIT_RESERVE_L;
      return vehicle.tankCapacityL >= need;
    });

    if (onward.length === 0) {
      pushStop(current, maxFillable, "fill-full", fuel);
      break;
    }

    const cheaper = onward.filter(
      (option) =>
        option.effectivePriceKrwPerL < current.effectivePriceKrwPerL - 0.5,
    );

    if (cheaper.length > 0) {
      const next = cheaper[0];
      const need =
        travelKmBetween(
          along,
          extra,
          next.detour.alongRouteM,
          next.detour.extraDistanceM,
        ) /
          e +
        TRANSIT_RESERVE_L;
      fuel = pushStop(current, Math.max(0, need - fuel), "enough-for-next", fuel);
      fuel -=
        travelKmBetween(
          along,
          extra,
          next.detour.alongRouteM,
          next.detour.extraDistanceM,
        ) / e;
      current = next;
      continue;
    }

    const next = onward.reduce((best, option) =>
      option.effectivePriceKrwPerL < best.effectivePriceKrwPerL ? option : best,
    );
    fuel = pushStop(current, maxFillable, "fill-full", fuel);
    fuel -=
      travelKmBetween(
        along,
        extra,
        next.detour.alongRouteM,
        next.detour.extraDistanceM,
      ) / e;
    current = next;
  }

  return stops;
}

export function itineraryOutOfPocket(stops: ItineraryStop[]): number {
  return stops.reduce((sum, stop) => sum + stop.outOfPocketKrw, 0);
}
