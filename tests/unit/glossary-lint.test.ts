// @version 1.0.0
/**
 * Tests for scripts/co-newbiz/glossary-lint.ts (the `glossary:lint` case
 * of newbiz.ts) — the planted-token fixture pattern: lintGlossaryUsage()
 * scans a temp root so the assertions do not depend on real repo content,
 * while registered terms still load from the real glossary/*.yaml.
 */

import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const TEMP_DIR = mkdtempSync(join(tmpdir(), "glossary-lint-test-"));

afterAll(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

const { scanLine, lintGlossaryUsage, GLOSSARY_LINT_ALLOWLIST } = await import(
  "../../scripts/co-newbiz/glossary-lint.ts"
);

test("scanLine classifies registered, allowlisted and undefined tokens", () => {
  const registered = new Set(["WACC"]);
  const { known, undefined: undef } = scanLine("WACC vs DSCR; API is tooling vocabulary", registered);
  expect(known).toEqual(["WACC"]);
  expect(undef).toEqual(["DSCR"]); // domain acronym: signal, not noise
  expect(GLOSSARY_LINT_ALLOWLIST.has("API")).toBe(true);
});

test("scanLine strips inline code spans before matching", () => {
  const { undefined: undef } = scanLine("the `ZZCODE` identifier is code, not prose", new Set());
  expect(undef).toEqual([]); // code identifiers are never prose jargon
});

test("lint finds a planted undefined acronym in a temp file, with file:line and count", () => {
  const content = [
    "# Fixture doc",
    "",
    "WACC anchors the discount rate; ZZRPT is not in the glossary.",
    "ZZRPT appears again, so the finding carries count 2.",
    "Inline `ZZCODE` stays unflagged.",
    "```",
    "ZZFENCED stays inside a fence",
    "```",
  ].join("\n");
  writeFileSync(join(TEMP_DIR, "fixture.md"), content, "utf8");

  const result = lintGlossaryUsage({ roots: [TEMP_DIR] });
  expect(result.scannedFiles).toBe(1);

  const planted = result.undefined.filter((u) => u.token === "ZZRPT");
  expect(planted).toHaveLength(1);
  expect(planted[0]).toMatchObject({ line: 3, count: 2 });
  expect(planted[0].file).toContain(basename(TEMP_DIR));

  // Code surfaces are not prose: neither the inline span nor the fenced block flags.
  expect(result.undefined.filter((u) => ["ZZCODE", "ZZFENCED"].includes(u.token))).toHaveLength(0);

  // The forcing function: the registered term used in the fixture is reported as in use.
  expect(result.known.find((k) => k.term === "WACC")).toMatchObject({ files: 1, mentions: 1 });
});

test("lint is report-only — findings never throw", () => {
  writeFileSync(join(TEMP_DIR, "loud.md"), "ZZQUIET ZZQUIET ZZQUIET\n", "utf8");
  const result = lintGlossaryUsage({ roots: [TEMP_DIR] });
  expect(result.undefined.some((u) => u.token === "ZZQUIET")).toBe(true);
});
