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
  "CO_NEWBIZ_BUSINESS_CASE_AGENTS",
  "CO_NEWBIZ_DD_TAILOR_AGENTS",
  "CO_NEWBIZ_DB_PATH",
  "WEB_SEARCH_DDG_ENABLED",
  "BRAVE_SEARCH_API_KEY",
  "DATABASE_URL",
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

  // Changed 2026-11-13 (design 2026-11-13-env-single-source §3.2/§3.4C): the
  // CLI twin no longer keeps its own hardcoded key list — admission derives
  // from the shared SSOT inventory in app/web-next/lib/root-env.ts, so the
  // NOTIFY family (previously root-env-only) is lifted here too. Passes-before
  // boundary replaced by the shared-inventory cases below.
  test("lifts a NOTIFY_* key through the shared SSOT inventory", () => {
    loadWith("NOTIFY_WEBHOOK_URL_OPS_2=https://example.invalid/hook");
    expect(process.env.NOTIFY_WEBHOOK_URL_OPS_2).toBe("https://example.invalid/hook");
  });

  test("lifts executor agent modes and the migrated SSOT keys through the shared inventory", () => {
    writeFileSync(
      join(tmp, ".env"),
      `${[
        "CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm",
        "CO_NEWBIZ_DD_TAILOR_AGENTS=llm",
        "CO_NEWBIZ_DB_PATH=/tmp/db.sqlite",
        "WEB_SEARCH_DDG_ENABLED=true",
        "BRAVE_SEARCH_API_KEY=brave-key",
      ].join("\n")}\n`,
    );
    resetPipelineKeysForTests();
    loadPipelineKeys();
    expect(process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS).toBe("llm");
    expect(process.env.CO_NEWBIZ_DD_TAILOR_AGENTS).toBe("llm");
    expect(process.env.CO_NEWBIZ_DB_PATH).toBe("/tmp/db.sqlite");
    expect(process.env.WEB_SEARCH_DDG_ENABLED).toBe("true");
    expect(process.env.BRAVE_SEARCH_API_KEY).toBe("brave-key");
  });

  // Passes before and after — boundary pin, not a fails-before case.
  // DATABASE_URL is the deliberate app-file remnant (Prisma CLI tooling), not
  // part of the SSOT inventory; the CLI loader must not lift it.
  test("still does not lift a non-SSOT key (DATABASE_URL stays app-file-only)", () => {
    loadWith("DATABASE_URL=file:/tmp/should-not-load.db");
    expect(process.env.DATABASE_URL).toBeUndefined();
  });
});
