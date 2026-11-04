import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_ADAPTERS } from "../../scripts/co-newbiz/source-adapters.ts";
import {
  envKeySource,
  isPipelineEnvKey,
  loadRootEnvPipelineKeys,
  resetRootEnvForTests,
} from "../../app/web-next/lib/root-env.ts";

const TOUCHED = [
  "KOSIS_API_KEY",
  "LAW_API_OC",
  "DATA_GO_KR_API_KEY",
  "DART_API_KEY",
  "SERPER_API_KEY",
  "CO_NEWBIZ_LLM_PROVIDER",
  "CO_NEWBIZ_LLM_MODEL_V2",
  "NOTIFY_WEBHOOK_URL_OPS_2",
  "FOO_2_API_KEY",
  "UNRELATED_SECRET",
];
let tmp: string;
let saved: Record<string, string | undefined>;
let envKeysBefore: Set<string>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "root-env-"));
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  envKeysBefore = new Set(Object.keys(process.env));
  for (const k of TOUCHED) delete process.env[k];
});
afterEach(() => {
  // Leak guard: the loader walks up from the temp dir, so a `.env` sitting in a
  // temp ancestor (or a case naming a key outside TOUCHED) can inject
  // allowlisted keys that would then be visible to every later test in this
  // process. Drop anything this test introduced, then restore the tracked keys.
  for (const k of Object.keys(process.env)) if (!envKeysBefore.has(k)) delete process.env[k];
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetRootEnvForTests(null);
  rmSync(tmp, { recursive: true, force: true });
});

describe("root-env value parsing (design 2026-08-31-pipeline-execution-environment §2.5/§4)", () => {
  function loadWith(envLine: string): void {
    writeFileSync(join(tmp, ".env"), `${envLine}\n`);
    resetRootEnvForTests(tmp);
    loadRootEnvPipelineKeys();
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

  // The regression this whole change exists for: design §2.5's measured
  // 2026-11-04 divergence. On disk this line loaded as 64 characters through
  // this loader while dotenv read `custom`.
  test("the measured 2026-11-04 line resolves to `custom`, not the 64-character form", () => {
    loadWith(
      "CO_NEWBIZ_LLM_PROVIDER=custom  # openai-compatible | anthropic | gemini | custom | none",
    );
    expect(process.env.CO_NEWBIZ_LLM_PROVIDER).toBe("custom");
    expect(process.env.CO_NEWBIZ_LLM_PROVIDER?.length).toBe(6);
  });

  // Pinned divergences from dotenv (see scripts/lib/env-value.ts header): a
  // backslash does not escape a quote here, and text after the closing quote is
  // ignored rather than kept. These assert today's behaviour so a future change
  // to it is deliberate.
  test('a backslash does not escape a quote: K="a\\"b" yields `a\\`', () => {
    loadWith('KOSIS_API_KEY="a\\"b"');
    expect(process.env.KOSIS_API_KEY).toBe("a\\");
  });

  test('text after the closing quote is ignored: K="a"b" yields `a`', () => {
    loadWith('KOSIS_API_KEY="a"b"');
    expect(process.env.KOSIS_API_KEY).toBe("a");
  });
});

describe("root-env loader", () => {
  test("admits every adapter credential and provider keys, rejects others", () => {
    for (const a of Object.values(SOURCE_ADAPTERS)) expect(isPipelineEnvKey(a.credentialEnv)).toBe(true);
    expect(isPipelineEnvKey("SERPER_API_KEY")).toBe(true);
    expect(isPipelineEnvKey("CO_NEWBIZ_LLM_MODEL")).toBe(true);
    expect(isPipelineEnvKey("UNRELATED_SECRET")).toBe(false);
  });

  test("loads allowlisted keys only and never overrides existing env", () => {
    writeFileSync(join(tmp, ".env"), "KOSIS_API_KEY=a\nLAW_API_OC=b\nDART_API_KEY=fromfile\nUNRELATED_SECRET=x\n");
    process.env.DART_API_KEY = "preset";
    resetRootEnvForTests(tmp);
    loadRootEnvPipelineKeys();
    expect(process.env.KOSIS_API_KEY).toBe("a");
    expect(process.env.LAW_API_OC).toBe("b");
    expect(process.env.DART_API_KEY).toBe("preset");
    expect(process.env.UNRELATED_SECRET).toBeUndefined();
    expect(envKeySource("KOSIS_API_KEY")).toBe("root_env");
    expect(envKeySource("DART_API_KEY")).toBe("process_env");
    expect(envKeySource("SERPER_API_KEY")).toBeNull();
  });
});

describe("digit-bearing key charset (DEC-20261104-04)", () => {
  function loadWith(envLine: string): void {
    writeFileSync(join(tmp, ".env"), `${envLine}\n`);
    resetRootEnvForTests(tmp);
    loadRootEnvPipelineKeys();
  }

  // Fails-before/passes-after per design 2026-08-31 §4 Row 1: this loader's
  // line regex already admits digits, so the only blocking layer pre-change is
  // the family sub-patterns LLM_KEY/NOTIFY_KEY — both widen in this change.
  test("admits a digit-suffixed LLM family key via the loader walk (CO_NEWBIZ_LLM_MODEL_V2)", () => {
    expect(isPipelineEnvKey("CO_NEWBIZ_LLM_MODEL_V2")).toBe(true);
    loadWith("CO_NEWBIZ_LLM_MODEL_V2=abc");
    expect(process.env.CO_NEWBIZ_LLM_MODEL_V2).toBe("abc");
  });

  test("admits a digit-suffixed NOTIFY channel key (NOTIFY_WEBHOOK_URL_OPS_2)", () => {
    expect(isPipelineEnvKey("NOTIFY_WEBHOOK_URL_OPS_2")).toBe(true);
    loadWith("NOTIFY_WEBHOOK_URL_OPS_2=https://example.invalid/hook");
    expect(process.env.NOTIFY_WEBHOOK_URL_OPS_2).toBe("https://example.invalid/hook");
  });

  // Passes before and after — regression guard, not a fails-before case.
  // DEC-20261104-04 consequence: digits are admitted only inside the families
  // that were already prefix-wildcarded; a non-family digit key stays rejected.
  test("still rejects a non-family digit key (FOO_2_API_KEY)", () => {
    expect(isPipelineEnvKey("FOO_2_API_KEY")).toBe(false);
    loadWith("FOO_2_API_KEY=abc");
    expect(process.env.FOO_2_API_KEY).toBeUndefined();
  });
});
