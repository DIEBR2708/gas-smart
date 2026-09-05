import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_VEHICLE } from "@/lib/domain/fixtures";
import { changedSettingLabels, summarizeChanges } from "./settings-diff";

const applied = { vehicle: DEFAULT_VEHICLE, preferences: DEFAULT_PREFERENCES };

describe("changedSettingLabels", () => {
  it("같은 값이면 아무것도 대기하지 않는다", () => {
    expect(changedSettingLabels(applied, { ...applied })).toEqual([]);
  });

  it("고쳤다가 원래 값으로 되돌리면 대기 목록에서 사라진다", () => {
    const draft = {
      vehicle: { ...DEFAULT_VEHICLE, kmPerLiter: DEFAULT_VEHICLE.kmPerLiter },
      preferences: { ...DEFAULT_PREFERENCES },
    };
    expect(changedSettingLabels(applied, draft)).toEqual([]);
  });

  it("차량과 조건에서 바뀐 항목을 화면 순서대로 집어낸다", () => {
    const draft = {
      vehicle: { ...DEFAULT_VEHICLE, kmPerLiter: 9.5, tankCapacityL: 70 },
      preferences: { ...DEFAULT_PREFERENCES, cardDiscountKrwPerL: 80 },
    };
    expect(changedSettingLabels(applied, draft)).toEqual([
      "연비",
      "탱크 용량",
      "카드 할인",
    ]);
  });

  it("중첩된 주입 정책과 할인 규칙 배열도 비교한다", () => {
    const policy = {
      vehicle: DEFAULT_VEHICLE,
      preferences: {
        ...DEFAULT_PREFERENCES,
        fillPolicy: { mode: "toDestination" as const },
      },
    };
    expect(changedSettingLabels(applied, policy)).toEqual(["주입량"]);

    const rules = {
      vehicle: DEFAULT_VEHICLE,
      preferences: {
        ...DEFAULT_PREFERENCES,
        discountRules: [
          {
            id: "r1",
            name: "카드",
            enabled: true,
            flatKrwPerL: 60,
            rate: 0,
            brands: [],
          },
        ],
      },
    };
    expect(changedSettingLabels(applied, rules)).toEqual(["할인 프로필"]);
  });
});

describe("summarizeChanges", () => {
  it("두 개까지 이름을 보여 주고 나머지는 개수로 접는다", () => {
    expect(summarizeChanges([])).toBe("");
    expect(summarizeChanges(["연비"])).toBe("연비");
    expect(summarizeChanges(["연비", "탱크 용량"])).toBe("연비, 탱크 용량");
    expect(summarizeChanges(["연비", "탱크 용량", "카드 할인"])).toBe(
      "연비, 탱크 용량 외 1개",
    );
  });
});
