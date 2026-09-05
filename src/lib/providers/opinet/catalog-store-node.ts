import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogStore } from "./catalog-store";
import type { CatalogSnapshot } from "./daily-catalog";

/**
 * 서버에서 쓰는 파일 저장소.
 *
 * `node:fs`를 여기 가둔다. 이 파일은 서버 부트스트랩만 import 하므로
 * 클라이언트 번들의 모듈 그래프에 들어가지 않는다.
 */

export function catalogFilePath(date: string): string {
  return path.join(process.cwd(), ".data", `opinet-prices-${date}.json`);
}

export const nodeCatalogStore: CatalogStore = {
  async load(date) {
    try {
      const raw = await readFile(catalogFilePath(date), "utf8");
      return JSON.parse(raw) as CatalogSnapshot;
    } catch {
      return null;
    }
  },
  async save(date, snapshot) {
    const file = catalogFilePath(date);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(snapshot), "utf8");
  },
};
