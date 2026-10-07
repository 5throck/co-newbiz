// @version 1.0.0
/**
 * Regression guard for the verify-skills.ts SKILLS.md clobber (PR-5a
 * finding (d)): generateSkillsIndex used to run unconditionally at the end
 * of every verification pass, wholesale-overwriting the hand-maintained
 * skills/SKILLS.md Skill Lifecycle Registry (a 347-line diff in the
 * incident run — restored from git; the fix makes generation opt-in).
 *
 * verify-skills.ts executes main() at import time (top-level `main();`),
 * so importing it here would run the entire scan — the guard is therefore a
 * static source audit, same pattern as the no-dynamic-SQL audit in
 * applies-when.test.ts.
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dirname, "../../scripts/verify-skills.ts"), "utf-8");

test("generateSkillsIndex is gated — the only call site sits inside the regenerable guard (verify-skills 1.5.1, U-20261006-002)", () => {
  // exactly two occurrences: the function definition + one guarded call site.
  // A re-added unconditional call anywhere else breaks this count.
  const occurrences = SOURCE.match(/generateSkillsIndex\(/g) ?? [];
  expect(occurrences.length).toBe(2);
  expect(SOURCE).toMatch(/if \(regenerable\) \{\s*await generateSkillsIndex\(checks\);/);
});

test("the gate keys off the SKILLS.md header — the hand-maintained lifecycle registry is never regenerated", () => {
  // isLegacyIndex must be derived from the file's own header: only the
  // legacy "# Skills Index" stub (or a missing file) may be rewritten;
  // the hand-maintained "# SKILLS.md — Skill Lifecycle Registry" SSOT
  // short-circuits the writer entirely.
  // verify-skills 1.5.1 renamed the gate: exact-stub detection (isExactGeneratedStub)
  // feeds `regenerable`; curated indexes are never rewritten in any mode.
  expect(SOURCE).toMatch(/const regenerable = existing === null \|\| isExactGeneratedStub\(existing\);/);
  expect(SOURCE).toMatch(/isExactGeneratedStub\(content: string\)/);
  expect(SOURCE).toContain("hand-maintained");
});

test("both index writes are gated — generateSkillsIndex plus the --check regenerate path (1.5.1)", () => {
  // two Bun.write sites: generateSkillsIndex and the --check stub-regeneration.
  // Both must sit behind the regenerable gate — a curated index is never written.
  expect((SOURCE.match(/Bun\.write\(/g) ?? []).length).toBe(2);
  expect(SOURCE).toMatch(/if \(regenerable\) \{\s*\/\/ A missing\/stub index is not drift[^\n]*\n\s*await Bun\.write\(/);
  expect(SOURCE).toMatch(/if \(regenerable\) \{\s*await generateSkillsIndex\(checks\);\s*\}/);
});
