// @version 1.0.0
/**
 * Profile validators — optional provenance-bearing sections.
 *
 * `revenue_quality_norms` (industry) and `payment_practice` (region) are optional:
 * absent is valid, present is held to the same provenance rules as a required
 * section (source, verified_on, maintainer, non-empty data). Each case runs the
 * real validator against a scratch copy of the profile directory (kept inside
 * the repo so js-yaml still resolves).
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");

interface Case {
  label: string;
  dir: string;
  section: string;
  base: string;
  validBody: string;
  maintainer: string;
}

const CASES: Case[] = [
  {
    label: "industry",
    dir: "industry-profiles",
    section: "revenue_quality_norms",
    base: "KSIC261.yaml",
    maintainer: "industry-lead",
    validBody: `    customer_concentration_norm: "top-3 customers 40-60% of revenue (illustrative test value)"
    collection_period_norm: "DSO 45-75 days (illustrative test value)"`,
  },
  {
    label: "region",
    dir: "region-profiles",
    section: "payment_practice",
    base: "KR.yaml",
    maintainer: "financial-analyst",
    validBody: `    typical_payment_terms_days: 60
    collection_enforcement_note: "illustrative test value"`,
  },
];

function run(dir: string): { code: number; out: string } {
  const r = Bun.spawnSync(["bun", join(dir, "_validate.ts")], { cwd: REPO });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

for (const c of CASES) {
  describe(`${c.label} profile validator — ${c.section}`, () => {
    let tmp = "";
    let baseText = "";

    beforeAll(() => {
      tmp = mkdtempSync(join(REPO, "tests", "unit", ".tmp-profile-"));
      // Validator + exactly one real profile; the scratch dir never holds the rest.
      cpSync(join(REPO, c.dir, "_validate.ts"), join(tmp, "_validate.ts"));
      baseText = readFileSync(join(REPO, c.dir, c.base), "utf-8");
    });

    afterAll(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    function setProfile(extra: string) {
      for (const f of readdirSync(tmp)) if (f.endsWith(".yaml")) rmSync(join(tmp, f));
      writeFileSync(join(tmp, c.base), baseText.trimEnd() + "\n" + extra);
    }

    test("absent section passes", () => {
      setProfile("");
      const r = run(tmp);
      expect(r.code).toBe(0);
    });

    test("present, fully sourced section passes", () => {
      setProfile(`
${c.section}:
  source: "test fixture citation"
  verified_on: "2026-09-01"
  maintainer: ${c.maintainer}
  data:
${c.validBody}
`);
      const r = run(tmp);
      expect(r.code).toBe(0);
    });

    test("present with empty data is rejected", () => {
      setProfile(`
${c.section}:
  source: "test fixture citation"
  verified_on: "2026-09-01"
  maintainer: ${c.maintainer}
  data: {}
`);
      const r = run(tmp);
      expect(r.code).toBe(1);
      expect(r.out).toContain(c.section);
    });

    test("present without source is rejected", () => {
      setProfile(`
${c.section}:
  verified_on: "2026-09-01"
  maintainer: ${c.maintainer}
  data:
${c.validBody}
`);
      const r = run(tmp);
      expect(r.code).toBe(1);
      expect(r.out).toContain("source");
    });

    test("present with a future verified_on is rejected", () => {
      setProfile(`
${c.section}:
  source: "test fixture citation"
  verified_on: "2999-01-01"
  maintainer: ${c.maintainer}
  data:
${c.validBody}
`);
      const r = run(tmp);
      expect(r.code).toBe(1);
      expect(r.out).toContain("future");
    });
  });
}
