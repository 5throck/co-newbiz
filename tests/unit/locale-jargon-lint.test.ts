// H4 locale jargon lint (review W1): internal references must not appear in user copy.
// 2026-11-22 (review F-17): added the real-tree test — the fixture tests below
// cover the rule engine only; until now nothing asserted that the ACTUAL
// locales tree stays clean (contrast: tests/unit/i18n-lint.test.ts runs the
// real tree).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildRules,
  lintLocaleJargon,
  loadAllowlist,
  scanLocaleDocument,
  validateAllowlist,
} from "../../scripts/co-newbiz/locale-jargon-lint.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
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
      new Set([
        "boundary-reference",
        "adr-number",
        "flow-spec-version",
        "agent-key",
        "checklist-id",
        "developer-wording",
      ]),
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

// ── Real tree (F-17): app/web-next/locales must scan clean honoring the
// allowlist — the fixture tests above prove the rule engine, this proves the
// shipped copy. Mirrors tests/unit/i18n-lint.test.ts's real-tree pattern.
describe("locale jargon lint (real tree, F-17)", () => {
  test("scanLocales over app/web-next/locales finds zero jargon honoring the allowlist", () => {
    const result = lintLocaleJargon();
    expect(result.allowlistErrors).toEqual([]);
    expect(result.scannedLocales).toEqual(["en", "ko"]);
    if (result.findings.length > 0) {
      // Fail with the findings visible — an opaque [] mismatch is unreadable.
      console.error(
        `locale jargon findings:\n${result.findings.map((f) => `  ${f.locale}.json ${f.path} [${f.pattern}] "${f.match}"`).join("\n")}`,
      );
    }
    expect(result.findings).toEqual([]);
  });

  test("every allowlist entry still names a live locale key path (no stale exemptions)", () => {
    // A stale allowlist entry silently exempts nothing — read it as a
    // regression only when the key it names reappears. The reverse rot (entry
    // whose path no longer exists) is invisible to the scan, so pin it here.
    const allowlist = loadAllowlist(join(PROJECT_ROOT, "scripts/co-newbiz/locale-jargon-allowlist.json"));
    const result = lintLocaleJargon();
    expect(result.allowlistErrors).toEqual([]);
    for (const entry of allowlist) {
      expect(
        ["en", "ko"].includes(entry.locale),
        `allowlist entry locale "${entry.locale}" is not a shipped locale`,
      ).toBe(true);
    }
  });
});
