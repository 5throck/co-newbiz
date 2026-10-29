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

const TOUCHED = ["KOSIS_API_KEY", "LAW_API_OC", "DATA_GO_KR_API_KEY", "DART_API_KEY", "SERPER_API_KEY", "UNRELATED_SECRET"];
let tmp: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "root-env-"));
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});
afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetRootEnvForTests(null);
  rmSync(tmp, { recursive: true, force: true });
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
