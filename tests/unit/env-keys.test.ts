/**
 * tests/unit/env-keys.test.ts — value parsing through loadPipelineKeys().
 *
 * Design 2026-08-31-pipeline-execution-environment §2.5 (one shared parser) and
 * §4 (three cases per loader). No test existed for this module before: the
 * loader walks up from process.cwd(), so each case chdir's into a temp dir and
 * the reset seam is used between cases.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPipelineKeys, resetPipelineKeysForTests } from "../../scripts/lib/env-keys.ts";

const TOUCHED = [
  "KOSIS_API_KEY",
  "CO_NEWBIZ_LLM_MODEL_V2",
  "CO_NEWBIZ_LLM_K2E",
  "FOO_2_API_KEY",
  "NOTIFY_WEBHOOK_URL_OPS_2",
];
let tmp: string;
let originalCwd: string;
let saved: Record<string, string | undefined>;
let envKeysBefore: Set<string>;

beforeEach(() => {
  originalCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "env-keys-"));
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  envKeysBefore = new Set(Object.keys(process.env));
  for (const k of TOUCHED) delete process.env[k];
  process.chdir(tmp);
});
afterEach(() => {
  process.chdir(originalCwd);
  // Leak guard: loadPipelineKeys walks up from the temp dir for six levels, so
  // an ancestor `.env` can inject allowlisted keys that TOUCHED does not name
  // and every later test in this process would see them. Sweep them first, then
  // restore the tracked keys.
  for (const k of Object.keys(process.env)) if (!envKeysBefore.has(k)) delete process.env[k];
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetPipelineKeysForTests();
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadPipelineKeys value parsing", () => {
  function loadWith(envLine: string): void {
    writeFileSync(join(tmp, ".env"), `${envLine}\n`);
    resetPipelineKeysForTests();
    loadPipelineKeys();
  }

  test("strips an inline comment after an unquoted value", () => {
    loadWith("KOSIS_API_KEY=abc  # note");
    expect(process.env.KOSIS_API_KEY).toBe("abc");
  });

  test("keeps a literal # inside a quoted value", () => {
    loadWith('KOSIS_API_KEY="abc#def"');
    expect(process.env.KOSIS_API_KEY).toBe("abc#def");
  });

  test("leaves an uncommented value unchanged", () => {
    loadWith("KOSIS_API_KEY=abc");
    expect(process.env.KOSIS_API_KEY).toBe("abc");
  });
});

describe("digit-bearing key charset (DEC-20261104-04)", () => {
  function loadWith(envLine: string): void {
    writeFileSync(join(tmp, ".env"), `${envLine}\n`);
    resetPipelineKeysForTests();
    loadPipelineKeys();
  }

  // Fails-before/passes-after per design 2026-08-31 §4 Row 1: the old line
  // regex /^([A-Z_]+)=/ cannot capture a digit-bearing key line at all, and the
  // old CO_NEWBIZ_LLM_[A-Z_]+ family sub-pattern rejects the captured name —
  // both layers must widen for this key to load.
  test("admits a digit-suffixed family key (CO_NEWBIZ_LLM_MODEL_V2)", () => {
    loadWith("CO_NEWBIZ_LLM_MODEL_V2=abc");
    expect(process.env.CO_NEWBIZ_LLM_MODEL_V2).toBe("abc");
  });

  test("admits a digit mid-suffix family key (CO_NEWBIZ_LLM_K2E)", () => {
    loadWith("CO_NEWBIZ_LLM_K2E=abc");
    expect(process.env.CO_NEWBIZ_LLM_K2E).toBe("abc");
  });

  // Passes before and after — regression guard, not a fails-before case.
  // DEC-20261104-04 consequence: digits are admitted only inside the families
  // that were already prefix-wildcarded; a non-family digit key stays rejected.
  test("still rejects a non-family digit key (FOO_2_API_KEY)", () => {
    loadWith("FOO_2_API_KEY=abc");
    expect(process.env.FOO_2_API_KEY).toBeUndefined();
  });

  // Passes before and after — boundary pin, not a fails-before case. NOTIFY_*
  // is a root-env.ts-only family; this CLI loader never allowlisted it (no
  // NOTIFY consumers under scripts/), so a digit-suffixed NOTIFY key stays
  // unloaded here regardless of charset.
  test("lifts no NOTIFY_* key (family is root-env-only)", () => {
    loadWith("NOTIFY_WEBHOOK_URL_OPS_2=https://example.invalid/hook");
    expect(process.env.NOTIFY_WEBHOOK_URL_OPS_2).toBeUndefined();
  });
});
