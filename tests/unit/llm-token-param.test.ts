/**
 * Token-cap parameter resolution (design 2026-11-13-llm-max-completion-tokens):
 * the resolver (knob → api.openai.com heuristic → memoized probe default), the
 * in-band 400-signature probe with memoization, the x4 retry narrowed to empty
 * responses, and the provider-aware default budgets (openai-compatible/custom
 * 6000, anthropic/gemini 1500 — user decision 2026-11-13). Also the §8.3
 * follow-up (user decision 2026-11-13): `temperature` is omitted entirely from
 * openai-compatible/custom bodies (reasoning models reject non-default sampling
 * values; omission is universally accepted), while anthropic/gemini bodies keep
 * it. Every provider call is a mocked fetch; no real provider is ever contacted.
 */
import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { z } from "zod";

// The ledger writes go to an isolated, migrated DB — never the dev database.
const TEST_DB_PATH = "db/data/test-llm-token-param.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const x of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + x)) rmSync(TEST_DB_PATH + x);
const { resetDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { completeDetailed, completeStructured, stream, __resetTokenParamStateForTests } = await import(
  "../../app/web-next/lib/llm.ts"
);
resetDb();
runMigrations(TEST_DB_PATH);
afterAll(() => {
  resetDb();
  for (const x of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + x)) rmSync(TEST_DB_PATH + x);
});

const agent = { key: "pm", purpose: "test" };
const OPENAI_HOST = "https://api.openai.com/v1";
const THIRD_PARTY_HOST = "https://llm.test";
const REJECTION_400 =
  "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";

const saved: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "CO_NEWBIZ_LLM_PROVIDER",
  "CO_NEWBIZ_LLM_BASE_URL",
  "CO_NEWBIZ_LLM_API_KEY",
  "CO_NEWBIZ_LLM_MODEL",
  "CO_NEWBIZ_LLM_CAPS",
  "CO_NEWBIZ_LLM_MAX_TOKENS_PARAM",
];
const realFetch = globalThis.fetch;
type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];

function configure(provider: string, caps = "", model = "test-model") {
  process.env.CO_NEWBIZ_LLM_PROVIDER = provider;
  process.env.CO_NEWBIZ_LLM_API_KEY = "tk-fake";
  process.env.CO_NEWBIZ_LLM_MODEL = model;
  process.env.CO_NEWBIZ_LLM_BASE_URL = THIRD_PARTY_HOST;
  process.env.CO_NEWBIZ_LLM_CAPS = caps;
  delete process.env.CO_NEWBIZ_LLM_MAX_TOKENS_PARAM;
}

const jsonRes = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Replies served in order (last one repeats). */
function mockReplies(replies: Array<{ status: number; body: unknown }>) {
  let i = 0;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(_url), body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
    const r = replies[Math.min(i++, replies.length - 1)];
    return jsonRes(r.status, r.body);
  }) as unknown as typeof fetch;
}

const openaiText = (text: string, usage: Record<string, unknown> = { prompt_tokens: 50, completion_tokens: 10 }) => ({
  choices: [{ message: { content: text }, finish_reason: "stop" }],
  usage,
});
const anthropicText = (text: string) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  calls = [];
  __resetTokenParamStateForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
});

describe("unchanged branches", () => {
  test("anthropic: body byte-identical — max_tokens, thinking disabled, no max_completion_tokens", async () => {
    configure("anthropic");
    mockReplies([{ status: 200, body: anthropicText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent, temperature: 0.5, maxTokens: 400 });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      model: "test-model",
      thinking: { type: "disabled" },
      max_tokens: 400,
      temperature: 0.5,
      system: undefined,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("gemini: cap stays at generationConfig.maxOutputTokens, no wire param at top level", async () => {
    configure("gemini", "", "gem-x");
    mockReplies([{ status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    const body = calls[0].body as {
      generationConfig: { maxOutputTokens: number };
      max_tokens?: unknown;
      max_completion_tokens?: unknown;
    };
    expect(body.generationConfig).toEqual({ temperature: 0.3, maxOutputTokens: 1500 });
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  test("openai-compatible/custom: temperature is OMITTED from the body even when CallSpec.temperature is set", async () => {
    // api.openai.com host (heuristic branch) AND third-party host (compatibility
    // branch) — the omission is branch-wide, not tied to the parameter name.
    for (const baseUrl of [OPENAI_HOST, THIRD_PARTY_HOST]) {
      configure("openai-compatible");
      process.env.CO_NEWBIZ_LLM_BASE_URL = baseUrl;
      mockReplies([{ status: 200, body: openaiText("ok") }]);
      await completeDetailed([{ role: "user", content: "hi" }], { agent, temperature: 0.5, maxTokens: 400 });
      expect("temperature" in calls[0].body).toBe(false);
      expect(calls[0].body.max_completion_tokens ?? calls[0].body.max_tokens).toBe(400);
    }
    // completeStructured always sets a temperature in its base spec (opts ?? 0) —
    // the openai body must still omit the key.
    const Schema = z.object({ verdict: z.string() });
    configure("openai-compatible");
    process.env.CO_NEWBIZ_LLM_BASE_URL = OPENAI_HOST;
    mockReplies([{ status: 200, body: openaiText('{"verdict":"ok"}') }]);
    await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v", agent });
    expect("temperature" in calls[0].body).toBe(false);
  });

  test("custom provider on a third-party host: temperature omitted, max_tokens default kept", async () => {
    configure("custom");
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent, temperature: 0.2 });
    expect("temperature" in calls[0].body).toBe(false);
    expect(calls[0].body.max_tokens).toBe(6000);
    expect(calls[0].body.max_completion_tokens).toBeUndefined();
  });
});

describe("resolver", () => {
  test("auto + api.openai.com host: max_completion_tokens on the first call, zero probes", async () => {
    configure("openai-compatible");
    process.env.CO_NEWBIZ_LLM_BASE_URL = OPENAI_HOST;
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    const r = await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(r.text).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.max_completion_tokens).toBe(6000); // provider-aware default budget
    expect(calls[0].body.max_tokens).toBeUndefined();
  });

  test("lookalike host (api.openai.com.attacker.io) does NOT trigger the heuristic — stays on the max_tokens path", async () => {
    // Exact-host match only (design §3.1): a suffixing/lookalike host must never
    // be treated as api.openai.com, or a hostile proxy could steer parameter choice.
    configure("openai-compatible");
    process.env.CO_NEWBIZ_LLM_BASE_URL = "https://api.openai.com.attacker.io/v1";
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_tokens).toBe(6000);
    expect(calls[0].body.max_completion_tokens).toBeUndefined();
  });

  test("auto + third-party host: max_tokens first", async () => {
    configure("openai-compatible");
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_tokens).toBe(6000);
    expect(calls[0].body.max_completion_tokens).toBeUndefined();
  });

  test("knob=max_tokens forces the old name even on the api.openai.com host", async () => {
    configure("openai-compatible");
    process.env.CO_NEWBIZ_LLM_BASE_URL = OPENAI_HOST;
    process.env.CO_NEWBIZ_LLM_MAX_TOKENS_PARAM = "max_tokens";
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_tokens).toBe(6000);
    expect(calls[0].body.max_completion_tokens).toBeUndefined();
  });

  test("knob=max_completion_tokens forces the new name on a third-party host with no probe", async () => {
    configure("openai-compatible");
    process.env.CO_NEWBIZ_LLM_MAX_TOKENS_PARAM = "max_completion_tokens";
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.max_completion_tokens).toBe(6000);
    expect(calls[0].body.max_tokens).toBeUndefined();
  });

  test("knob=auto behaves like unset (heuristic on the OpenAI host)", async () => {
    configure("openai-compatible");
    process.env.CO_NEWBIZ_LLM_BASE_URL = OPENAI_HOST;
    process.env.CO_NEWBIZ_LLM_MAX_TOKENS_PARAM = "auto";
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_completion_tokens).toBe(6000);
  });

  test("unknown knob value: warns once naming the value, behaves as auto", async () => {
    configure("openai-compatible");
    process.env.CO_NEWBIZ_LLM_MAX_TOKENS_PARAM = "maxtokenz";
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: unknown) => void warns.push(String(m));
    try {
      await completeDetailed([{ role: "user", content: "hi" }], { agent });
      await completeDetailed([{ role: "user", content: "hi" }], { agent });
    } finally {
      console.warn = origWarn;
    }
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("CO_NEWBIZ_LLM_MAX_TOKENS_PARAM");
    expect(warns[0]).toContain("maxtokenz");
    expect(warns[0]).not.toContain("tk-fake");
    // behaves as auto: third-party host → max_tokens
    expect(calls[0].body.max_tokens).toBe(6000);
  });
});

describe("in-band probe (400 signature → one resend, memoized)", () => {
  test("third-party host: 400 signature resends with max_completion_tokens at the ORIGINAL budget and succeeds", async () => {
    configure("openai-compatible");
    mockReplies([
      { status: 400, body: REJECTION_400 },
      { status: 200, body: openaiText("recovered") },
    ]);
    const r = await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(r.text).toBe("recovered");
    expect(calls).toHaveLength(2);
    expect(calls[0].body.max_tokens).toBe(6000);
    expect(calls[1].body.max_completion_tokens).toBe(6000); // original default budget, NOT x4 (24000)
    expect(calls[1].body.max_tokens).toBeUndefined();
  });

  test("probe resend keeps an explicit budget un-multiplied", async () => {
    configure("openai-compatible");
    mockReplies([
      { status: 400, body: REJECTION_400 },
      { status: 200, body: openaiText("ok") },
    ]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent, maxTokens: 300 });
    expect(calls[0].body.max_tokens).toBe(300);
    expect(calls[1].body.max_completion_tokens).toBe(300); // not 1200
  });

  test("memoized: the next call on the same provider|baseUrl|model sends the new name on the FIRST attempt", async () => {
    configure("openai-compatible");
    mockReplies([
      { status: 400, body: REJECTION_400 },
      { status: 200, body: openaiText("first") },
    ]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    calls = [];
    mockReplies([{ status: 200, body: openaiText("second") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls).toHaveLength(1); // no intervening 400
    expect(calls[0].body.max_completion_tokens).toBe(6000);
  });

  test("memo does not leak across provider|baseUrl|model — a different model starts on the old name", async () => {
    configure("openai-compatible");
    mockReplies([
      { status: 400, body: REJECTION_400 },
      { status: 200, body: openaiText("ok") },
    ]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    calls = [];
    configure("openai-compatible", "", "other-model");
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_tokens).toBe(6000);
    expect(calls[0].body.max_completion_tokens).toBeUndefined();
  });

  test("doubly-failing endpoint: the refined adaptive-resend message is thrown", async () => {
    configure("openai-compatible");
    mockReplies([{ status: 400, body: REJECTION_400 }]);
    await expect(completeDetailed([{ role: "user", content: "hi" }], { agent })).rejects.toThrow(
      /rejected 'max_tokens'; retrying with 'max_completion_tokens'/,
    );
    expect(calls).toHaveLength(2); // both attempts, second with the corrected name
    expect(calls[1].body.max_completion_tokens).toBe(6000);
  });

  test("a 400 with an unrelated message does NOT flip the memo or resend a new name", async () => {
    configure("openai-compatible");
    mockReplies([{ status: 400, body: "Invalid model id" }]);
    await expect(completeDetailed([{ role: "user", content: "hi" }], { agent })).rejects.toThrow(/Invalid model id/);
    expect(calls[1].body.max_tokens).toBe(6000);
    expect(calls[1].body.max_completion_tokens).toBeUndefined();
  });
});

describe("x4 retry binds to empty responses only", () => {
  test("anthropic empty response: second attempt at 1500 x 4 = 6000", async () => {
    configure("anthropic");
    mockReplies([
      { status: 200, body: { content: [] } }, // empty → EmptyResponseError
      { status: 200, body: anthropicText("ok") },
    ]);
    const r = await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(r.text).toBe("ok");
    expect(calls[0].body.max_tokens).toBe(1500); // anthropic default budget
    expect(calls[1].body.max_tokens).toBe(6000);
  });

  test("openai-compatible empty response: 6000 x 4 = 24000", async () => {
    configure("openai-compatible");
    mockReplies([
      { status: 200, body: openaiText("") },
      { status: 200, body: openaiText("ok") },
    ]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_tokens).toBe(6000);
    expect(calls[1].body.max_tokens).toBe(24000);
  });

  test("parameter-format 400 never multiplies the budget (covered against regression)", async () => {
    configure("openai-compatible");
    mockReplies([
      { status: 400, body: REJECTION_400 },
      { status: 200, body: openaiText("ok") },
    ]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent, maxTokens: 250 });
    expect(calls[1].body.max_completion_tokens).toBe(250); // original, not 1000
  });
});

describe("provider-aware default budgets at all three default sites", () => {
  test("site 1 — runProvider base budget: openai-compatible 6000 vs anthropic 1500", async () => {
    configure("openai-compatible");
    mockReplies([{ status: 200, body: openaiText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_tokens).toBe(6000);
    configure("anthropic");
    calls = [];
    mockReplies([{ status: 200, body: anthropicText("ok") }]);
    await completeDetailed([{ role: "user", content: "hi" }], { agent });
    expect(calls[0].body.max_tokens).toBe(1500);
  });

  test("site 2 — completeStructured default: openai-compatible 6000, anthropic 1500, gemini 1500", async () => {
    const Schema = z.object({ verdict: z.string(), score: z.number() });
    configure("openai-compatible");
    mockReplies([{ status: 200, body: openaiText('{"verdict":"ok","score":3}') }]);
    const r1 = await completeStructured({
      messages: [{ role: "user", content: "hi" }],
      schema: Schema,
      schemaName: "v",
      agent,
    });
    expect(r1.source).toBe("llm");
    expect(calls[0].body.max_tokens).toBe(6000);
    configure("anthropic");
    calls = [];
    mockReplies([
      { status: 200, body: { content: [{ type: "tool_use", name: "v", input: { verdict: "ok", score: 3 } }] } },
    ]);
    await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v", agent });
    expect(calls[0].body.max_tokens).toBe(1500);
    configure("gemini", "", "gem-x");
    calls = [];
    mockReplies([
      { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"verdict":"ok","score":3}' }] } }] } },
    ]);
    await completeStructured({ messages: [{ role: "user", content: "hi" }], schema: Schema, schemaName: "v", agent });
    const body = calls[0].body as { generationConfig: { maxOutputTokens: number } };
    expect(body.generationConfig.maxOutputTokens).toBe(1500);
  });
});

describe("streaming path memo write", () => {
  function sseResponse(lines: string[]) {
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(`${lines.join("\n")}\n`));
          c.close();
        },
      }),
      { status: 200 },
    );
  }
  test("streaming call on a rejecting host fails once, memoizes; next call sends the new name", async () => {
    configure("openai-compatible", "stream");
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      calls.push({ url: String(_u), body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
      return jsonRes(400, REJECTION_400);
    }) as unknown as typeof fetch;
    await expect(
      (async () => {
        for await (const _ev of stream({ messages: [{ role: "user", content: "hi" }], agent })) void _ev;
      })(),
    ).rejects.toThrow(/retrying with 'max_completion_tokens'/);
    expect(calls[0].body.max_tokens).toBe(6000);
    // Next call (streaming again) goes out with the corrected name on the first attempt.
    calls = [];
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      calls.push({ url: String(_u), body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
      return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: "A" } }] })}`, "data: [DONE]"]);
    }) as unknown as typeof fetch;
    const out: string[] = [];
    for await (const ev of stream({ messages: [{ role: "user", content: "hi" }], agent })) {
      if (ev.type === "text") out.push(ev.delta);
    }
    expect(out).toEqual(["A"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.max_completion_tokens).toBe(6000);
    expect(calls[0].body.max_tokens).toBeUndefined();
  });
});
