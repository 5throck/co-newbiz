// @version 1.0.0
/**
 * Entry-market flow redesign slice 3 (2026-10-17, design S5.4/S7 slice 3) -
 * AI draft reliability for POST /api/opportunities/:id/entry-market-derivation/draft.
 * Root cause fixed: the old user-prompt JSON template carried a prose
 * placeholder ("factor":0.0-1.0...) in a value slot, so models imitated it
 * and emitted string factors the strict validator rejects whole. Covered:
 * the output instruction is a VALID JSON example with a numeric factor, the
 * hardened extractor (whole text / fenced block / first balanced object /
 * prose-wrapped / trailing text), the ONE repair retry on strict-validation
 * failure (faked model, no live LLM), and all-invalid still degrades to
 * draft: null. Strict validation rules are unchanged - junk is never coerced.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-entry-market-draft.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

// -- fake the LLM (no live call in tests; pattern: recorded fixtures) -----------
const realLlm = await import("../../app/web-next/lib/llm.ts");
const llmCalls: Array<{ userContent: string }> = [];
let replies: string[] = [];
mock.module("../../app/web-next/lib/llm.ts", () => ({
  ...realLlm,
  isLlmConfigured: () => true,
  completeDetailed: async (messages: Array<{ role: string; content: string }>) => {
    const last = messages[messages.length - 1];
    llmCalls.push({ userContent: last.content });
    const text = replies.shift() ?? "";
    return {
      text,
      usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, model: "mock-model", provider: "mock" },
      finishReason: "stop",
    };
  },
}));

const draftRoute = await import("../../app/web-next/app/api/opportunities/[id]/entry-market-derivation/draft/route.ts");
const { draftOutputInstruction, buildRepairUserPrompt, extractJsonObject } = draftRoute;

const NOW = new Date().toISOString();
const ANALYST = "draft-analyst";
let cookie = "";
const json = JSON.stringify;
const PAYLOAD = json({ anchor: { sources: [], total: 800 }, scope: { regions: ["we", "ee"], segments: [], unit_basis: "usd_m_year" } });

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function seedSizing(industryId: string, payload: string) {
  db.run("INSERT OR IGNORE INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryId, industryId, "t", "Test Industry", NOW]);
  db.run("INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", ["ana-" + industryId, industryId, "completed", ANALYST, NOW]);
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES (?,?,?,?,?,?,?)",
    ["ver-" + industryId, "ana-" + industryId, 1, payload, ANALYST, NOW, "C"],
  );
  return "ver-" + industryId;
}

function makeOpp(industryId: string | null = null): string {
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, industry_id, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp", "scope", "identified", ANALYST, NOW, industryId, 80000, 0.06],
  );
  return oppId;
}

const postDraft = (id: string, headers: Record<string, string> = { cookie }) =>
  nextRequest("/api/opportunities/" + id + "/entry-market-derivation/draft", { method: "POST", headers });
const putLink = (id: string, body: unknown, headers: Record<string, string> = { cookie }) =>
  nextRequest("/api/opportunities/" + id + "/sizing-link", { method: "PUT", headers, body: json(body) });

function goodStepsJson(): string {
  return json({
    steps: [
      { base: "s1_anchor", factor: 0.5, source: "region share", as_of: "2026-06", region_tags: ["we"], segment_tags: [] },
      { base: "step:0", factor: 0.4, source: "segment share", as_of: "2026-06", region_tags: [], segment_tags: ["seg"] },
    ],
  });
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-draft-rel-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-draft-rel-1");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// -- prompt template validity -------------------------------------------------------------------
describe("draft output instruction is a valid JSON template", () => {
  test("the example block parses and every factor is a NUMBER literal, never a string", () => {
    const instruction = draftOutputInstruction();
    // the template line: the first standalone {...} JSON line of the instruction
    const line = instruction.split("\n").find((l) => l.startsWith("{"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!) as { steps: Array<{ base: string; factor: unknown }> };
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
    for (const s of parsed.steps) {
      expect(typeof s.factor).toBe("number");
      expect(s.factor).toBeGreaterThan(0);
      expect(s.factor).toBeLessThanOrEqual(1);
    }
    // the explicit factor-is-a-number rule is present (design 5.4 #1):
    // the numeric literal example is quoted and the old prose placeholder is gone
    expect(instruction).toContain("0.35");
    expect(instruction).not.toContain("0.0-1.0");
    expect(instruction).not.toContain("0.0-1.0");
    // the full instruction example survives the route's own strict validator
    const { normalizeEntryMarketDerivationInput } = require("../../app/web-next/lib/entry-market.ts");
    const { steps } = normalizeEntryMarketDerivationInput(parsed);
    expect(steps.length).toBe(parsed.steps.length);
  });

  test("buildDraftUserPrompt ends with the valid instruction", async () => {
    const opp = makeOpp();
    const versionId = seedSizing("ind-draft-prompt", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    // fire the endpoint and inspect the FIRST recorded user prompt
    replies = [goodStepsJson()];
    llmCalls.length = 0;
    const res = await postDraft(opp);
    expect(res.status).toBe(200);
    expect(llmCalls.length).toBe(1);
    const prompt = llmCalls[0].userContent;
    expect(prompt).toContain(draftOutputInstruction());
    expect(prompt).not.toContain("0.0-1.0");
  });

  test("buildRepairUserPrompt carries the failing rule and the rejected text", () => {
    const rejected = "not json at all";
    const p = buildRepairUserPrompt(rejected, "steps[0].factor is wrong");
    expect(p).toContain("steps[0].factor is wrong");
    expect(p).toContain(rejected);
    expect(p).toContain(draftOutputInstruction());
  });
});

// -- hardened extraction -------------------------------------------------------------------------
describe("extractJsonObject is tolerant of prose and fences", () => {
  const obj = { steps: [{ factor: 0.5 }] };
  const asText = json(obj);

  test("clean JSON parses", () => {
    expect(extractJsonObject(asText)).toEqual(obj);
  });
  test("prose-wrapped JSON parses (balanced-object attempt)", () => {
    expect(extractJsonObject("The draft follows.\n" + asText + "\nPlease review.")).toEqual(obj);
  });
  test("a fenced ```json block parses", () => {
    expect(extractJsonObject("Here:\n```json\n" + asText + "\n```\ndone")).toEqual(obj);
  });
  test("a bare ``` fence parses too", () => {
    expect(extractJsonObject("```\n" + asText + "\n```")).toEqual(obj);
  });
  test("prose BETWEEN two brace groups no longer fails wholesale (first object wins)", () => {
    const other = { unrelated: true };
    expect(extractJsonObject("{" + asText.slice(1) + "\nsome prose {\"unrelated\": true}")).toEqual(obj);
  });
  test("trailing text after the object does not break the balanced attempt", () => {
    expect(extractJsonObject(asText + " trailing }{ junk")).toEqual(obj);
  });
  test("no JSON at all returns null", () => {
    expect(extractJsonObject("sorry, I cannot help with that")).toBeNull();
  });
});

// -- repair-retry path through the endpoint (faked model, nothing written) -------------------------
describe("draft endpoint repair retry", () => {
  test("template-imitating reply (string factor) is repaired by ONE follow-up call into a valid draft", async () => {
    const opp = makeOpp();
    const versionId = seedSizing("ind-draft-retry", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    // a template-imitating reply: string factor inside a fenced block
    const bad = "```json\n{\"steps\":[{\"base\":\"s1_anchor\",\"factor\":\"0.5\",\"source\":\"s\",\"as_of\":\"2026-06\"}]}\n```";
    replies = [bad, goodStepsJson()];
    llmCalls.length = 0;
    const res = await postDraft(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.source).toBe("llm");
    expect(body.data.draft).not.toBeNull();
    expect(body.data.draft.steps.length).toBe(2);
    for (const s of body.data.draft.steps) expect(s.origin).toBe("ai_suggested");
    expect(body.data.draft.computed.entry_market_krw_m).toBeGreaterThan(0);
    // exactly two model calls: the draft + the one repair retry (design OD-5)
    expect(llmCalls.length).toBe(2);
    // the repair prompt quotes the validator's rule and the rejected text
    expect(llmCalls[1].userContent).toContain("factor");
    expect(llmCalls[1].userContent).toContain("0.5");
    // writes nothing
    const row = db.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = ?").get(opp) as { der: string | null };
    expect(row.der).toBeNull();
  });

  test("a good first reply needs exactly ONE call", async () => {
    const opp = makeOpp();
    const versionId = seedSizing("ind-draft-good", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    replies = [goodStepsJson()];
    llmCalls.length = 0;
    const res = await postDraft(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.draft).not.toBeNull();
    expect(llmCalls.length).toBe(1);
  });

  test("all-invalid output still degrades to draft: null with the failing rule in the note", async () => {
    const opp = makeOpp();
    const versionId = seedSizing("ind-draft-bad", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    const bad = json({ steps: [{ base: "s1_anchor", factor: "0.5", source: "s", as_of: "x" }] });
    replies = [bad, bad];
    llmCalls.length = 0;
    const res = await postDraft(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.draft).toBeNull();
    expect(body.data.source).toBe("unavailable");
    expect(typeof body.data.note).toBe("string");
    expect(body.data.note).toContain("factor");
    // exactly one repair retry, never more
    expect(llmCalls.length).toBe(2);
    const row = db.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = ?").get(opp) as { der: string | null };
    expect(row.der).toBeNull();
  });

  test("non-JSON replies on both attempts also degrade to null", async () => {
    const opp = makeOpp();
    const versionId = seedSizing("ind-draft-nojson", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    replies = ["no json here", "still no json {}"];
    llmCalls.length = 0;
    const res = await postDraft(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.draft).toBeNull();
    expect(llmCalls.length).toBe(2);
  });
});
