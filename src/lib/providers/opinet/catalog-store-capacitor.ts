import { Preferences } from "@capacitor/preferences";
import type { CatalogStore } from "./catalog-store";
import type { CatalogSnapshot } from "./daily-catalog";

/**
 * 안드로이드 앱에서 쓰는 저장소.
 *
 * 서버가 없으니 오늘치 유가 목록도 기기에 남겨야 한다. 남기지 않으면 앱을
 * 다시 열 때마다 오피넷을 처음부터 다시 훑어 하루 호출 한도를 태운다.
 *
 * 어제 것은 쓸모가 없다. 열 때마다 날짜가 다른 항목을 지운다. 안 그러면
 * 하루치 200KB가 계속 쌓인다.
 */

const PREFIX = "opinet-prices-";

export const capacitorCatalogStore: CatalogStore = {
  async load(date) {
    void pruneOtherDays(date);
    try {
      const { value } = await Preferences.get({ key: PREFIX + date });
      return value ? (JSON.parse(value) as CatalogSnapshot) : null;
    } catch {
      return null;
    }
  },
  async save(date, snapshot) {
    await Preferences.set({
      key: PREFIX + date,
      value: JSON.stringify(snapshot),
    });
  },
};

async function pruneOtherDays(keepDate: string): Promise<void> {
  try {
    const { keys } = await Preferences.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(PREFIX) && key !== PREFIX + keepDate)
        .map((key) => Preferences.remove({ key })),
    );
  } catch {
    // 정리에 실패해도 오늘 조회에는 지장이 없다.
  }
}
