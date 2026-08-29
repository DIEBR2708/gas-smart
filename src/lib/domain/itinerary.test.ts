import { describe, expect, it } from "vitest";
import { DEFAULT_VEHICLE, straightRoute, testDetour, testStation } from "./fixtures";
import { planItinerary } from "./itinerary";
import type { RankedOption } from "./types";

function option(args: {
  id: string;
  alongKm: number;
  price: number;
  extraKm?: number;
}): RankedOption {
  const extraM = (args.extraKm ?? 0) * 1000;
  return {
    station: testStation({
      id: args.id,
      name: args.id,
      prices: { gasoline: args.price },
    }),
    detour: testDetour({
      alongRouteM: args.alongKm * 1000,
      extraDistanceM: extraM,
      extraDurationS: 0,
    }),
    listPriceKrwPerL: args.price,
    effectivePriceKrwPerL: args.price,
    fuelOnArrivalL: 5,
    reachable: true,
    litersToBuy: 20,
    tankCapped: false,
    detourFuelL: 0,
    fuelAtDestinationL: 6,
    surplusFuelL: 0,
    shortfallFuelL: 0,
    outOfPocketKrw: args.price * 20,
    detourFuelCostKrw: 0,
    timeCostKrw: 0,
    tollDeltaKrw: 0,
    surplusCreditKrw: 0,
    shortfallCostKrw: 0,
    normalizedCostKrw: args.price * 20,
    krwPerUsefulLiter: args.price,
    warnings: [],
    savingKrw: 0,
    savingPessimisticKrw: 0,
    breakEvenDetourKm: 0,
    stockUpValueKrw: 0,
    rank: 1,
  };
}

describe("planItinerary", () => {
  it("현재 연료로 충분하면 정류가 없다", () => {
    const stops = planItinerary({
      route: straightRoute(80),
      vehicle: { ...DEFAULT_VEHICLE, kmPerLiter: 10, currentFuelL: 20, reserveL: 4 },
      options: [option({ id: "a", alongKm: 40, price: 1600 })],
      fillFullAtLast: false,
    });
    expect(stops).toEqual([]);
  });

  it("탱크 하나로 못 가면 두 곳에서 나눠 넣는다", () => {
    // 250km, 연비 10, 탱크 20L, 현재 6L, 예비 4L.
    // 가득해도 200km밖에 못 가므로 중간에 한 번 더 넣어야 한다.
    const stops = planItinerary({
      route: straightRoute(250),
      vehicle: {
        ...DEFAULT_VEHICLE,
        kmPerLiter: 10,
        tankCapacityL: 20,
        currentFuelL: 6,
        reserveL: 4,
      },
      options: [
        option({ id: "near-expensive", alongKm: 40, price: 1800 }),
        option({ id: "mid-cheap", alongKm: 140, price: 1550 }),
        option({ id: "far-ok", alongKm: 220, price: 1700 }),
      ],
      fillFullAtLast: false,
    });
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(stops.map((s) => s.option.station.id)).toContain("mid-cheap");
    const last = stops[stops.length - 1];
    expect(last.fuelOnDepartL).toBeGreaterThan(last.fuelOnArrivalL);
  });

  it("더 싼 곳이 앞에 있으면 지금은 다음까지 갈 만큼만 넣는다", () => {
    const stops = planItinerary({
      route: straightRoute(250),
      vehicle: {
        ...DEFAULT_VEHICLE,
        kmPerLiter: 10,
        tankCapacityL: 20,
        currentFuelL: 6,
        reserveL: 4,
      },
      options: [
        option({ id: "expensive", alongKm: 40, price: 1900 }),
        option({ id: "cheap", alongKm: 130, price: 1500 }),
      ],
      fillFullAtLast: false,
    });
    expect(stops[0].option.station.id).toBe("expensive");
    expect(stops[0].fillReason).toBe("enough-for-next");
    expect(stops[0].litersToBuy).toBeLessThan(16);
    expect(stops[1].option.station.id).toBe("cheap");
  });

  it("현재 연료로 닿는 곳이 없으면 빈 일정이다", () => {
    const stops = planItinerary({
      route: straightRoute(250),
      vehicle: {
        ...DEFAULT_VEHICLE,
        kmPerLiter: 10,
        tankCapacityL: 20,
        currentFuelL: 1,
        reserveL: 4,
      },
      options: [option({ id: "far", alongKm: 80, price: 1600 })],
      fillFullAtLast: false,
    });
    expect(stops).toEqual([]);
  });
});
