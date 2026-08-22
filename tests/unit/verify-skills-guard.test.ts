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

test("generateSkillsIndex is OPT-IN — the only call site sits directly inside the --write-index guard", () => {
  // exactly two occurrences: the function definition + one guarded call site.
  // A re-added unconditional call anywhere else breaks this count.
  const occurrences = SOURCE.match(/generateSkillsIndex\(/g) ?? [];
  expect(occurrences.length).toBe(2);
  expect(SOURCE).toMatch(
    /if \(process\.argv\.includes\("--write-index"\)\) \{\s*await generateSkillsIndex\(checks\);/
  );
});

test("the default (no-flag) run warns instead of writing — hand-maintained notice in the else branch", () => {
  expect(SOURCE).toMatch(/else \{\s*console\.warn\(/);
  expect(SOURCE).toContain("hand-maintained; generation is opt-in via --write-index");
});

test("the index write lives only inside generateSkillsIndex — exactly one Bun.write in the module", () => {
  expect((SOURCE.match(/Bun\.write\(/g) ?? []).length).toBe(1);
});
