import { afterEach, describe, expect, it } from "vitest";
import { resolveProviders, stationsAreReal } from "./index";

const KEYS = ["OPINET_CERT_KEY", "KAKAO_REST_API_KEY"] as const;
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("stationsAreReal", () => {
  it("오피넷 키가 없으면 카카오 경로가 살아 있어도 실데이터가 아니다", () => {
    delete process.env.OPINET_CERT_KEY;
    process.env.KAKAO_REST_API_KEY = "kakao-test-key";
    const providers = resolveProviders("gasoline");
    expect(providers.anyLive).toBe(true);
    expect(stationsAreReal(providers)).toBe(false);
  });

  it("빈 문자열 키도 없는 것으로 본다", () => {
    process.env.OPINET_CERT_KEY = "   ";
    const providers = resolveProviders("gasoline");
    expect(stationsAreReal(providers)).toBe(false);
  });

  it("오피넷 키가 있으면 실데이터로 본다", () => {
    process.env.OPINET_CERT_KEY = "opinet-test-key";
    const providers = resolveProviders("gasoline");
    expect(stationsAreReal(providers)).toBe(true);
  });
});
