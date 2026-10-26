// H4 locale jargon lint (review W1): internal references must not appear in user copy.
import { describe, expect, test } from "bun:test";
import { buildRules, scanLocaleDocument, validateAllowlist } from "../../scripts/co-newbiz/locale-jargon-lint.ts";

const rules = buildRules(["risk-officer-x", "legal-counsel"]);

const SEEDED: Record<string, string> = {
  boundary: "자세한 내용은 경계 #3 참조",
  boundaryEn: "See boundary #12",
  adr: "per ADR-0185 rules",
  flow: "flow.spec v4 defines it",
  agent: "Ask legal-counsel to review",
  checklist: "fails cdd-06",
  dev: "개발자용 안내",
  slice: "this slice ships later",
};

describe("locale jargon lint (H4)", () => {
  test("fails on a seeded sample of each pattern", () => {
    const found = scanLocaleDocument("en", SEEDED, rules, []);
    expect(new Set(found.map((f) => f.pattern))).toEqual(
      new Set(["boundary-reference", "adr-number", "flow-spec-version", "agent-key", "checklist-id", "developer-wording"]),
    );
    expect(found.map((f) => f.path).sort()).toEqual(Object.keys(SEEDED).sort());
  });

  test("clean copy and look-alikes pass", () => {
    const doc = { a: "Review the legal counsel summary", b: { c: ["Plain text", "Stage 5 of 12"] } };
    expect(scanLocaleDocument("en", doc, rules, [])).toEqual([]);
  });

  test("an exact-path allowlist entry exempts only that key and locale", () => {
    const doc = { x: "ADR-0001", y: "ADR-0002" };
    const entries = [{ locale: "en", path: "x", reason: "Reference page cites the ADR by design" }];
    expect(scanLocaleDocument("en", doc, rules, entries).map((f) => f.path)).toEqual(["y"]);
    expect(scanLocaleDocument("ko", doc, rules, entries).map((f) => f.path)).toEqual(["x", "y"]);
  });

  test("allowlist rejects wildcards, missing reasons and duplicates", () => {
    const errors = validateAllowlist([
      { locale: "en", path: "a.*", reason: "wildcard not allowed here" },
      { locale: "en", path: "b", reason: "" },
      { locale: "en", path: "c", reason: "valid reason text" },
      { locale: "en", path: "c", reason: "valid reason text" },
    ]);
    expect(errors.length).toBe(3);
  });
});
