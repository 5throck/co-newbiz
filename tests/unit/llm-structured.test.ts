/**
 * Wave B / B-1 — completeStructured, usage parsing, cost math, streaming and
 * the OTel no-op. Every provider call is a mocked fetch; no real provider is
 * ever contacted.
 */
import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { z } from "zod";

// The ledger writes go to an isolated, migrated DB — never the dev database.
const TEST_DB_PATH = "db/data/test-llm-structured.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const x of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + x)) rmSync(TEST_DB_PATH + x);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { completeStructured, completeDetailed, stream, getLlmCaps } = await import("../../app/web-next/lib/llm.ts");
const { parseUsage, costUsd, setPricingTableForTests, estimateTokens } = await import("../../app/web-next/lib/llm-usage.ts");
const { llmUsageRollup } = await import("../../app/web-next/lib/llm-rollup.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
afterAll(() => {
  resetDb();
  for (const x of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + x)) rmSync(TEST_DB_PATH + x);
});

const Schema = z.object({ verdict: z.string(), score: z.number() }).strict();
const GOOD = { verdict: "ok", score: 3 };
const ENV_KEYS = ["CO_NEWBIZ_LLM_PROVIDER", "CO_NEWBIZ_LLM_BASE_URL", "CO_NEWBIZ_LLM_API_KEY", "CO_NEWBIZ_LLM_MODEL", "CO_NEWBIZ_LLM_CAPS", "OTEL_EXPORTER_OTLP_ENDPOINT"];
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];

function configure(provider: string, caps = "", model = "test-model") {
  process.env.CO_NEWBIZ_LLM_PROVIDER = provider;
  process.env.CO_NEWBIZ_LLM_API_KEY = "tk-fake";
  process.env.CO_NEWBIZ_LLM_MODEL = model;
  process.env.CO_NEWBIZ_LLM_BASE_URL = "https://llm.test";
  process.env.CO_NEWBIZ_LLM_CAPS = caps;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}
function mockReplies(replies: unknown[]) {
  let i = 0;
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
    const r = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
const anthropicTool = (input: unknown, usage: Record<string, number> = { input_tokens: 100, output_tokens: 20 }) => ({
  content: [{ type: "tool_use", name: "x", input }],
  usage,
});
const openaiText = (text: string, usage: Record<string, unknown> = { prompt_tokens: 50, completion_tokens: 10 }) => ({
  choices: [{ message: { content: text } }],
  usage,
});

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  calls = [];
  setPricingTableForTests({ "test-model": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
  setPricingTableForTests(null);
});

describe("capabilities", () => {
  test("parsed from config, not from the model name", () => {
    configure("anthropic", "structured, cache", "claude-whatever");
    expect(getLlmCaps()).toEqual({ structured: true, cache: true, stream: false });
    configure("anthropic", "");
    expect(getLlmCaps()).toEqual({ structured: false, cache: false, stream: false });
  });
});

describe("completeStructured", () => {
  test("anthropic: forced tool + valid input + cache_control + usage with cache tokens", async () => {
    configure("anthropic", "structured,cache");
    mockReplies([anthropicTool(GOOD, { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 })]);
    const r = await completeStructured({
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      schema: Schema, schemaName: "verdict", cache: { system: true },
    });
    expect(r.source).toBe("llm");
    if (r.source !== "llm") throw new Error("unreachable");
    expect(r.value).toEqual(GOOD);
    expect(r.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 400, cacheWriteTokens: 50 });
    expect(r.usage.estimated).toBeUndefined();
    const body = calls[0].body as { tools: Array<{ input_schema: { type: string } }>; tool_choice: { type: string }; system: Array<{ cache_control: unknown }> };
    expect(body.tools[0].input_schema.type).toBe("object");
    expect(body.tool_choice.type).toBe("tool");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  test("cache flag is ignored when the cache cap is not declared", async () => {
    configure("anthropic", "structured");
    mockReplies([anthropicTool(GOOD)]);
    await completeStructured({ messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], schema: Schema, schemaName: "v", cache: { system: true } });
    expect(typeof (calls[0].body as { system: unknown }).system).toBe("string");
  });

  test("openai: response_format json_schema, prompt_tokens_details.cached_tokens split out", async () => {
    configure("openai", "structured");
    mockReplies([openaiText(JSON.stringify(GOOD), { prompt_tokens: 80, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 30 } })]);
    const r = await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v" });
    if (r.source !== "llm") throw new Error("expected llm");
    expect((calls[0].body as { response_format: { type: string } }).response_format.type).toBe("json_schema");
    expect(r.usage).toMatchObject({ inputTokens: 50, outputTokens: 12, cacheReadTokens: 30 });
  });

  test("gemini: responseJsonSchema + usageMetadata", async () => {
    configure("gemini", "structured", "gem-x");
    mockReplies([{ candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD) }] } }], usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 9, cachedContentTokenCount: 20 } }]);
    const r = await completeStructured({ messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }], schema: Schema, schemaName: "v" });
    if (r.source !== "llm") throw new Error("expected llm");
    expect(calls[0].url).toContain(":generateContent");
    expect((calls[0].body as { generationConfig: { responseMimeType: string } }).generationConfig.responseMimeType).toBe("application/json");
    expect(r.usage).toMatchObject({ inputTokens: 50, outputTokens: 9, cacheReadTokens: 20 });
  });

  test("custom (openai-compatible) without the structured cap: instruct-and-parse from fenced text", async () => {
    configure("custom", "");
    mockReplies([openaiText("```json\n" + JSON.stringify(GOOD) + "\n```")]);
    const r = await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v" });
    expect(r.source).toBe("llm");
    const body = calls[0].body as { response_format?: unknown; messages: Array<{ content: string }> };
    expect(body.response_format).toBeUndefined();
    expect(body.messages.at(-1)?.content).toContain("JSON Schema");
  });

  test("invalid then repaired: one repair retry names failing paths and does not echo the raw output", async () => {
    configure("anthropic", "structured");
    mockReplies([anthropicTool({ verdict: "ok", score: "SECRET-RAW" }), anthropicTool(GOOD)]);
    const r = await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v" });
    if (r.source !== "llm") throw new Error("expected repaired llm result");
    expect(calls).toHaveLength(2);
    const followUp = JSON.stringify(calls[1].body);
    expect(followUp).toContain("score");
    expect(followUp).not.toContain("SECRET-RAW");
    expect(r.usage.inputTokens).toBe(200); // both rounds counted
  });

  test("invalid twice: explicit synthesis fallback with validation_failed", async () => {
    configure("anthropic", "structured");
    mockReplies([anthropicTool({ nope: 1 })]);
    const r = await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v" });
    expect(r.source).toBe("synthesis");
    expect((r as { reason?: string }).reason).toBe("validation_failed");
    expect(calls).toHaveLength(2);
  });

  test("provider HTTP failure: fallback, no throw", async () => {
    configure("openai", "structured");
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const r = await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v" });
    expect(r.source).toBe("synthesis");
  });

  test("no provider configured: synthesis, no network", async () => {
    process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
    mockReplies([{}]);
    const r = await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v" });
    expect(r.source).toBe("synthesis");
    expect(calls).toHaveLength(0);
  });

  test("missing usage block: chars/4 fallback flagged estimated", async () => {
    configure("openai", "structured");
    mockReplies([{ choices: [{ message: { content: JSON.stringify(GOOD) } }] }]);
    const r = await completeStructured({ messages: [{ role: "user", content: "hello world!" }], schema: Schema, schemaName: "v" });
    if (r.source !== "llm") throw new Error("expected llm");
    expect(r.usage.estimated).toBe(true);
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });
});

describe("completeDetailed", () => {
  test("returns text and provider usage", async () => {
    configure("custom", "");
    mockReplies([openaiText("plain", { prompt_tokens: 5, completion_tokens: 2 })]);
    const r = await completeDetailed([{ role: "user", content: "x" }]);
    expect(r.text).toBe("plain");
    expect(r.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, model: "test-model", provider: "custom" });
  });
});

describe("parseUsage / estimateTokens", () => {
  test("anthropic-shaped custom endpoint and absent usage", () => {
    expect(parseUsage("custom", "m", { usage: { input_tokens: 4, output_tokens: 5 } })).toMatchObject({ inputTokens: 4, outputTokens: 5 });
    expect(parseUsage("openai", "m", {})).toBeNull();
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("cost math", () => {
  const u = (over: Partial<Parameters<typeof costUsd>[0]> = {}) => ({
    inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000,
    model: "test-model", provider: "anthropic", ...over,
  });
  test("per-million arithmetic across all four token kinds", () => {
    expect(costUsd(u())).toBeCloseTo(3 + 15 + 0.3 + 3.75, 6);
    expect(costUsd(u({ inputTokens: 500_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }))).toBeCloseTo(1.5, 6);
  });
  test("unknown model gives null, never a guess", () => {
    const warn = console.warn;
    const msgs: string[] = [];
    console.warn = (m: unknown) => void msgs.push(String(m));
    try {
      expect(costUsd(u({ model: "GLM-5.3-Flash" }))).toBeNull();
      expect(costUsd(u({ model: "GLM-5.3-Flash" }))).toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(msgs).toHaveLength(1); // warned once per model
  });
  test("cache tokens with no cache price gives null", () => {
    setPricingTableForTests({ "test-model": { input: 3, output: 15 } });
    expect(costUsd(u())).toBeNull();
  });
});

describe("stream", () => {
  function sseResponse(lines: string[]) {
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines.join("\n") + "\n")); c.close(); } }), { status: 200 });
  }
  test("anthropic SSE: text deltas then merged usage", async () => {
    configure("anthropic", "stream");
    globalThis.fetch = (async () => sseResponse([
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 40, output_tokens: 1 } } })}`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } })}`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "lo" } })}`,
      `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 7 } })}`,
    ])) as unknown as typeof fetch;
    let text = "";
    let usage: unknown = null;
    for await (const ev of stream({ messages: [{ role: "user", content: "hi" }] })) {
      if (ev.type === "text") text += ev.delta;
      else usage = ev.usage;
    }
    expect(text).toBe("Hello");
    expect(usage).toMatchObject({ inputTokens: 40, outputTokens: 7 });
  });
  test("openai SSE with include_usage final chunk", async () => {
    configure("openai", "stream");
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      calls.push({ url: "", body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> });
      return sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "A" } }] })}`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } })}`,
        "data: [DONE]",
      ]);
    }) as unknown as typeof fetch;
    const out: string[] = [];
    let usage: unknown = null;
    for await (const ev of stream({ messages: [{ role: "user", content: "hi" }] })) {
      if (ev.type === "text") out.push(ev.delta);
      else usage = ev.usage;
    }
    expect(out).toEqual(["A"]);
    expect(usage).toMatchObject({ inputTokens: 9, outputTokens: 3 });
    expect((calls[0].body as { stream: boolean }).stream).toBe(true);
  });
  test("without the stream cap: one text event from a normal call", async () => {
    configure("openai", "");
    mockReplies([openaiText("whole")]);
    const evs = [];
    for await (const ev of stream({ messages: [{ role: "user", content: "hi" }] })) evs.push(ev);
    expect(evs.map((e) => e.type)).toEqual(["text", "usage"]);
  });
});

describe("OTel GenAI spans", () => {
  const agent = { key: "pm", purpose: "test", projectId: "P1", functionName: "fn.test" };
  test("no endpoint: nothing is exported (only the provider call is made)", async () => {
    configure("openai", "structured");
    mockReplies([openaiText(JSON.stringify(GOOD))]);
    await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v", agent });
    expect(calls.every((c) => c.url.startsWith("https://llm.test"))).toBe(true);
  });
  test("endpoint set: gen_ai.chat span with attributes and no prompt/completion content", async () => {
    configure("openai", "structured");
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.test";
    mockReplies([openaiText(JSON.stringify({ verdict: "TOP-SECRET-COMPLETION", score: 1 }))]);
    await completeStructured({ messages: [{ role: "user", content: "TOP-SECRET-PROMPT" }], schema: Schema, schemaName: "v", agent });
    await new Promise((r) => setTimeout(r, 10));
    const span = calls.find((c) => c.url === "https://otel.test/v1/traces");
    expect(span).toBeDefined();
    const raw = JSON.stringify(span?.body);
    expect(raw).toContain("gen_ai.chat");
    for (const k of ["gen_ai.system", "gen_ai.request.model", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens", "co_newbiz.project_id", "co_newbiz.function"]) {
      expect(raw).toContain(k);
    }
    expect(raw).not.toContain("TOP-SECRET");
  });
});

describe("agent call ledger + per-deal rollup", () => {
  test("tokens, cost, deal id and function are logged; unknown model costs null; rollup sums per deal", async () => {
    configure("anthropic", "structured");
    mockReplies([anthropicTool(GOOD, { input_tokens: 1_000_000, output_tokens: 0 })]);
    await completeStructured({
      messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v",
      agent: { key: "pm", purpose: "ledger test", projectId: "DEAL-1", functionName: "fn.priced", promptHash: "abc" },
    });
    configure("anthropic", "structured", "GLM-5.3-Flash");
    mockReplies([anthropicTool(GOOD)]);
    await completeStructured({
      messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v",
      agent: { key: "pm", purpose: "ledger test", contextType: "project", contextId: "DEAL-1", functionName: "fn.unpriced" },
    });
    const rows = db.query("SELECT function_name, project_id, input_tokens, cost_usd, usage_estimated, prompt_hash FROM llm_call_log WHERE project_id = 'DEAL-1' ORDER BY created_at, id").all() as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ function_name: "fn.priced", project_id: "DEAL-1", input_tokens: 1_000_000, prompt_hash: "abc", usage_estimated: 0 });
    expect(rows[0].cost_usd).toBeCloseTo(3, 6);
    expect(rows[1].cost_usd).toBeNull();
    const roll = llmUsageRollup(db, "DEAL-1");
    expect(roll).toMatchObject({ calls: 2, llm_calls: 2, unpriced_calls: 1, input_tokens: 1_000_100 });
    expect(roll.cost_usd).toBeCloseTo(3, 6);
    expect(roll.by_function.map((f) => f.function_name).sort()).toEqual(["fn.priced", "fn.unpriced"]);
  });
});
