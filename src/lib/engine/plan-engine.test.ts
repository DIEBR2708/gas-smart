import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRejection, preparePlan, type PlanMessage } from "./plan-engine";

/**
 * 엔진이 서버 없이 도는지 본다.
 *
 * 안드로이드 APK 안에는 /api/plan이 없다. 화면이 이 엔진을 직접 부르고,
 * NDJSON 대신 콜백으로 단계를 받는다. 그러니 Request도 Response도 없이
 * 순서와 결과가 나와야 한다. 라우트를 거치지 않고 확인한다.
 *
 * 여기서 보는 것은 단계의 순서와 모양이지 데이터의 진위가 아니다. 키를 지워
 * 샘플 프로바이더로 고정한다. 안 그러면 .env.local이 있는 기계에서만 네트워크를
 * 타고, 느리고 결과가 흔들린다. 실데이터는 live-check.test.ts가 본다.
 */

const KEYS = [
  "OPINET_CERT_KEY",
  "KAKAO_REST_API_KEY",
  "NEXT_PUBLIC_OPINET_CERT_KEY",
  "NEXT_PUBLIC_KAKAO_REST_API_KEY",
] as const;
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

beforeAll(() => {
  for (const key of KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const 서울시청 = { name: "서울시청", lat: 37.5665, lng: 126.978 };
const 대전시청 = { name: "대전시청", lat: 36.3504, lng: 127.3845 };

type PlanStage = Extract<PlanMessage, { type: "plan" }>;

async function collect(body: Parameters<typeof preparePlan>[0]) {
  const prepared = await preparePlan(body);
  if (isRejection(prepared)) {
    return { rejection: prepared, messages: [] as PlanMessage[] };
  }
  const messages: PlanMessage[] = [];
  await prepared.emitAll((message) => messages.push(message));
  return { rejection: null, messages };
}

function planStages(messages: PlanMessage[]): PlanStage[] {
  return messages.filter((m): m is PlanStage => m.type === "plan");
}

describe("preparePlan", () => {
  it("HTTP 없이 본선 경로와 순위를 순서대로 내보낸다", async () => {
    const { rejection, messages } = await collect({
      origin: 서울시청,
      destination: 대전시청,
    });

    expect(rejection).toBeNull();
    expect(messages[0].type).toBe("route");

    const plans = planStages(messages);
    expect(plans.length).toBeGreaterThan(0);
    // 마지막은 항상 정밀 단계다. 화면은 이걸 최종 순위로 쓴다.
    const last = plans.at(-1);
    expect(last?.stage).toBe("exact");
    expect(last?.plan.options.length).toBeGreaterThan(0);
    expect(Object.keys(last?.shapes ?? {}).length).toBeGreaterThan(0);
  });

  it("갈 수 없는 요청은 아무것도 내보내지 않고 사유만 돌려준다", async () => {
    const { rejection, messages } = await collect({
      origin: 서울시청,
      destination: 서울시청,
    });

    expect(rejection?.error).toContain("같습니다");
    expect(messages).toHaveLength(0);
  });

  it("좌표가 없으면 이 자리 주변 검색을 거절한다", async () => {
    const { rejection } = await collect({ searchMode: "nearby" });
    expect(rejection?.error).toContain("위치를 지정");
  });

  /*
    같은 요청을 두 번 보내면 두 번째는 캐시에서 나온다. 그때도 순서는 같아야
    한다. 화면은 route를 받아 지도를 그리고 plan을 받아 목록을 채우므로,
    캐시라고 route를 건너뛰면 지도가 비어 있는 채로 남는다.
  */
  it("캐시에서 나올 때도 경로를 먼저 내보낸다", async () => {
    const body = { origin: 서울시청, destination: 대전시청 };
    await collect(body);
    const { messages } = await collect(body);

    expect(messages[0].type).toBe("route");
    expect(messages.at(-1)).toMatchObject({ type: "plan", stage: "exact" });
  });
});
