import { describe, expect, it } from "vitest";
import { setCatalogStore } from "@/lib/providers/opinet/catalog-store";
import { nodeCatalogStore } from "@/lib/providers/opinet/catalog-store-node";
import { isRejection, preparePlan, type PlanMessage } from "./plan-engine";

/**
 * APK가 실제로 걷는 길을 서버 없이 끝까지 걸어 본다.
 *
 * 앱에는 /api/plan이 없다. 화면이 엔진을 부르고, 엔진이 오피넷과 카카오를
 * 직접 친다. 여기서 확인하는 건 그 구성이 실데이터를 만들어 내느냐다.
 *
 * 네이티브에서 CapacitorHttp가 하는 일은 "브라우저를 거치지 않고 나간다"뿐이고,
 * Node의 fetch도 같은 성질이다. 그래서 여기서는 shim을 꽂지 않아도 같은 경로다.
 *
 * 기본으로는 건너뛴다. 실제 오피넷과 카카오를 치므로 느리고, 상대 서버가
 * 흔들리면 같이 흔들리고, 하루 호출 한도를 태운다. `npm test`가 그런 이유로
 * 빨개지면 아무도 테스트를 믿지 않게 된다.
 *
 *   LIVE_API_TEST=1 npx vitest run src/lib/engine/live-check.test.ts
 */

const enabled =
  process.env.LIVE_API_TEST === "1" &&
  Boolean(
    process.env.OPINET_CERT_KEY?.trim() && process.env.KAKAO_REST_API_KEY?.trim(),
  );

describe.skipIf(!enabled)("서버 없이 실데이터 (LIVE_API_TEST=1 일 때만)", () => {
  it("오피넷 실시간 유가로 순위를 만든다", async () => {
    setCatalogStore(nodeCatalogStore);

    const prepared = await preparePlan({
      origin: { name: "안양역", lat: 37.4017, lng: 126.9227 },
      destination: { name: "오산역", lat: 37.1447, lng: 127.07 },
      vehicle: { fuelKind: "gasoline", currentFuelL: 10, reserveL: 5 },
    });
    expect(isRejection(prepared)).toBe(false);
    if (isRejection(prepared)) return;

    const messages: PlanMessage[] = [];
    await prepared.emitAll((message) => messages.push(message));

    const exact = messages.filter(
      (m) => m.type === "plan" && m.stage === "exact",
    );
    expect(exact.length).toBe(1);
    const final = exact[0];
    if (final.type !== "plan") return;

    expect(final.dataMode).toBe("live");
    expect(final.plan.options.length).toBeGreaterThan(0);

    for (const option of final.plan.options) {
      // 합성 주유소는 이름에 경로상 거리(예: "49km오일")가 박힌다.
      expect(option.station.name).not.toMatch(/\d+km/);
      // 국내 휘발유 시세 범위. 이 밖이면 유종이나 파싱이 어긋난 것이다.
      expect(option.listPriceKrwPerL).toBeGreaterThan(1_300);
      expect(option.listPriceKrwPerL).toBeLessThan(2_500);
    }
  }, 60_000);
});
