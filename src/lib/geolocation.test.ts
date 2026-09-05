import { describe, expect, it } from "vitest";
import {
  GEO_PERMISSION_DENIED,
  GEO_TIMEOUT,
  GEO_UNAVAILABLE,
  geolocationErrorText,
  parseQueryCoord,
} from "./geolocation";

describe("parseQueryCoord", () => {
  it("빈 문자열을 좌표 0으로 보지 않는다", () => {
    expect(parseQueryCoord("")).toBeNull();
    expect(parseQueryCoord("   ")).toBeNull();
    expect(parseQueryCoord(null)).toBeNull();
  });

  it("숫자 좌표만 받는다", () => {
    expect(parseQueryCoord("37.5665")).toBeCloseTo(37.5665);
    expect(parseQueryCoord("0")).toBe(0);
    expect(parseQueryCoord("abc")).toBeNull();
  });
});

describe("geolocationErrorText", () => {
  it("임베드에서 권한이 막히면 새 탭을 안내한다", () => {
    expect(geolocationErrorText(GEO_PERMISSION_DENIED, true)).toMatch(/새 탭/);
  });

  it("일반 창에서 거부되면 자물쇠를 안내한다", () => {
    expect(geolocationErrorText(GEO_PERMISSION_DENIED, false)).toMatch(/자물쇠/);
  });

  it("시간 초과와 일반 실패 문구가 다르다", () => {
    expect(geolocationErrorText(GEO_TIMEOUT, false)).toMatch(/시간/);
    expect(geolocationErrorText(GEO_UNAVAILABLE, false)).toMatch(/읽지 못/);
  });
});
