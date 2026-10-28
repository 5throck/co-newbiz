import { test, expect, describe } from "bun:test";
import master from "../../app/web-next/lib/ksic-master.json";
import { KSIC_ALIASES, searchKsic } from "../../app/web-next/lib/ksic.ts";

const CODES = new Set((master.codes as { code: string }[]).map((e) => e.code));

describe("ksic aliases", () => {
  test("every alias code exists in the KSIC master", () => {
    for (const a of KSIC_ALIASES) {
      expect(a.basis.length).toBeGreaterThan(0);
      for (const c of a.codes) expect(CODES.has(c), `${a.terms[0]} -> ${c}`).toBe(true);
    }
  });

  test("required domain terms are covered", () => {
    const terms = new Set(KSIC_ALIASES.flatMap((a) => a.terms));
    for (const t of ["조선", "조선업", "shipbuilding", "해양플랜트", "2차전지", "이차전지", "배터리", "반도체", "디스플레이", "바이오", "제약", "자동차부품", "방산", "방위산업", "수소", "연료전지", "로봇", "철강", "석유화학", "태양광", "풍력", "원전", "크랭크샤프트", "선박엔진"])
      expect(terms.has(t), t).toBe(true);
  });

  test("조선 returns 311 and 31111 first, marked as alias", () => {
    const r = searchKsic("조선");
    expect(r[0].matched_by).toBe("alias");
    expect(r[0].alias).toBe("조선");
    const codes = r.map((e) => e.code);
    expect(codes).toContain("311");
    expect(codes).toContain("31111");
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("whitespace-insensitive substring and unchanged 선박", () => {
    expect(searchKsic("선박건조").some((e) => e.code === "31113")).toBe(true);
    expect(searchKsic("선박").length).toBeGreaterThan(0);
  });

  test("limit respected", () => {
    expect(searchKsic("조선", 2).length).toBe(2);
  });

  test("digit queries unchanged (no matched_by)", () => {
    const r = searchKsic("311");
    expect(r[0].code).toBe("311");
    expect(r.every((e) => e.matched_by === undefined)).toBe(true);
  });

  test("empty query returns profile entries only", () => {
    const r = searchKsic("");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.profile && e.matched_by === undefined)).toBe(true);
  });
});
