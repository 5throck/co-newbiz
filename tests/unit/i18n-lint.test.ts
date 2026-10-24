// i18n literal guard (design 2026-10-23-i18n-ui-adoption §3.6) — the
// re-liquefaction guard wired into CI: the committed baseline allowlist
// (scripts/co-newbiz/i18n-lint.baseline.json) records every file still
// carrying Korean source strings, and the check must stay violation-free.
// Extraction batches shrink the baseline via
// `bun scripts/co-newbiz/i18n-lint.ts --update`; any file outside the
// baseline (or exceeding its count) fails here and `bun run lint:i18n`.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { lintI18nStrings, loadBaseline, scanKoreanLines } from "../../scripts/co-newbiz/i18n-lint.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

describe("i18n literal guard (§3.6)", () => {
  test("no Korean strings outside (or above) the committed baseline", () => {
    const result = lintI18nStrings();
    expect(result.violations).toEqual([]);
  });

  test("the baseline references only files that still exist in the scanned tree", () => {
    // A deleted/renamed file must be pruned via --update, not left to rot.
    const baseline = loadBaseline();
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
    const scan = scanKoreanLines();
    expect(scan.scannedFiles).toBeGreaterThan(0);
    const vanished = Object.keys(baseline).filter((file) => !existsSync(join(PROJECT_ROOT, file)));
    expect(vanished).toEqual([]);
  });
});
