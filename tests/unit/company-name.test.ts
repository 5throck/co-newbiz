/**
 * canonicalCompanyName — design 2026-11-11-target-identity-resolution §3.1
 * (D1). Pure function: no DB, no network. Pins the canonical form that both
 * md_company.name_ko and brownfield_target.company_name hold at every
 * identity write boundary — trailing parenthetical glosses (ASCII and
 * fullwidth, repeated), leading corporate-form markers, whitespace collapse,
 * the gloss-only fallback, and idempotence.
 */
import { describe, expect, test } from "bun:test";
import { canonicalCompanyName } from "../../app/web-next/lib/company-name.ts";

describe("canonicalCompanyName", () => {
  test("strips a single trailing ASCII paren group", () => {
    expect(canonicalCompanyName("한전KPS(KEPCO KPS)")).toBe("한전KPS");
    expect(canonicalCompanyName(" 비에이치아이(BHI) ")).toBe("비에이치아이");
  });

  test("strips repeated trailing paren groups right-to-left", () => {
    expect(canonicalCompanyName("삼성에스원(주)(구원)")).toBe("삼성에스원");
    expect(canonicalCompanyName("삼성에스원(구원)(주)")).toBe("삼성에스원");
  });

  test("strips fullwidth paren groups, including repeated", () => {
    // Fullwidth parens are spelled as escapes — the audit.ts homoglyph gate
    // rejects confusable-width literals in tests/ source.
    const FW_OPEN = "\uFF08";
    const FW_CLOSE = "\uFF09";
    expect(canonicalCompanyName(`한전KPS${FW_OPEN}KEPCO KPS${FW_CLOSE}`)).toBe("한전KPS");
    expect(canonicalCompanyName(`삼성에스원${FW_OPEN}주${FW_CLOSE}${FW_OPEN}구원${FW_CLOSE}`)).toBe("삼성에스원");
  });

  test("keeps a paren group that is not trailing", () => {
    expect(canonicalCompanyName("CJ(주)제일제당")).toBe("CJ(주)제일제당");
  });

  test("strips a leading corporate-form marker (주)/(재)/(유)", () => {
    expect(canonicalCompanyName("(주)한양")).toBe("한양");
    expect(canonicalCompanyName("(재)단체")).toBe("단체");
    expect(canonicalCompanyName("(유)법인")).toBe("법인");
    expect(canonicalCompanyName("(주)한양(홀딩스)")).toBe("한양");
  });

  test("a gloss-only name falls back to the trimmed raw string", () => {
    expect(canonicalCompanyName("(주)")).toBe("(주)");
    expect(canonicalCompanyName("(주)(구원)")).toBe("(주)(구원)");
    expect(canonicalCompanyName("  \uFF08지주\uFF09  ")).toBe("\uFF08지주\uFF09");
  });

  test("collapses internal whitespace runs to single spaces", () => {
    expect(canonicalCompanyName("한전   KPS")).toBe("한전 KPS");
    expect(canonicalCompanyName(" \t LG \n 화학 (주) ")).toBe("LG 화학");
  });

  test("idempotent — canonical(canonical(x)) === canonical(x)", () => {
    for (const raw of [
      "한전KPS(KEPCO KPS)",
      "삼성에스원(주)(구원)",
      "(주)한양",
      "(주)",
      "CJ(주)제일제당",
      "한전   KPS",
    ]) {
      const once = canonicalCompanyName(raw);
      expect(canonicalCompanyName(once)).toBe(once);
    }
  });

  test("empty input stays empty (routes guard blank names before this)", () => {
    expect(canonicalCompanyName("")).toBe("");
    expect(canonicalCompanyName("   ")).toBe("");
  });
});
