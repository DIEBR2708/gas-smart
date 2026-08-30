import { describe, expect, it } from "vitest";
import {
  CATALOG_SCHEMA_VERSION,
  DailyPriceCatalog,
  cellId,
  kstDateKey,
} from "./daily-catalog";
import { PriceFetchQueue } from "./fetch-queue";
import { isPrefetchLand, koreaPrefetchCenters, pointInRing } from "./korea-grid";

describe("kstDateKey", () => {
  it("서울 날짜를 YYYY-MM-DD로 준다", () => {
    expect(kstDateKey(new Date("2026-08-29T16:00:00Z"))).toBe("2026-08-30");
  });
});

describe("koreaPrefetchCenters", () => {
  it("서울·대전·제주는 육지로 본다", () => {
    expect(isPrefetchLand({ lat: 37.5663, lng: 126.9779 })).toBe(true);
    expect(isPrefetchLand({ lat: 36.3504, lng: 127.3845 })).toBe(true);
    expect(isPrefetchLand({ lat: 33.5, lng: 126.5 })).toBe(true);
  });

  it("서해 한가운데는 빼 둔다", () => {
    expect(isPrefetchLand({ lat: 36.2, lng: 125.4 })).toBe(false);
  });

  it("격자 수가 감당 가능한 범위다", () => {
    const n = koreaPrefetchCenters().length;
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(3_500);
  });

  it("단순 다각형 내부 판정이 맞다", () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ];
    expect(pointInRing({ lat: 0.5, lng: 0.5 }, square)).toBe(true);
    expect(pointInRing({ lat: 1.5, lng: 0.5 }, square)).toBe(false);
  });
});

describe("DailyPriceCatalog", () => {
  it("같은 주유소의 유종 가격을 합친다", () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    catalog.ingest(
      [
        {
          UNI_ID: "A1",
          OS_NM: "테스트주유소",
          POLL_DIV_CD: "SKE",
          PRICE: 1700,
          GIS_X_COOR: 310000,
          GIS_Y_COOR: 550000,
        },
      ],
      "gasoline",
    );
    catalog.ingest(
      [
        {
          UNI_ID: "A1",
          OS_NM: "테스트주유소",
          POLL_DIV_CD: "SKE",
          PRICE: 1550,
          GIS_X_COOR: 310000,
          GIS_Y_COOR: 550000,
        },
      ],
      "diesel",
    );
    const station = catalog.snapshot().stations[0];
    expect(station.prices.gasoline).toBe(1700);
    expect(station.prices.diesel).toBe(1550);
  });

  it("받은 칸 근처는 다시 치지 않는다", () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    const center = { lat: 37.5, lng: 127.0 };
    catalog.markFetched(center, "gasoline");
    expect(catalog.hasCell(cellId(center, "gasoline"))).toBe(true);
    expect(catalog.covers({ lat: 37.501, lng: 127.001 }, "gasoline", 800)).toBe(
      true,
    );
    expect(catalog.covers({ lat: 36.3, lng: 127.4 }, "gasoline", 800)).toBe(
      false,
    );
  });

  it("예전 캐시는 주유소만 살리고 칸은 버린다", () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    catalog.applySnapshot({
      date: "2026-08-30",
      cells: ["37.500:127.000:diesel"],
      stations: [
        {
          id: "A1",
          name: "테스트주유소",
          brand: "SKE",
          lat: 37.5,
          lng: 127,
          prices: { gasoline: 1700 },
        },
      ],
    });
    expect(catalog.hasCell("37.500:127.000:diesel")).toBe(false);
    expect(catalog.stationCount).toBe(1);
  });

  it("현재 버전 스냅샷은 칸도 복원한다", () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    catalog.applySnapshot({
      date: "2026-08-30",
      version: CATALOG_SCHEMA_VERSION,
      cells: ["37.500:127.000:gasoline"],
      stations: [],
    });
    expect(catalog.hasCell("37.500:127.000:gasoline")).toBe(true);
  });
});

describe("PriceFetchQueue", () => {
  it("검색 칸을 대기 중인 배경 칸보다 먼저 받는다", async () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    const order: string[] = [];
    const queue = new PriceFetchQueue(catalog, async (center) => {
      order.push(center.lat.toFixed(3));
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { ok: true, rows: [] };
    });

    const background = Array.from({ length: 20 }, (_, i) =>
      queue.ensure({ lat: 35 + i * 0.01, lng: 127 }, "gasoline", "bg"),
    );
    const user = queue.ensure({ lat: 37.5, lng: 127 }, "gasoline", "user");
    await Promise.all([...background, user]);

    expect(order[4]).toBe("37.500");
    expect(catalog.cellCount).toBe(21);
  });

  it("이미 받은 칸은 네트워크를 다시 치지 않는다", async () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    let hits = 0;
    const queue = new PriceFetchQueue(catalog, async () => {
      hits += 1;
      return { ok: true, rows: [] };
    });
    const p = { lat: 37.56, lng: 126.97 };
    await queue.ensure(p, "gasoline", "user");
    await queue.ensure(p, "gasoline", "user");
    expect(hits).toBe(1);
  });

  it("실패한 칸은 받은 것으로 치지 않고 다시 받는다", async () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    let hits = 0;
    const queue = new PriceFetchQueue(catalog, async () => {
      hits += 1;
      if (hits === 1) return { ok: false, rows: [] };
      return {
        ok: true,
        rows: [
          {
            UNI_ID: "A1",
            OS_NM: "재시도주유소",
            POLL_DIV_CD: "SKE",
            PRICE: 1690,
            GIS_X_COOR: 310000,
            GIS_Y_COOR: 550000,
          },
        ],
      };
    });
    const p = { lat: 37.56, lng: 126.97 };
    await queue.ensure(p, "gasoline", "user");
    expect(catalog.hasCell(cellId(p, "gasoline"))).toBe(false);
    await queue.ensure(p, "gasoline", "user");
    expect(hits).toBe(2);
    expect(catalog.stationCount).toBe(1);
  });

  it("검색 칸이 있으면 새 배경 칸을 열지 않는다", async () => {
    const catalog = new DailyPriceCatalog("2026-08-30", false);
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const queue = new PriceFetchQueue(catalog, async (center) => {
      started.push(center.lat.toFixed(3));
      await gate;
      return { ok: true, rows: [] };
    });

    const user = queue.ensure({ lat: 37.5, lng: 127 }, "gasoline", "user");
    const background = queue.ensure({ lat: 35.0, lng: 127 }, "gasoline", "bg");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual(["37.500"]);
    release();
    await Promise.all([user, background]);
    expect(started).toContain("35.000");
  });
});
