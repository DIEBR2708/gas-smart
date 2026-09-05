import type { CatalogSnapshot } from "./daily-catalog";

/**
 * 오늘치 유가 목록을 어디에 넣어 둘지.
 *
 * 서버에서는 `.data/` 아래 파일, 안드로이드 앱 안에서는 Capacitor Preferences다.
 * 카탈로그 자체는 어느 쪽인지 알 필요가 없고, 알면 안 된다. `node:fs`를 직접
 * 들고 있으면 그 모듈을 거쳐 가는 코드가 전부 클라이언트 번들에서 깨진다.
 */
export interface CatalogStore {
  load(date: string): Promise<CatalogSnapshot | null>;
  save(date: string, snapshot: CatalogSnapshot): Promise<void>;
}

/** 아무 데도 안 남긴다. 테스트와 플랫폼을 못 정한 경우의 기본값. */
export const memoryCatalogStore: CatalogStore = {
  async load() {
    return null;
  },
  async save() {},
};

let current: CatalogStore = memoryCatalogStore;

/**
 * 플랫폼별 부트스트랩이 시작할 때 한 번 부른다.
 * 서버는 파일 저장소를, 앱은 Preferences 저장소를 꽂는다.
 */
export function setCatalogStore(store: CatalogStore): void {
  current = store;
}

export function catalogStore(): CatalogStore {
  return current;
}
