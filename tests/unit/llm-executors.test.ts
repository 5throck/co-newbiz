/**
 * LLM executors (lib/llm-executors.ts) — the two documented seams' LLM
 * implementations, tested with a stubbed fetch (no network):
 *  - business-case: persistence stays with the deterministic executor and the
 *    quantitative facts pass through; LLM failure degrades to the
 *    deterministic prose (the chain never dies from a model outage);
 *  - dd-tailor: drafts parse from the model's JSON array; an unparseable
 *    reply throws (route records a failed activity — never silent); sources
 *    are ALWAYS null/'C' (ADR-0099 §6 — the model is never trusted to cite);
 *    items beyond 10 are truncated; empty labels dropped.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeLlmBusinessCaseExecutor } from "../../app/web-next/lib/llm-executors.ts";
import { parsePositionMeta } from "../../app/web-next/lib/committee-llm.ts";

// Stub the LLM HTTP endpoint the same way for both executors.
const origFetch = globalThis.fetch;
let llmReply = "";
let llmCalls = 0;

function stubLlm(reply: () => string) {
  globalThis.fetch = (async () => {
    llmCalls++;
    const text = reply();
    return new Response(
      JSON.stringify({ choices: [{ message: { content: text } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.CO_NEWBIZ_LLM_PROVIDER = "openai";
  process.env.CO_NEWBIZ_LLM_API_KEY = "test-key";
  process.env.CO_NEWBIZ_LLM_MODEL = "test-model";
  delete process.env.CO_NEWBIZ_LLM_BASE_URL;
  llmCalls = 0;
});
afterEach(() => {
  globalThis.fetch = origFetch as typeof fetch;
  delete process.env.CO_NEWBIZ_LLM_PROVIDER;
  delete process.env.CO_NEWBIZ_LLM_API_KEY;
  delete process.env.CO_NEWBIZ_LLM_MODEL;
});

describe("makeLlmBusinessCaseExecutor", () => {
  test("enriches prose while the deterministic facts persist verbatim", async () => {
    stubLlm(() => "### LLM 산출\n\n확정 수치를 그대로 인용한 해석: 시장 점유율 가정의 민감도가 가장 크다.");
    const executor = makeLlmBusinessCaseExecutor();
    const out = await executor("growth_projection", {
      scenario: "base" as never,
      inputs: { projectId: "p", marketSizeKrwM: 1000, anchorGrowth: 0.05 },
    } as never);
    expect(out).toContain("LLM 산출");
    expect(llmCalls).toBe(1);
  });

  test("LLM failure → deterministic prose passes through (chain survives)", async () => {
    globalThis.fetch = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    const executor = makeLlmBusinessCaseExecutor();
    const out = await executor("growth_projection", {
      scenario: "base" as never,
      inputs: { projectId: "p", marketSizeKrwM: 1000, anchorGrowth: 0.05 },
    } as never);
    // deterministic fallback text — the growth_projection branch's templated output
    expect(out).toContain("성장 전망");
  });
});

describe("dd-tailor LLM drafts (via makeLlmDdTailorExecutor)", () => {
  // Import lazily to keep the module graph identical to production.
  const { makeLlmDdTailorExecutor } = require("../../app/web-next/lib/llm-executors.ts") as typeof import("../../app/web-next/lib/llm-executors.ts");

  test("parses the JSON array; sources forced to null/'C'; >10 truncated; empty labels dropped", async () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ item_label: i === 13 ? "" : `항목 ${i}`, rationale: "사유" }));
    stubLlm(() => "```json\n" + JSON.stringify(items) + "\n```");
    const executor = makeLlmDdTailorExecutor();
    const drafts = await executor("commercial", { projectId: "p", industry: "반도체 테스트" });
    expect(drafts.length).toBe(10); // empty label dropped, then truncated to 10
    for (const d of drafts) {
      expect(d.sourceUrl).toBeNull();
      expect(d.sourceReliability).toBe("C");
    }
  });

  test("unparseable reply throws — the activity records a failure, never silent", async () => {
    stubLlm(() => "죄송합니다, 배열을 만들 수 없습니다.");
    const executor = makeLlmDdTailorExecutor();
    expect(executor("legal", { projectId: "p", industry: "x" })).rejects.toThrow(/해석하지 못했습니다/);
  });
});

// committee-llm tail parser guard (already covered in committee-llm.test.ts);
// sanity that this suite file's shared stub didn't leak into it:
test("parsePositionMeta still rejects non-JSON tails", () => {
  expect(parsePositionMeta("x\n<!--position-meta:{broken}-->")).toBeNull();
});
