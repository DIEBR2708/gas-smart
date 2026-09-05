import type { FuelKind, LatLng } from "@/lib/domain/types";
import { type AroundAllResult, fetchAroundAll } from "./around-all";
import {
  DailyPriceCatalog,
  cellId,
  loadCatalogForToday,
} from "./daily-catalog";

const CONCURRENCY = 12;
const BACKGROUND_CONCURRENCY = 4;

/**
 * 오피넷 오픈 API의 하루 호출 한도.
 *
 * 전국을 6.4km 격자로 훑으면 2천 칸이 넘는다. 그걸 배경에서 돌리면 한도가
 * 몇 분 만에 말라 정작 사용자의 경로 조회가 빈 응답을 받는다. 그러면 지도에
 * 주유소가 띄엄띄엄 찍혀 좌표가 깨진 것처럼 보인다.
 */
export const DAILY_CALL_BUDGET = 450;

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

  constructor(
    private readonly catalog: DailyPriceCatalog,
    private readonly fetchAround: AroundFetcher,
    private readonly dailyBudget = DAILY_CALL_BUDGET,
  ) {}

  get budgetLeft(): number {
    return Math.max(0, this.dailyBudget - this.catalog.callCount);
  }

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
      if (this.budgetLeft <= 0) return;
      this.catalog.countCall();
      const result = await this.fetchAround(job.center, job.fuelKind);
      if (result.ok) {
        this.catalog.ingest(result.rows, job.fuelKind);
        const known = this.catalog.priceCountForFuel(job.fuelKind) > 0;
        if (result.rows.length > 0 || known) {
          this.catalog.markFetched(job.center, job.fuelKind);
          this.catalog.scheduleSave();
        }
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
    // 전국을 미리 훑지 않는다. 사용자의 경로 칸만 그때그때 받는다.
    return singleton;
  })();
  return loading;
}

/** 테스트용. */
export function resetOpinetRuntimeForTests(): void {
  singleton = null;
  loading = null;
}
