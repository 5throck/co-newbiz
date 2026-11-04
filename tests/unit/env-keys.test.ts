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

const TOUCHED = ["KOSIS_API_KEY"];
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
