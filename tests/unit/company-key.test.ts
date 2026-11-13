// @version 1.0.0
/**
 * companyKey — the suppression key (design 2026-11-13-proposal-ignore-
 * suppression §3.2, DEC-20261113-04 ruling 2). Table-driven pins for the
 * §5.7 matrix: every legal-form variant of one base name collapses to the
 * SAME key; distinct base names never merge (no fuzzy); a name that is
 * entirely corporate-form marker yields the EMPTY key (the caller rejects).
 *
 * companyKey composes the existing canonicalCompanyName (design
 * 2026-11-11-target-identity-resolution §D1) with the residual ㈜/주식회사
 * token strip and the existing normalizeName. DEC-20261113-04 fallback pin:
 * if the token strip misfires on a real name the key degrades to
 * canonical+normalize only — never to fuzzy matching.
 */
import { describe, expect, test } from "bun:test";

const { companyKey, normalizeName, isSimilar } = await import("../../app/web-next/lib/name-similarity.ts");

describe("companyKey — legal-form variants collapse to one key (§5.7)", () => {
  const base = companyKey("한양");
  test("every table-driven variant equals companyKey('한양')", () => {
    const variants = [
      "한양",
      "(주)한양",
      "한양(주)",
      "주식회사 한양",
      "주식회사한양",
      "한양 주식회사",
      "㈜한양",
      "한양(구원)",
      " 한양 ",
    ];
    for (const v of variants) {
      expect(companyKey(v)).toBe(base);
    }
    // and the composite is idempotent through its own input space
    expect(companyKey("(주)한양(구원)")).toBe(base);
    // trailing-gloss strip (canonicalCompanyName, D1) — the gloss never leaks into the key
    expect(companyKey("한전KPS(KEPCO KPS)")).toBe(companyKey("한전KPS"));
  });

  test("normalizes case and punctuation through normalizeName", () => {
    expect(companyKey("Hanyang")).toBe(companyKey("hanyang"));
    expect(companyKey("한양·(주)")).toBe(base); // punctuation stripped by normalizeName
  });

  test("distinct base names NEVER merge — suppression is exact-key, no fuzzy (§4.3)", () => {
    expect(companyKey("한양")).not.toBe(companyKey("한양전자"));
    expect(companyKey("삼성")).not.toBe(companyKey("삼성전자"));
    // the substring relation isSimilar would catch stays OUT of the key space
    expect(isSimilar("삼성전자", ["삼성"])).toBe(true); // dedupe keeps its wider net…
    expect(companyKey("삼성전자")).not.toBe(companyKey("삼성")); // …suppression does not
  });

  test("an entirely-marker input yields the EMPTY key — never stored, never matches (§3.2)", () => {
    expect(companyKey("(주)")).toBe("");
    expect(companyKey("주식회사")).toBe("");
    expect(companyKey("㈜")).toBe("");
    // and the empty key does not equal any real key
    expect(companyKey("(주)")).not.toBe(companyKey("한양"));
  });

  test("normalizeName/isSimilar regressions — the existing helpers are untouched", () => {
    expect(normalizeName("(주)한양")).toBe("주한양");
    expect(isSimilar("(주)한양", ["한양"])).toBe(true); // substring containment
    // The documented GAP the companyKey hardening closes (§3.6): isSimilar
    // does NOT see through the 주식회사/한양(주) pairing (single-token vs
    // multi-token raw comparison never reaches the Jaccard branch) — the
    // exact-key comparison on the existing-name filters does.
    expect(isSimilar("한양(주)", ["주식회사 한양"])).toBe(false);
    expect(companyKey("한양(주)")).toBe(companyKey("주식회사 한양"));
    expect(isSimilar("전혀다른회사", ["한양"])).toBe(false);
  });
});
