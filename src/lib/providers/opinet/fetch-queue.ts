import type { FuelKind, LatLng } from "@/lib/domain/types";
import { type AroundAllResult, fetchAroundAll } from "./around-all";
import {
  DailyPriceCatalog,
  cellId,
  loadCatalogForToday,
} from "./daily-catalog";
import { koreaPrefetchCenters } from "./korea-grid";

const CONCURRENCY = 12;
const BACKGROUND_CONCURRENCY = 4;
const BACKGROUND_START_MS = 20_000;

type Priority = "user" | "bg";

interface Job {
  key: string;
  center: LatLng;
  fuelKind: FuelKind;
  priority: Priority;
}

export type AroundFetcher = (
  center: LatLng,
  fuelKind: FuelKind,
) => Promise<AroundAllResult>;

export class PriceFetchQueue {
  private readonly user: Job[] = [];
  private readonly background: Job[] = [];
  private readonly waiters = new Map<
    string,
    { resolve: () => void; promise: Promise<void> }
  >();
  private active = 0;
  private userInFlight = 0;
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
    const job: Job = { key, center, fuelKind, priority };
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

  /** 이미 받은 칸도 다시 친다. 경로에 주유소가 하나도 없을 때 쓴다. */
  async refetchMany(centers: LatLng[], fuelKind: FuelKind): Promise<void> {
    for (const center of centers) {
      this.catalog.forgetCell(cellId(center, fuelKind));
    }
    await this.ensureMany(centers, fuelKind, "user");
  }

  enqueueBackground(
    centers: LatLng[],
    fuels: FuelKind[] = ["gasoline"],
  ): void {
    if (this.backgroundArmed) return;
    this.backgroundArmed = true;
    for (const fuelKind of fuels) {
      for (const center of centers) {
        void this.ensure(center, fuelKind, "bg");
      }
    }
  }

  scheduleBackgroundPrefetch(
    centers: LatLng[],
    fuels: FuelKind[] = ["gasoline"],
    delayMs = BACKGROUND_START_MS,
  ): void {
    if (this.backgroundArmed) return;
    this.backgroundArmed = true;
    setTimeout(() => {
      this.backgroundArmed = false;
      this.enqueueBackground(centers, fuels);
    }, delayMs);
  }

  private promote(key: string): void {
    const index = this.background.findIndex((job) => job.key === key);
    if (index < 0) return;
    const [job] = this.background.splice(index, 1);
    job.priority = "user";
    this.user.push(job);
  }

  private busyWithUser(): boolean {
    return this.user.length > 0 || this.userInFlight > 0;
  }

  private pump(): void {
    const blockBackground = this.busyWithUser();
    const limit = blockBackground ? CONCURRENCY : BACKGROUND_CONCURRENCY;
    while (this.active < limit) {
      const job =
        this.user.shift() ??
        (blockBackground ? undefined : this.background.shift());
      if (!job) return;
      if (this.catalog.hasCell(job.key)) {
        this.finish(job.key);
        continue;
      }
      this.active += 1;
      if (job.priority === "user") this.userInFlight += 1;
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    try {
      const result = await this.fetchAround(job.center, job.fuelKind);
      if (result.ok) {
        this.catalog.ingest(result.rows, job.fuelKind);
        this.catalog.markFetched(job.center, job.fuelKind);
        this.catalog.scheduleSave();
      }
    } finally {
      this.active -= 1;
      if (job.priority === "user") this.userInFlight -= 1;
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
    queue.scheduleBackgroundPrefetch(koreaPrefetchCenters(), ["gasoline"]);
    return singleton;
  })();
  return loading;
}

/** 테스트용. */
export function resetOpinetRuntimeForTests(): void {
  singleton = null;
  loading = null;
}
