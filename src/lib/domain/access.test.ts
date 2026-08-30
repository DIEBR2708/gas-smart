import { describe, expect, it } from "vitest";
import {
  highwayTurnaroundDetour,
  inferAccessHint,
  looksLikeIllegalUturn,
  rejectIllegalUturn,
  routeLooksDivided,
} from "./access";
import { straightRoute, testDetour, testStation } from "./fixtures";
import type { Projection } from "./geo";

function proj(overrides: Partial<Projection> = {}): Projection {
  return {
    point: { lat: 36.5, lng: 127 },
    alongM: 40_000,
    offsetM: 80,
    segmentIndex: 0,
    side: 1,
    ...overrides,
  };
}

const highway = {
  ...straightRoute(160),
  summary: "경부고속도로",
  durationS: (160 / 90) * 3600,
};

describe("routeLooksDivided", () => {
  it("고속 표기가 있으면 분리 도로로 본다", () => {
    expect(routeLooksDivided(highway)).toBe(true);
  });

  it("느린 시내 경로는 분리 도로로 보지 않는다", () => {
    expect(
      routeLooksDivided({
        ...straightRoute(20),
        durationS: (20 / 28) * 3600,
        summary: "도심 가로",
      }),
    ).toBe(false);
  });
});

describe("inferAccessHint", () => {
  it("고속도로 왼쪽 가까운 주유소는 반대편이다", () => {
    const hint = inferAccessHint(proj({ side: 1, offsetM: 90 }), highway);
    expect(hint.oppositeSide).toBe(true);
    expect(hint.requiresHighwayExit).toBe(true);
    expect(hint.onHighway).toBe(false);
  });

  it("오른쪽 본선 옆은 휴게소형으로 본다", () => {
    const hint = inferAccessHint(proj({ side: -1, offsetM: 80 }), highway);
    expect(hint.oppositeSide).toBe(false);
    expect(hint.onHighway).toBe(true);
  });

  it("이미 있는 힌트는 덮어쓰지 않는다", () => {
    const hint = inferAccessHint(proj({ side: 1, offsetM: 90 }), highway, {
      oppositeSide: false,
      requiresHighwayExit: false,
      onHighway: true,
    });
    expect(hint.oppositeSide).toBe(false);
    expect(hint.onHighway).toBe(true);
  });
});

describe("looksLikeIllegalUturn", () => {
  it("반대편인데 우회가 이탈 왕복 수준이면 유턴으로 본다", () => {
    const hint = inferAccessHint(proj(), highway);
    expect(
      looksLikeIllegalUturn(
        testDetour({ extraDistanceM: 220, extraDurationS: 40 }),
        proj(),
        hint,
        highway,
      ),
    ).toBe(true);
  });

  it("나들목만큼 돌아온 우회는 유턴이 아니다", () => {
    const hint = inferAccessHint(proj(), highway);
    expect(
      looksLikeIllegalUturn(
        testDetour({ extraDistanceM: 6_400, extraDurationS: 480 }),
        proj(),
        hint,
        highway,
      ),
    ).toBe(false);
  });
});

describe("rejectIllegalUturn", () => {
  it("가짜 유턴을 나들목 회차로 바꾼다", () => {
    const station = testStation({
      accessHint: inferAccessHint(proj(), highway),
    });
    const fixed = rejectIllegalUturn(
      testDetour({ extraDistanceM: 200, extraDurationS: 30, extraTollKrw: 0 }),
      proj(),
      station,
      highway,
    );
    expect(fixed.extraDistanceM).toBeGreaterThan(3_000);
    expect(fixed.extraTollKrw).toBeGreaterThan(0);
    expect(fixed.source).toBe("geometric-estimate");
  });

  it("회차 합류점은 주유소보다 앞에 둔다", () => {
    const p = proj({ alongM: 40_000 });
    const detour = highwayTurnaroundDetour(p, highway, {
      lat: 36.5,
      lng: 126.99,
    });
    expect(detour.joinPoint).not.toEqual(p.point);
  });
});
