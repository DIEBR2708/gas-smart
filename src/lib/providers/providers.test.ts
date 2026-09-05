import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProviders, stationsAreReal } from "./index";

/*
  키 이름이 둘씩이다. 서버용과 번들에 박히는 NEXT_PUBLIC_ 용. 앱에는 키를
  숨길 서버가 없어서 후자가 필요하다. 하나만 지우면 다른 쪽이 살아남아,
  키를 없앤 셈 치고 짜는 테스트가 조용히 실데이터 경로를 탄다.

  Vitest는 .env.local을 process.env에 넣어 준다. 그래서 로컬에 키를 넣어 둔
  개발자에게만 깨지는 종류의 실패가 된다.
*/
const KEYS = [
  "OPINET_CERT_KEY",
  "KAKAO_REST_API_KEY",
  "NEXT_PUBLIC_OPINET_CERT_KEY",
  "NEXT_PUBLIC_KAKAO_REST_API_KEY",
] as const;
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

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
