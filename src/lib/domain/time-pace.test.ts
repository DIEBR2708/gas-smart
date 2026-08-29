import { describe, expect, it } from "vitest";
import { TIME_PACE, timePaceFromKrw } from "./time-pace";

describe("timePaceFromKrw", () => {
  it("저장된 원/분을 세 단계로 되돌린다", () => {
    expect(timePaceFromKrw(TIME_PACE.rushed.krwPerMin)).toBe("rushed");
    expect(timePaceFromKrw(TIME_PACE.normal.krwPerMin)).toBe("normal");
    expect(timePaceFromKrw(TIME_PACE.relaxed.krwPerMin)).toBe("relaxed");
    expect(timePaceFromKrw(200)).toBe("normal");
  });
});
