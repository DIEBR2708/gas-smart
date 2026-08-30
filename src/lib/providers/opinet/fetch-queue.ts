import type { FuelKind, LatLng } from "@/lib/domain/types";
import { type AroundAllRow, fetchAroundAll } from "./around-all";
import {
  DailyPriceCatalog,
  FUEL_PREFETCH_ORDER,
  cellId,
  loadCatalogForToday,
} from "./daily-catalog";
import { koreaPrefetchCenters } from "./korea-grid";

const CONCURRENCY = 12;

type Priority = "user" | "bg";

interface Job {
  key: string;
  center: LatLng;
  fuelKind: FuelKind;
}

export type AroundFetcher = (
  center: LatLng,
  fuelKind: FuelKind,
) => Promise<AroundAllRow[]>;

export class PriceFetchQueue {
  private readonly user: Job[] = [];
  private readonly background: Job[] = [];
  private readonly waiters = new Map<
    string,
    { resolve: () => void; promise: Promise<void> }
  >();
  private active = 0;
  private backgroundArmed = false;

  constructor(
    private readonly catalog: DailyPriceCatalog,
    private readonly fetchAround: AroundFetcher,
  ) {}

  ensure(center: LatLng, fuelKind: FuelKind, priority: Priority): Promise<void> {
    const key = cellId(center, fuelKind);
    if (this.catalog.hasCell(key)) return Promise.resolve();

    const existing = this.waiters.get(key);
    if (existing) {
      if (priority === "user") this.promote(key);
      return existing.promise;
    }

    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.waiters.set(key, { resolve, promise });
    const job: Job = { key, center, fuelKind };
    if (priority === "user") this.user.push(job);
    else this.background.push(job);
    this.pump();
    return promise;
  }

  async ensureMany(
    centers: LatLng[],
    fuelKind: FuelKind,
    priority: Priority,
  ): Promise<void> {
    await Promise.all(centers.map((c) => this.ensure(c, fuelKind, priority)));
  }

  enqueueBackground(
    centers: LatLng[],
    fuels: FuelKind[] = FUEL_PREFETCH_ORDER,
  ): void {
    if (this.backgroundArmed) return;
    this.backgroundArmed = true;
    for (const fuelKind of fuels) {
      for (const center of centers) {
        void this.ensure(center, fuelKind, "bg");
      }
    }
  }

  private promote(key: string): void {
    const index = this.background.findIndex((job) => job.key === key);
    if (index < 0) return;
    const [job] = this.background.splice(index, 1);
    this.user.push(job);
  }

  private pump(): void {
    while (this.active < CONCURRENCY) {
      const job = this.user.shift() ?? this.background.shift();
      if (!job) return;
      if (this.catalog.hasCell(job.key)) {
        this.finish(job.key);
        continue;
      }
      this.active += 1;
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    try {
      const rows = await this.fetchAround(job.center, job.fuelKind);
      this.catalog.ingest(rows, job.fuelKind);
      this.catalog.markFetched(job.center, job.fuelKind);
      this.catalog.scheduleSave();
    } finally {
      this.active -= 1;
      this.finish(job.key);
      this.pump();
    }
  }

  private finish(key: string): void {
    const waiter = this.waiters.get(key);
    if (!waiter) return;
    this.waiters.delete(key);
    waiter.resolve();
  }
}

let singleton: { catalog: DailyPriceCatalog; queue: PriceFetchQueue } | null =
  null;
let loading: Promise<{ catalog: DailyPriceCatalog; queue: PriceFetchQueue }> | null =
  null;

export function getPriceRuntime(): {
  catalog: DailyPriceCatalog;
  queue: PriceFetchQueue;
} | null {
  return singleton;
}

export async function startOpinetDailyPrefetch(certKey: string): Promise<{
  catalog: DailyPriceCatalog;
  queue: PriceFetchQueue;
}> {
  if (singleton) return singleton;
  if (loading) return loading;
  loading = (async () => {
    const catalog = await loadCatalogForToday(true);
    const queue = new PriceFetchQueue(catalog, (center, fuelKind) =>
      fetchAroundAll(certKey, center, fuelKind),
    );
    singleton = { catalog, queue };
    queue.enqueueBackground(koreaPrefetchCenters());
    return singleton;
  })();
  return loading;
}

/** 테스트용. */
export function resetOpinetRuntimeForTests(): void {
  singleton = null;
  loading = null;
}
