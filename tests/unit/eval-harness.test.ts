// Wave B-2 eval harness: deterministic suites gate regressions in unit CI; LLM suites are exercised with a MOCK client only.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGoldenSet, GOLDEN_DIR } from "../../scripts/eval/loader.ts";
import { checkThresholds, hhiScreen, runDeterministicSuites } from "../../scripts/eval/deterministic.ts";
import { checkInventory, type InventoryEntry } from "../../scripts/eval/inventory.ts";
import { parseArgs, renderScoreboard, runEval } from "../../scripts/eval/run.ts";
import { RunLedger, metered, raisesKey, type EvalLlm } from "../../scripts/eval/llm-suites.ts";
import { setPricingTableForTests, type LlmUsage } from "../../app/web-next/lib/llm-usage.ts";
import { meanScore } from "../../scripts/eval/types.ts";

const usage = (over: Partial<LlmUsage> = {}): LlmUsage => ({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, model: "mock-model", provider: "mock", ...over });

function mockLlm(text: string): EvalLlm {
  return {
    completeDetailed: async () => ({ text, usage: usage() }),
    completeStructured: async () => ({ source: "synthesis", provider: "deterministic", model: "template", text: "", reason: "validation_failed" }),
  };
}

function tempGolden(): string {
  const dir = mkdtempSync(join(tmpdir(), "golden-"));
  cpSync(GOLDEN_DIR, dir, { recursive: true });
  return dir;
}

describe("golden loader", () => {
  test("loads the committed set", () => {
    const set = loadGoldenSet();
    expect(set.cases.length).toBe(14);
  });

  test("rejects an expectation without a citation", () => {
    const dir = tempGolden();
    try {
      const f = join(dir, "cases", "pilot-008.yaml");
      writeFileSync(f, readFileSync(f, "utf-8").replace(/    citation:\n(      - .*\n)+/, "    citation: []\n"));
      expect(() => loadGoldenSet(dir)).toThrow(/golden set invalid/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a pre-decision input that contains an outcome keyword", () => {
    const dir = tempGolden();
    try {
      const f = join(dir, "fixtures", "pilot-008.input.json");
      const j = JSON.parse(readFileSync(f, "utf-8")) as { facts: Record<string, unknown> };
      j.facts.note = "the regulator approved it";
      writeFileSync(f, JSON.stringify(j));
      expect(() => loadGoldenSet(dir)).toThrow(/LEAKAGE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("deterministic suites (unit-CI regression gate)", () => {
  const set = loadGoldenSet();
  const results = runDeterministicSuites(set);

  test("hold their recorded thresholds", () => {
    expect(checkThresholds(results)).toEqual([]);
  });

  test("rag suite never defaults an unassessed dimension to a grade", () => {
    const rag = results.find((r) => r.name === "rag");
    expect(rag && meanScore(rag.cases)).toBe(1);
  });

  test("expectations the fixtures cannot support are reported, not scored", () => {
    const anti = results.find((r) => r.name === "antitrust");
    expect(anti?.couldNotEvaluate.length).toBeGreaterThan(0);
  });

  test("hhiScreen uses the 2023 presumption zone", () => {
    expect(hhiScreen({ pre_deal_shares_pct: { a: 55.7, b: 33.5 } })?.presumption).toBe(true);
    expect(hhiScreen({ pre_deal_shares_pct: { a: 5, b: 5 } })?.presumption).toBe(false);
    expect(hhiScreen({ pre_deal_shares_pct: { a: 5 } })).toBeNull();
  });
});

describe("call-site inventory", () => {
  test("the committed inventory is complete", () => {
    expect(checkInventory()).toEqual([]);
  });

  test("a new call site without a suite or exemption fails", () => {
    const found = new Map([["app/web-next/lib/new-thing.ts", 1]]);
    expect(checkInventory(found, [])[0]).toContain("no eval suite and no exemption");
  });

  test("an extra call site in a mapped file fails, a stale entry fails", () => {
    const entries: InventoryEntry[] = [{ file: "a.ts", sites: 1, suites: ["committee"] }, { file: "gone.ts", sites: 1, exempt: "reason long enough" }];
    const problems = checkInventory(new Map([["a.ts", 2]]), entries);
    expect(problems.some((p) => p.includes("added or removed"))).toBe(true);
    expect(problems.some((p) => p.includes("stale"))).toBe(true);
  });
});

describe("runEval", () => {
  test("offline default runs only deterministic suites and makes no LLM call", async () => {
    const run = await runEval(parseArgs([]), { llm: { completeDetailed: () => Promise.reject(new Error("must not be called")), completeStructured: () => Promise.reject(new Error("must not be called")) } });
    expect(run.suites.map((s) => s.name).sort()).toEqual(["antitrust", "calibration", "kill", "rag"]);
    expect(run.ledger.calls).toBe(0);
    expect(run.skipped.length).toBe(5);
  });

  test("--llm is refused without CO_NEWBIZ_EVAL_LLM=1", async () => {
    await expect(runEval({ ...parseArgs(["--llm"]), env: {} })).rejects.toThrow(/CO_NEWBIZ_EVAL_LLM=1/);
  });

  test("an LLM suite name without --llm is refused", async () => {
    await expect(runEval(parseArgs(["--suite", "committee"]))).rejects.toThrow(/--llm/);
  });

  test("LLM suites run against a mock and record usage", async () => {
    setPricingTableForTests({ "mock-model": { input: 1, output: 2 } });
    try {
      const text = 'Position.\n<!--position-meta:{"recommendation":"hold","confidence":50}-->';
      const run = await runEval({ ...parseArgs(["--llm", "--suite", "committee"]), env: { CO_NEWBIZ_EVAL_LLM: "1" } }, { llm: mockLlm(text), provider: () => ({ provider: "mock", baseUrlHost: "h", model: "mock-model" }) });
      const c = run.suites.find((s) => s.name === "committee");
      expect(c?.metrics.schema_valid_rate).toBe(1);
      expect(run.ledger.calls).toBe(14);
      expect(run.ledger.input).toBe(14000);
      const md = renderScoreboard(run, { runId: "t", date: "2026-10-08", sha: "abc" });
      expect(md).toContain("mock-model");
      expect(md).toContain("committee");
    } finally {
      setPricingTableForTests(null);
    }
  });

  test("the budget stops the run before it is exceeded", async () => {
    setPricingTableForTests({ "mock-model": { input: 1000, output: 1000 } });
    try {
      // each call costs $1.50 -> a $2.00 budget allows exactly one call
      const run = await runEval({ ...parseArgs(["--llm", "--suite", "committee", "--max-cost-usd", "2"]), env: { CO_NEWBIZ_EVAL_LLM: "1" } }, { llm: mockLlm("x"), provider: () => ({ provider: "mock", baseUrlHost: "h", model: "mock-model" }) });
      expect(run.ledger.calls).toBe(1);
      expect(run.budgetStop).toContain("would be exceeded");
      expect(run.ledger.costUsd).toBeLessThanOrEqual(2);
    } finally {
      setPricingTableForTests(null);
    }
  });

  test("an unpriced model stops the run after the first call", async () => {
    setPricingTableForTests({});
    try {
      const ledger = new RunLedger(2);
      const llm = metered(mockLlm("x"), ledger);
      const meta = { agent: { key: "pm", purpose: "eval harness" } };
      await llm.completeDetailed([], meta);
      await expect(llm.completeDetailed([], meta)).rejects.toThrow(/no price/);
    } finally {
      setPricingTableForTests(null);
    }
  });
});

describe("other LLM suites against a mock", () => {
  const env = { CO_NEWBIZ_EVAL_LLM: "1" };
  const provider = () => ({ provider: "mock", baseUrlHost: "h", model: "mock-model" });
  const go = async (suite: string, llm: EvalLlm) => {
    setPricingTableForTests({ "mock-model": { input: 1, output: 1 } });
    try {
      return await runEval({ ...parseArgs(["--llm", "--suite", suite]), env }, { llm, provider });
    } finally {
      setPricingTableForTests(null);
    }
  };

  test("dd-tailor scores parseable, unsourced items", async () => {
    const run = await go("dd-tailor", mockLlm('[{"item_label":"Check X","rationale":"because"}]'));
    expect(run.suites[0].metrics.schema_valid_rate).toBe(1);
  });

  test("business-case flags numbers that are not in the input block", async () => {
    const run = await go("business-case", mockLlm("Value is 987654321 now."));
    expect(run.suites[0].cases.every((c) => c.failures.some((f) => f.includes("987654321")))).toBe(true);
  });

  test("stage-reco counts schema-invalid chain replies", async () => {
    const run = await go("stage-reco", mockLlm("not json"));
    expect(run.suites[0].metrics.schema_valid_rate).toBe(0);
  });

  test("review-ai2 scores a valid structured reply by finding key", async () => {
    const llm: EvalLlm = {
      completeDetailed: async () => ({ text: "", usage: usage() }),
      completeStructured: async (opts) => ({
        source: "llm",
        usage: usage(),
        value: opts.schema.parse({ verified: [], could_not_verify: [{ claim: "extreme horizontal concentration", reason: "x" }], needs_judgement: [] }),
      }),
    };
    const run = await go("review-ai2", llm);
    expect(run.suites[0].metrics.schema_valid_rate).toBe(1);
  });
});

describe("scoring helpers", () => {
  test("raisesKey matches by finding-key word stems, no judge", () => {
    const items = [{ claim: "Extreme horizontal concentration in the market", reason: "shares combine" }];
    expect(raisesKey(items, "extreme_horizontal_concentration")).toBe(true);
    expect(raisesKey(items, "wacc_hurdle_not_user_supplied")).toBe(false);
  });
});
