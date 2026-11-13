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
  ssotEnvKeys,
} from "../../app/web-next/lib/root-env.ts";

const TOUCHED = [
  "KOSIS_API_KEY",
  "LAW_API_OC",
  "DATA_GO_KR_API_KEY",
  "DART_API_KEY",
  "SERPER_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "CO_NEWBIZ_LLM_PROVIDER",
  "CO_NEWBIZ_LLM_MODEL_V2",
  "CO_NEWBIZ_LLM_MODEL",
  "NOTIFY_WEBHOOK_URL_OPS_2",
  "FOO_2_API_KEY",
  "UNRELATED_SECRET",
  "CO_NEWBIZ_BUSINESS_CASE_AGENTS",
  "CO_NEWBIZ_DD_TAILOR_AGENTS",
  "CO_NEWBIZ_DB_PATH",
  "WEB_SEARCH_DDG_ENABLED",
  "WEB_SEARCH_PLAYWRIGHT_ENABLED",
  "CHROME_PATH",
  "CO_NEWBIZ_BOOTSTRAP_MIGRATIONS",
  "CO_NEWBIZ_ALLOW_REGISTER",
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

describe("SSOT inventory widening (design 2026-11-13-env-single-source §3.2)", () => {
  function loadWith(envText: string): void {
    writeFileSync(join(tmp, ".env"), envText);
    resetRootEnvForTests(tmp);
    loadRootEnvPipelineKeys();
  }

  test("ssotEnvKeys() contains every migrated exact key and excludes tooling keys", () => {
    const inventory = ssotEnvKeys();
    for (const k of [
      "CO_NEWBIZ_DB_PATH",
      "WEB_SEARCH_DDG_ENABLED",
      "WEB_SEARCH_PLAYWRIGHT_ENABLED",
      "CHROME_PATH",
      "CO_NEWBIZ_BOOTSTRAP_MIGRATIONS",
      "CO_NEWBIZ_ALLOW_REGISTER",
    ]) {
      expect(inventory.has(k)).toBe(true);
    }
    // Explicitly NOT admitted (design §3.2 "Explicitly NOT added"): DATABASE_URL
    // is the Prisma-CLI app-file remnant; DIST_DIR is read before
    // instrumentation; the MCP client contract keys are not server process.env.
    expect(inventory.has("DATABASE_URL")).toBe(false);
  });

  test("admits the agent-mode family and every migrated exact key, rejects the reserved keys", () => {
    expect(isPipelineEnvKey("CO_NEWBIZ_BUSINESS_CASE_AGENTS")).toBe(true);
    expect(isPipelineEnvKey("CO_NEWBIZ_DD_TAILOR_AGENTS")).toBe(true);
    // Family style per DEC-20261104-04: a future executor seam needs no loader edit.
    expect(isPipelineEnvKey("CO_NEWBIZ_NEW_SEAM_2_AGENTS")).toBe(true);
    for (const k of [
      "CO_NEWBIZ_DB_PATH",
      "WEB_SEARCH_DDG_ENABLED",
      "WEB_SEARCH_PLAYWRIGHT_ENABLED",
      "CHROME_PATH",
      "CO_NEWBIZ_BOOTSTRAP_MIGRATIONS",
      "CO_NEWBIZ_ALLOW_REGISTER",
    ]) {
      expect(isPipelineEnvKey(k)).toBe(true);
    }
    expect(isPipelineEnvKey("CO_NEWBIZ_DIST_DIR")).toBe(false);
    expect(isPipelineEnvKey("CO_NEWBIZ_ALLOWED_DEV_ORIGINS")).toBe(false);
    expect(isPipelineEnvKey("CO_NEWBIZ_API_TOKEN")).toBe(false);
    expect(isPipelineEnvKey("CO_NEWBIZ_API_BASE_URL")).toBe(false);
    expect(isPipelineEnvKey("DATABASE_URL")).toBe(false);
  });

  test("imports the migrated keys from the root .env walk", () => {
    loadWith(
      `${[
        "CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm",
        "CO_NEWBIZ_DD_TAILOR_AGENTS=llm",
        "CO_NEWBIZ_DB_PATH=/tmp/db.sqlite",
        "WEB_SEARCH_DDG_ENABLED=true",
        "WEB_SEARCH_PLAYWRIGHT_ENABLED=true",
        "BRAVE_SEARCH_API_KEY=brave-key",
        "CHROME_PATH=/usr/bin/chrome",
        "# CO_NEWBIZ_BOOTSTRAP_MIGRATIONS=auto",
        "CO_NEWBIZ_ALLOW_REGISTER=1",
      ].join("\n")}\n`,
    );
    expect(process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS).toBe("llm");
    expect(process.env.CO_NEWBIZ_DD_TAILOR_AGENTS).toBe("llm");
    expect(process.env.CO_NEWBIZ_DB_PATH).toBe("/tmp/db.sqlite");
    expect(process.env.WEB_SEARCH_DDG_ENABLED).toBe("true");
    expect(process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED).toBe("true");
    expect(process.env.BRAVE_SEARCH_API_KEY).toBe("brave-key");
    expect(process.env.CHROME_PATH).toBe("/usr/bin/chrome");
    expect(envKeySource("CO_NEWBIZ_DB_PATH")).toBe("root_env");
    // A commented line is invisible to the walk: the key stays unset so the
    // code default ("auto") governs.
    expect(process.env.CO_NEWBIZ_BOOTSTRAP_MIGRATIONS).toBeUndefined();
    expect(process.env.CO_NEWBIZ_ALLOW_REGISTER).toBe("1");
  });

  test("never overrides an existing value for the migrated keys", () => {
    writeFileSync(
      join(tmp, ".env"),
      "CO_NEWBIZ_DB_PATH=/from/file.sqlite\nCO_NEWBIZ_BUSINESS_CASE_AGENTS=deterministic\n",
    );
    process.env.CO_NEWBIZ_DB_PATH = "preset";
    process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "llm";
    resetRootEnvForTests(tmp);
    loadRootEnvPipelineKeys();
    expect(process.env.CO_NEWBIZ_DB_PATH).toBe("preset");
    expect(process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS).toBe("llm");
    expect(envKeySource("CO_NEWBIZ_DB_PATH")).toBe("process_env");
  });
});

describe("boot shadow warning (design 2026-11-13-env-single-source §3.4B)", () => {
  function loadCapturingWarnings(envText: string): string[] {
    writeFileSync(join(tmp, ".env"), envText);
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (msg?: unknown) => {
      warnings.push(String(msg));
    };
    try {
      resetRootEnvForTests(tmp);
      loadRootEnvPipelineKeys();
    } finally {
      console.warn = realWarn;
    }
    return warnings;
  }

  test("warns once, naming the key, when a divergent shadow exists — and never overrides", () => {
    process.env.CO_NEWBIZ_DB_PATH = "/from/app-auto-load.sqlite";
    const warnings = loadCapturingWarnings("CO_NEWBIZ_DB_PATH=/from/root-file.sqlite\n");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("[root-env] CO_NEWBIZ_DB_PATH:");
    expect(warnings[0]).toContain("root .env is the SSOT");
    // Values are never printed.
    expect(warnings[0]).not.toContain("/from/");
    // The no-override rule is untouched: the shadowing value stays in effect.
    expect(process.env.CO_NEWBIZ_DB_PATH).toBe("/from/app-auto-load.sqlite");
  });

  test("stays silent on an equal-value shadow (whitespace-normalized)", () => {
    // The exact migration shape: a trailing space on disk that no reader ever
    // propagated — normalized equal, so no warning and no override.
    process.env.CO_NEWBIZ_LLM_MODEL = "gpt-6.1-terra";
    const warnings = loadCapturingWarnings("CO_NEWBIZ_LLM_MODEL=gpt-6.1-terra \n");
    expect(warnings.length).toBe(0);
    expect(process.env.CO_NEWBIZ_LLM_MODEL).toBe("gpt-6.1-terra");
  });

  test("stays silent when the key is root-only (no shadow at all)", () => {
    const warnings = loadCapturingWarnings("CO_NEWBIZ_DB_PATH=/from/root-file.sqlite\n");
    expect(warnings.length).toBe(0);
    expect(process.env.CO_NEWBIZ_DB_PATH).toBe("/from/root-file.sqlite");
  });
});
