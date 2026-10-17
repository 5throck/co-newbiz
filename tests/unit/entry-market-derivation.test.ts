// @version 1.0.0
/**
 * ADR-0179 amendment slice B (2026-10-17) - the S2 entry-market derivation
 * over the linked S1 series. Migration 0150, the entry-market-derivation
 * route matrix (PUT human-only, strict validation, clear, 409 not_linked),
 * computed math, generator consumption (bit-identity, derived anchor
 * replacement, run-note fragment), scope grading, the AI-recommendation
 * draft endpoint (degradation, nothing written, provenance), and the
 * sizing auto-link rules (creation, refresh, freeze, audit, provenance).
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-entry-market.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

// -- fake the LLM (ADR-0180 slice 2: hermetic tests; no live call, no .env
//    key consumed — the draft describe previously made a REAL 6s LLM call
//    whenever the dev .env carried CO_NEWBIZ_LLM_API_KEY and failed the 5s
//    suite timeout). Disabled by default; the nested-shape describe flips it
//    on with a scripted valid reply.
const realLlm = await import("../../app/web-next/lib/llm.ts");
let llmEnabled = false;
let llmReplies: string[] = [];
mock.module("../../app/web-next/lib/llm.ts", () => ({
  ...realLlm,
  isLlmConfigured: () => llmEnabled,
  completeDetailed: async () => {
    const text = llmReplies.shift() ?? "";
    return {
      text,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, model: "mock-model", provider: "mock" },
      finishReason: "stop" as const,
    };
  },
}));

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const emRoute = await import("../../app/web-next/app/api/opportunities/[id]/entry-market-derivation/route.ts");
const draftRoute = await import("../../app/web-next/app/api/opportunities/[id]/entry-market-derivation/draft/route.ts");
const { readSizingLink } = await import("../../app/web-next/app/api/opportunities/[id]/sizing-link/route.ts");
const {
  compareReachedScope,
  computeEntryMarketChain,
  entryMarketNoteFragment,
} = await import("../../app/web-next/lib/entry-market.ts");
const { resolveDerivedEntryMarket } = await import("../../db/repositories/entry-market.repository.ts");
const { autoLinkSizing, refreshAutoSizingLinks, sizingLinkProvenance } = await import(
  "../../app/web-next/lib/sizing-auto-link.ts"
);
const { appendAudit } = await import("../../db/lib/access-control.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");

const NOW = new Date().toISOString();
const ANALYST = "em-analyst";
const VIEWER = "em-viewer";
let cookie = "";
let viewerCookie = "";
const json = JSON.stringify;

const GOOD_STEP = { base: "s1_anchor", factor: 0.5, source: "company disclosure", as_of: "2026-06" };
const PAYLOAD = json({ anchor: { sources: [], total: 800 }, scope: { regions: ["we", "ee"], segments: [], unit_basis: "usd_m_year" } });
const PAYLOAD_V2 = json({ anchor: { sources: [], total: 900 }, scope: { regions: ["we", "ee"], segments: [], unit_basis: "usd_m_year" } });

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function seedSizing(industryId: string, payload: string, versionNo = 1) {
  db.run("INSERT OR IGNORE INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryId, industryId, "t", "Test Industry", NOW]);
  db.run("INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", ["ana-" + industryId, industryId, "completed", ANALYST, NOW]);
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES (?,?,?,?,?,?,?)",
    ["ver-" + industryId + "-" + versionNo, "ana-" + industryId, versionNo, payload, ANALYST, NOW, "C"],
  );
  return { analysisId: "ana-" + industryId, versionId: "ver-" + industryId + "-" + versionNo };
}

function makeOpp(industryId: string | null = null): string {
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, industry_id, market_size_krw_m, growth_rate, capability_gap_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [oppId, "opp", "scope", "identified", ANALYST, NOW, industryId, 80000, 0.06, json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW })],
  );
  // a greenfield S4 route decision so the opportunity is promotable
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "greenfield", "r", "alt", ANALYST, NOW]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, null]);
  return oppId;
}

function auditManualLink(oppId: string) {
  appendAudit(db, { actor: ANALYST, action: "opportunity_sizing_link.write", target: oppId + "#sizing-link@web", now: NOW });
}

const putEm = (id: string, body: unknown, headers: Record<string, string> = { cookie }) =>
  nextRequest("/api/opportunities/" + id + "/entry-market-derivation", { method: "PUT", headers, body: json(body) });
const getEm = (id: string, headers: Record<string, string> = { cookie }) =>
  nextRequest("/api/opportunities/" + id + "/entry-market-derivation", { method: "GET", headers });
const postDraft = (id: string, headers: Record<string, string> = { cookie }) =>
  nextRequest("/api/opportunities/" + id + "/entry-market-derivation/draft", { method: "POST", headers });
const putLink = (id: string, body: unknown, headers: Record<string, string> = { cookie }) =>
  nextRequest("/api/opportunities/" + id + "/sizing-link", { method: "PUT", headers, body: json(body) });

function auditCount(action: string, targetLike: string): number {
  return (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND target LIKE ?").get(action, targetLike) as { n: number }).n;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-entry-market-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-entry-viewer-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-entry-market-1");
  viewerCookie = await login(VIEWER, "pw-entry-viewer-1");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// -- migration 0150 ----------------------------------------------------------------------------
describe("migration 0150 derivation column", () => {
  const DIR = join(PROJECT_ROOT, "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const TARGET = files.find((f) => f.startsWith("0150_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");
  const runSql = (d: Database, sql: string) => {
    for (const s of splitSqlStatements(sql)) d.run(s);
  };
  function through(last: string): Database {
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) {
      if (f > last) break;
      runSql(d, readFileSync(join(DIR, f), "utf-8"));
    }
    return d;
  }

  test("additive nullable json column on top of 0149; NULL default; reversible", () => {
    expect(SQL).toContain("@reversible: true");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    const d = through("0149_zzz");
    const colsBefore = (d.query("PRAGMA table_info(opportunity)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(colsBefore).not.toContain("entry_market_derivation_json");
    d.transaction(() => runSql(d, SQL))();
    const info = d.query("PRAGMA table_info(opportunity)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
    const c = info.find((x) => x.name === "entry_market_derivation_json")!;
    expect(c.dflt_value).toBeNull();
    expect(c.notnull).toBe(0);
    d.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o1','opp','u',?)", [NOW]);
    const row = d.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = 'o1'").get() as { der: string | null };
    expect(row.der).toBeNull();
  });

  test("CHECK constraint rejects non-JSON payloads", () => {
    const d = through("0149_zzz");
    d.transaction(() => runSql(d, SQL))();
    d.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o2','opp','u',?)", [NOW]);
    expect(() => d.run("UPDATE opportunity SET entry_market_derivation_json = 'not json' WHERE id = 'o2'")).toThrow();
    d.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = 'o2'", [json({ steps: [GOOD_STEP], set_by: "u", set_at: NOW })]);
    const row = d.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = 'o2'").get() as { der: string };
    expect(row.der).toContain("steps");
  });
});

// -- route matrix -------------------------------------------------------------------------------
describe("entry-market-derivation route", () => {
  test("agents (delegated principal) are 403 human_only; route registered human-only", async () => {
    const opp = makeOpp();
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    const res = await runAsPrincipal(principal, () =>
      emRoute.PUT(new Request("http://x/t", { method: "PUT", body: json({ steps: [GOOD_STEP] }) }), { params: Promise.resolve({ id: opp }) }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "human_only" } });
    expect(isHumanOnly("PUT", "/api/opportunities/" + opp + "/entry-market-derivation", { steps: [GOOD_STEP] })).toBe(true);
    expect(isHumanOnly("GET", "/api/opportunities/" + opp + "/entry-market-derivation", null)).toBe(false);
    const row = db.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = ?").get(opp) as { der: string | null };
    expect(row.der).toBeNull();
  });

  test("viewer PUT is 403; unknown opportunity 404", async () => {
    const opp = makeOpp();
    expect((await putEm(opp, { steps: [GOOD_STEP] }, { cookie: viewerCookie })).status).toBe(403);
    expect((await putEm("01NOPE00000000000000000000", { steps: [GOOD_STEP] })).status).toBe(404);
    expect((await getEm("01NOPE00000000000000000000")).status).toBe(404);
  });

  test("PUT/GET without an S1 link is 409 not_linked", async () => {
    const opp = makeOpp();
    const put = await putEm(opp, { steps: [GOOD_STEP] });
    expect(put.status).toBe(409);
    expect(await put.json()).toMatchObject({ error: { code: "not_linked" } });
    const get = await getEm(opp);
    expect(get.status).toBe(409);
    expect(await get.json()).toMatchObject({ error: { code: "not_linked" } });
  });

  test("analyst PUT stores the chain, audits; GET returns chain + computed + provenance fields", async () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-em-a", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    const res = await putEm(opp, { steps: [GOOD_STEP, { ...GOOD_STEP, base: "step:0", factor: 0.8, source: "expert interview" }] });
    expect(res.status).toBe(200);
    const stored = await res.json();
    expect(stored.data.computed).toMatchObject({ anchor_value_krw_m: 800, factor_product: 0.4, entry_market_krw_m: 320 });
    expect(stored.data.derivation.set_by).toBe(ANALYST);
    expect(auditCount("opportunity_entry_market.write", opp + "#entry-market@%")).toBe(1);
    const body = await getEm(opp).then((r) => r.json());
    expect(body.data.derivation.steps).toHaveLength(2);
    expect(body.data.computed).toMatchObject({ anchor_value_krw_m: 800, entry_market_krw_m: 320 });
    expect(body.data.link_provenance).toBe("manual");
    expect(body.data.max_steps).toBe(6);
    expect(body.data.confidence.lowering_count).toBe(2);
    expect(typeof body.data.region_caveat).toBe("string");
  });

  test("strict validation matrix: every invalid shape is 400 and nothing is stored", async () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-em-b", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    const cases: Array<[string, unknown]> = [
      ["factor zero", { steps: [{ ...GOOD_STEP, factor: 0 }] }],
      ["factor negative", { steps: [{ ...GOOD_STEP, factor: -0.5 }] }],
      ["factor above one", { steps: [{ ...GOOD_STEP, factor: 1.5 }] }],
      ["factor non-numeric", { steps: [{ ...GOOD_STEP, factor: "0.5" }] }],
      ["missing source", { steps: [{ base: "s1_anchor", factor: 0.5, as_of: "2026" }] }],
      ["empty source", { steps: [{ ...GOOD_STEP, source: "   " }] }],
      ["missing as_of", { steps: [{ base: "s1_anchor", factor: 0.5, source: "s" }] }],
      ["broken base chain", { steps: [GOOD_STEP, { ...GOOD_STEP, base: "s1_anchor" }] }],
      ["too many steps", { steps: Array.from({ length: 7 }, (_, i) => (i === 0 ? GOOD_STEP : { ...GOOD_STEP, base: "step:" + (i - 1) })) }],
      ["empty steps", { steps: [] }],
      ["absolute amount key", { steps: [{ ...GOOD_STEP, amount_krw_m: 100 }] }],
      ["unknown key", { steps: [{ ...GOOD_STEP, weight: 3 }] }],
      ["bad origin", { steps: [{ ...GOOD_STEP, origin: "auto" }] }],
      ["tag array not strings", { steps: [{ ...GOOD_STEP, region_tags: [1, 2] }] }],
      ["steps not array", { steps: "x" }],
      ["body not object", "nonsense"],
    ];
    for (const [label, body] of cases) {
      const res = await putEm(opp, body);
      expect(res.status, label).toBe(400);
      expect(await res.json(), label).toMatchObject({ error: { code: "invalid_request" } });
    }
    const row = db.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = ?").get(opp) as { der: string | null };
    expect(row.der).toBeNull();
  });

  test("clear via steps:null removes the chain atomically and audits", async () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-em-c", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    await putEm(opp, { steps: [GOOD_STEP] });
    const res = await putEm(opp, { steps: null });
    expect(res.status).toBe(200);
    const row = db.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = ?").get(opp) as { der: string | null };
    expect(row.der).toBeNull();
    expect(auditCount("opportunity_entry_market.write", opp + "#entry-market@%")).toBe(2);
  });

  test("linked but anchor-less version: PUT is 400 (computed-never-stored contract)", async () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-em-d", json({ anchor: { sources: [] }, scope: null }));
    await putLink(opp, { version_id: versionId });
    const res = await putEm(opp, { steps: [GOOD_STEP] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });
});

// -- computed math ------------------------------------------------------------------------------
describe("computed math", () => {
  test("anchor x ordered factors with per-step inputs/results", () => {
    const c = computeEntryMarketChain(1000, [
      { base: "s1_anchor", factor: 0.5, source: "a", as_of: "2026" },
      { base: "step:0", factor: 0.4, source: "b", as_of: "2026" },
    ]);
    expect(c.anchor_value_krw_m).toBe(1000);
    expect(c.factor_product).toBeCloseTo(0.2, 12);
    expect(c.entry_market_krw_m).toBeCloseTo(200, 12);
    expect(c.steps[0]).toMatchObject({ input: 1000, result: 500 });
    expect(c.steps[1]).toMatchObject({ input: 500, result: 200 });
  });

  test("resolveDerivedEntryMarket: null when unlinked or chain-absent; derived value when both exist", () => {
    const opp = makeOpp();
    expect(resolveDerivedEntryMarket(db, opp)).toBeNull();
    const { versionId } = seedSizing("ind-math-a", PAYLOAD);
    db.run("UPDATE opportunity SET sizing_version_id = ? WHERE id = ?", [versionId, opp]);
    expect(resolveDerivedEntryMarket(db, opp)).toBeNull();
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?",
      [json({ steps: [GOOD_STEP, { ...GOOD_STEP, base: "step:0", factor: 0.8, source: "b" }], set_by: ANALYST, set_at: NOW }), opp]);
    const derived = resolveDerivedEntryMarket(db, opp)!;
    expect(derived.entry_market_krw_m).toBeCloseTo(320, 12);
    expect(derived.steps).toBe(2);
    expect(typeof derived.hash).toBe("string");
    expect(derived.factor_product).toBeCloseTo(0.4, 12);
  });

  test("unparsable stored derivation degrades to null (never blocks)", () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-math-b", PAYLOAD);
    db.run("UPDATE opportunity SET sizing_version_id = ? WHERE id = ?", [versionId, opp]);
    // the 0150 CHECK keeps raw non-JSON out of the column at the storage layer
    expect(() => db.run("UPDATE opportunity SET entry_market_derivation_json = '{bad json' WHERE id = ?", [opp])).toThrow();
    expect(resolveDerivedEntryMarket(db, opp)).toBeNull();
  });

  test("valid JSON but an invalid chain degrades to null too (strict parse, tolerant consume)", () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-math-b2", PAYLOAD);
    db.run("UPDATE opportunity SET sizing_version_id = ? WHERE id = ?", [versionId, opp]);
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?", [json({ steps: [] }), opp]);
    expect(resolveDerivedEntryMarket(db, opp)).toBeNull();
  });
});

// -- scope grading ------------------------------------------------------------------------------
describe("reached-scope grading", () => {
  const target = (regions: string[]) => ({ regions: regions as never, segments: [], unit_basis: "krw_m_year" as const, set_by: "u", set_at: NOW });
  test("exact / partial / none / unknown on regions only (OPEN-1 advisory)", () => {
    expect(compareReachedScope({ regions: ["we", "ee"] }, target(["we"])).status).toBe("exact");
    expect(compareReachedScope({ regions: ["we"] }, target(["we", "ee"])).status).toBe("partial");
    expect(compareReachedScope({ regions: ["na"] }, target(["we", "ee"])).status).toBe("none");
    expect(compareReachedScope(null, target(["we"])).status).toBe("unknown");
    expect(compareReachedScope({ regions: ["we"] }, null).status).toBe("unknown");
  });
});

// -- generator consumption ----------------------------------------------------------------------
describe("generator consumption", () => {
  function promote(oppId: string): string {
    return promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
  }

  test("unlinked / chain-absent inputs are bit-identical to the legacy path", () => {
    const opp = makeOpp();
    const pid = promote(opp);
    const a = gen.caseInputsBaseForProject(pid);
    expect(a.entryMarket).toBeNull();
    expect(a.marketSizeKrwM).toBe(80000);
    const b = gen.caseInputsBaseForProject(pid);
    const { entryMarket: _e, ...rest } = a as Record<string, unknown>;
    const { entryMarket: _f, ...rest2 } = b as Record<string, unknown>;
    expect(rest2).toEqual(rest);
  });

  test("linked + chained: the DERIVED value replaces the market anchor; a USD-declared anchor converts at the reference rate (ADR-0180 slice 7)", () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-gen-a", PAYLOAD);
    db.run("UPDATE opportunity SET sizing_version_id = ? WHERE id = ?", [versionId, opp]);
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?",
      [json({ steps: [GOOD_STEP], set_by: ANALYST, set_at: NOW }), opp]);
    const pid = promote(opp);
    const inputs = gen.caseInputsBaseForProject(pid);
    // PAYLOAD declares unit_basis usd_m_year: derived 400 (USD-M) x the
    // labelled default 1400 원/USD — the pre-ADR-0180 behavior consumed the
    // USD figure as KRW-M (a ~1,400x understatement).
    expect(inputs.entryMarket).toMatchObject({ entry_market_krw_m: 400, steps: 1 });
    expect(inputs.entryMarketFx).toEqual({ rate: 1400, source: "default", currency: "USD", scale: 1 });
    expect(inputs.marketSizeKrwM).toBeCloseTo(400 * 1400, 6);
  });

  test("note fragment: empty when absent; provenance fragments when derived (byte-exact)", () => {
    expect(entryMarketNoteFragment(null)).toBe("");
    const frag = entryMarketNoteFragment({ steps: 2, hash: "abc123", scope_status: "partial" });
    expect(frag).toBe("; entry_market=derived; entry_market_steps=2; entry_market_hash=abc123; entry_market_scope=partial");
    expect(entryMarketNoteFragment({ steps: 1, hash: "d", scope_status: "unknown" })).toBe("; entry_market=derived; entry_market_steps=1; entry_market_hash=d");
  });
});

// -- AI recommendation draft endpoint -----------------------------------------------------------
describe("AI-recommendation draft endpoint", () => {
  test("analyst POST returns a draft proposal or an honest degradation, and WRITES NOTHING either way", async () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-draft-a", PAYLOAD);
    await putLink(opp, { version_id: versionId });
    const res = await postDraft(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["llm", "unavailable"]).toContain(body.data.source);
    expect(typeof body.data.note).toBe("string");
    expect(typeof body.data.region_caveat).toBe("string");
    if (body.data.draft === null) {
      expect(body.data.source).toBe("unavailable");
    } else {
      // provenance: every AI step carries the display-only marker
      expect(body.data.draft.steps.length).toBeGreaterThan(0);
      for (const s of body.data.draft.steps) expect(s.origin).toBe("ai_suggested");
      expect(body.data.draft.computed.entry_market_krw_m).toBeGreaterThan(0);
    }
    // nothing written: the store and the audit trail are untouched by the draft
    const row = db.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = ?").get(opp) as { der: string | null };
    expect(row.der).toBeNull();
    expect(auditCount("opportunity_entry_market.write", opp + "#entry-market@%")).toBe(0);
    // the save path stays the audited person PUT
    const save = await putEm(opp, { steps: [GOOD_STEP] });
    expect(save.status).toBe(200);
    expect(auditCount("opportunity_entry_market.write", opp + "#entry-market@%")).toBe(1);
  });

  test("POST without a link: 409 not_linked; nothing written", async () => {
    const opp = makeOpp();
    const res = await postDraft(opp);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "not_linked" } });
  });

  test("viewer POST is 403 (analyst+ only); unknown opportunity 404", async () => {
    const opp = makeOpp();
    expect((await postDraft(opp, { cookie: viewerCookie })).status).toBe(403);
    expect((await postDraft("01NOPE00000000000000000000")).status).toBe(404);
  });

  test("model output is validated with the SAME strict rules as PUT (invalid rejected, never coerced)", () => {
    // The draft endpoint reuses normalizeEntryMarketDerivationInput on the
    // parsed model reply, so the same invalid outputs a model might produce
    // fail identically - verified here at the validation seam.
    const { normalizeEntryMarketDerivationInput, EntryMarketValidationError } = require("../../app/web-next/lib/entry-market.ts");
    const bad: Array<[string, unknown]> = [
      ["absolute amount", { steps: [{ base: "s1_anchor", factor: 0.5, source: "s", as_of: "x", amount_krw_m: 100 }] }],
      ["factor out of range", { steps: [{ base: "s1_anchor", factor: 2, source: "s", as_of: "x" }] }],
      ["missing source", { steps: [{ base: "s1_anchor", factor: 0.5, as_of: "x" }] }],
    ];
    for (const [label, body] of bad) {
      expect(() => normalizeEntryMarketDerivationInput(body), label).toThrow(EntryMarketValidationError);
    }
    const good = normalizeEntryMarketDerivationInput({ steps: [GOOD_STEP] });
    expect(good.steps[0].factor).toBe(0.5);
  });
});

// -- auto-link ----------------------------------------------------------------------------------
describe("sizing auto-link", () => {
  test("auto-link at creation: unlinked opportunity of an industry with a completed analysis gets the latest completed version, audited, provenance auto", () => {
    const { versionId } = seedSizing("ind-auto-a", PAYLOAD);
    const opp = makeOpp("ind-auto-a");
    const r = autoLinkSizing(db, opp, ANALYST, NOW);
    expect(r.reason).toBe("linked");
    const row = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opp) as { v: string | null };
    expect(row.v).toBe(versionId);
    expect(auditCount("opportunity_sizing_link.auto", opp + "#sizing-link@auto")).toBe(1);
    expect(sizingLinkProvenance(db, opp)).toBe("auto");
  });

  test("newer completed version completes: still-auto links move forward; frozen manual links do not", () => {
    seedSizing("ind-auto-b", PAYLOAD, 1);
    const auto = makeOpp("ind-auto-b");
    expect(autoLinkSizing(db, auto, ANALYST, NOW).reason).toBe("linked");
    // second opportunity pinned manually at v1
    const manual = makeOpp("ind-auto-b");
    db.run("UPDATE opportunity SET sizing_version_id = ? WHERE id = ?", ["ver-ind-auto-b-1", manual]);
    auditManualLink(manual);
    const { versionId: v2 } = seedSizing("ind-auto-b", PAYLOAD_V2, 2);
    const moved = refreshAutoSizingLinks(db, "ind-auto-b", "market-sizing-pipeline", NOW);
    expect(moved).toBe(1);
    const a = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(auto) as { v: string };
    expect(a.v).toBe(v2);
    const m = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(manual) as { v: string };
    expect(m.v).toBe("ver-ind-auto-b-1");
    expect(sizingLinkProvenance(db, auto)).toBe("auto");
    expect(sizingLinkProvenance(db, manual)).toBe("manual");
  });

  test("manual clear persists: a cleared opportunity is frozen and never re-linked", () => {
    seedSizing("ind-auto-c", PAYLOAD, 1);
    const opp = makeOpp("ind-auto-c");
    autoLinkSizing(db, opp, ANALYST, NOW);
    db.run("UPDATE opportunity SET sizing_analysis_id = NULL, sizing_version_id = NULL WHERE id = ?", [opp]);
    auditManualLink(opp);
    expect(autoLinkSizing(db, opp, ANALYST, NOW).reason).toBe("frozen_manual");
    expect(refreshAutoSizingLinks(db, "ind-auto-c", "market-sizing-pipeline", NOW)).toBe(0);
    const row = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opp) as { v: string | null };
    expect(row.v).toBeNull();
  });

  test("no industry / no completed analysis: no link, nothing fabricated", () => {
    const noIndustry = makeOpp(null);
    expect(autoLinkSizing(db, noIndustry, ANALYST, NOW).reason).toBe("no_industry");
    const row1 = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(noIndustry) as { v: string | null };
    expect(row1.v).toBeNull();
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", ["ind-auto-d", "ind-auto-d", "t", "T", NOW]);
    const noAnalysis = makeOpp("ind-auto-d");
    expect(autoLinkSizing(db, noAnalysis, ANALYST, NOW).reason).toBe("no_completed_analysis");
    const row2 = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(noAnalysis) as { v: string | null };
    expect(row2.v).toBeNull();
  });

  test("newer_version_available hint: true on a frozen link behind the latest completed version", async () => {
    seedSizing("ind-auto-e", PAYLOAD, 1);
    const opp = makeOpp("ind-auto-e");
    autoLinkSizing(db, opp, ANALYST, NOW);
    // freeze with a manual pin at v1
    const res = await putLink(opp, { version_id: "ver-ind-auto-e-1" });
    expect(res.status).toBe(200);
    expect(sizingLinkProvenance(db, opp)).toBe("manual");
    seedSizing("ind-auto-e", PAYLOAD_V2, 2);
    const state = readSizingLink(db, opp)!;
    expect(state.newer_version_available).toBe(true);
    // refresh skips the frozen link
    expect(refreshAutoSizingLinks(db, "ind-auto-e", "market-sizing-pipeline", NOW)).toBe(0);
    const st2 = readSizingLink(db, opp)!;
    expect(st2.newer_version_available).toBe(true);
  });

  test("audit provenance: auto vs manual decided by the LAST link audit", () => {
    seedSizing("ind-auto-f", PAYLOAD, 1);
    const opp = makeOpp("ind-auto-f");
    autoLinkSizing(db, opp, ANALYST, NOW);
    expect(sizingLinkProvenance(db, opp)).toBe("auto");
    auditManualLink(opp);
    expect(sizingLinkProvenance(db, opp)).toBe("manual");
  });
});

// -- ADR-0180 slice 1: the REAL pipeline payload shape (nested matrix.*) --------
// The sizing pipeline writes {methodology, matrix: {anchor, regions, …},
// stepSummaries} — every ADR-0179 reader that looked at the top-level shape
// returned null on live data, making the whole flow inert. These tests pin
// the shape-compatible behavior end to end.
describe("nested pipeline payload shape (ADR-0180 slice 1)", () => {
  const NESTED_PAYLOAD = json({
    methodology: "systematic-market-sizing v1.2.0",
    matrix: {
      industryLabel: "t",
      anchor: { sources: [{ label: "source-a", estimate: 2400, asOf: "2026-06" }], total: 2400 },
      regions: [
        { code: "china", label: "중국", weight: 30, mix: { demo: 35 } },
        { code: "we", label: "서유럽", weight: 18 },
      ],
      segments: [],
    },
    stepSummaries: [],
  });
  const NESTED_DRAFT_REPLY = json({
    steps: [
      { base: "s1_anchor", factor: 0.18, source: "지역 가중치 18% (서유럽)", as_of: "2026-06", region_tags: ["we"] },
      { base: "step:0", factor: 0.4, source: "대상 세그먼트 비율 추정", as_of: "2026-06", segment_tags: ["seg"] },
    ],
  });

  test("readSizingLink reference reads the anchor value and regions from matrix.*", async () => {
    const { versionId } = seedSizing("ind-nested-a", NESTED_PAYLOAD);
    const opp = makeOpp("ind-nested-a");
    autoLinkSizing(db, opp, ANALYST, NOW);
    const state = readSizingLink(db, opp)!;
    expect(state.link).toEqual({ analysis_id: "ana-ind-nested-a", version_id: versionId });
    expect(state.reference?.anchor_value_krw_m).toBe(2400);
  });

  test("derivation GET computes from the nested anchor; PUT+saving yields a derived value", async () => {
    const { versionId } = seedSizing("ind-nested-b", NESTED_PAYLOAD);
    const opp = makeOpp("ind-nested-b");
    await putLink(opp, { version_id: versionId });
    const g1 = await getEm(opp);
    expect(g1.status).toBe(200);
    const body1 = await g1.json();
    expect(body1.data.reference.anchor_value_krw_m).toBe(2400);
    expect(body1.data.computed).toBeNull(); // no chain yet
    const put = await putEm(opp, { steps: [GOOD_STEP] });
    expect(put.status).toBe(200);
    const body2 = await (await getEm(opp)).json();
    expect(body2.data.computed.entry_market_krw_m).toBe(1200); // 2400 x 0.5
    expect(resolveDerivedEntryMarket(db, opp)?.entry_market_krw_m).toBe(1200);
  });

  test("draft POST reaches the LLM path on a nested payload (no anchor_unavailable) and writes nothing", async () => {
    const { versionId } = seedSizing("ind-nested-c", NESTED_PAYLOAD);
    const opp = makeOpp("ind-nested-c");
    await putLink(opp, { version_id: versionId });
    llmEnabled = true;
    llmReplies = [NESTED_DRAFT_REPLY];
    try {
      const res = await postDraft(opp);
      expect(res.status).toBe(200); // was 409 anchor_unavailable before the shape fix
      const body = await res.json();
      expect(body.data.source).toBe("llm");
      expect(body.data.draft.steps).toHaveLength(2);
      for (const s of body.data.draft.steps) expect(s.origin).toBe("ai_suggested");
      expect(body.data.draft.computed.entry_market_krw_m).toBeCloseTo(2400 * 0.18 * 0.4, 6);
      const row = db.query("SELECT entry_market_derivation_json AS der FROM opportunity WHERE id = ?").get(opp) as { der: string | null };
      expect(row.der).toBeNull();
      expect(auditCount("opportunity_entry_market.write", opp + "#entry-market@%")).toBe(0);
    } finally {
      llmEnabled = false;
      llmReplies = [];
    }
  });
});

// -- ADR-0181 slice 3: multi-currency FX at the S1→S8 seam ----------------------
describe("entry-market fx (ADR-0181 slice 3)", () => {
  function promote(oppId: string): string {
    return promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
  }
  const USD_NESTED = json({
    methodology: "m",
    matrix: {
      anchor: { sources: [], total: 100 },
      regions: [{ code: "we", label: "서유럽", weight: 100 }],
      scope: { regions: ["we"], segments: [], unit_basis: "usd_m_year" },
    },
    stepSummaries: [],
  });
  const usdScope = json({ regions: ["we"], segments: [], unit_basis: "usd_m_year", set_by: ANALYST, set_at: NOW });

  test("USD-declared derived entry market converts at the LABELLED default rate", async () => {
    const opp = makeOpp();
    const { versionId } = seedSizing("ind-fx-a", USD_NESTED);
    db.run("UPDATE opportunity SET sizing_version_id = ?, target_scope_json = ? WHERE id = ?", [versionId, usdScope, opp]);
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?",
      [json({ steps: [GOOD_STEP], set_by: ANALYST, set_at: NOW }), opp]);
    const pid = promote(opp);
    const inputs = gen.caseInputsBaseForProject(pid);
    expect(inputs.entryMarketFx).toEqual({ rate: 1400, source: "default", currency: "USD", scale: 1 });
    expect(inputs.marketSizeKrwM).toBeCloseTo(100 * 0.5 * 1400, 6); // USD 50 x 1400
  });

  test("a person-set per-currency rate on entry_market_fx wins and is labelled person", async () => {
    const opp = makeOpp();
    const { analysisId, versionId } = seedSizing("ind-fx-b", USD_NESTED);
    db.run("UPDATE opportunity SET sizing_analysis_id = ?, sizing_version_id = ?, target_scope_json = ? WHERE id = ?", [analysisId, versionId, usdScope, opp]);
    const pid = promote(opp);
    // ADR-0181: the chain AND the fx ride ONE audited PUT — the steps land in
    // the 0151 tables (a table row with zero steps correctly means "chain
    // cleared" and shadows the frozen JSON fallback).
    const put = await putEm(opp, { steps: [GOOD_STEP], fx: [{ currency: "USD", rate: 1350, volatility: 0.12 }] });
    expect(put.status).toBe(200);
    const inputs = gen.caseInputsBaseForProject(pid);
    expect(inputs.entryMarketFx).toEqual({ rate: 1350, source: "person", currency: "USD", scale: 1 });
    expect(inputs.marketSizeKrwM).toBeCloseTo(100 * 0.5 * 1350, 6);
  });

  test("out-of-bounds fx rates are rejected at the audited PUT; an unset non-USD rate NEVER converts", async () => {
    const opp = makeOpp();
    const { analysisId, versionId } = seedSizing("ind-fx-c2", USD_NESTED);
    db.run("UPDATE opportunity SET sizing_analysis_id = ?, sizing_version_id = ?, target_scope_json = ? WHERE id = ?", [analysisId, versionId, usdScope, opp]);
    const bad = await putEm(opp, { fx: [{ currency: "USD", rate: -5 }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_request" } });
    // EUR anchor with NO person-set rate: no conversion, honest unset marker,
    // the legacy anchor path resumes (never a raw foreign-scale pass-through).
    const EUR_PAYLOAD = json({
      methodology: "m",
      matrix: {
        anchor: { sources: [], total: 100 },
        regions: [{ code: "we", label: "서유럽", weight: 100 }],
        scope: { regions: ["we"], segments: [], unit_basis: "eur_m_year" },
      },
      stepSummaries: [],
    });
    const eurScope = json({ regions: ["we"], segments: [], unit_basis: "eur_m_year", set_by: ANALYST, set_at: NOW });
    const { versionId: eurV } = seedSizing("ind-fx-eur", EUR_PAYLOAD);
    const eurOpp = makeOpp();
    db.run("UPDATE opportunity SET sizing_version_id = ?, target_scope_json = ? WHERE id = ?", [eurV, eurScope, eurOpp]);
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?",
      [json({ steps: [GOOD_STEP], set_by: ANALYST, set_at: NOW }), eurOpp]);
    const eurPid = promote(eurOpp);
    const inputs = gen.caseInputsBaseForProject(eurPid);
    expect(inputs.entryMarketFx).toBeNull();
    expect(inputs.entryMarketFxUnsetCcy).toBe("EUR");
    expect(inputs.marketSizeKrwM).toBe(80000); // legacy anchor, honest fallback
  });

  test("an UNDECLARED anchor unit NEVER converts and marks the run honestly (ADR-0181 amendment)", async () => {
    const opp = makeOpp();
    // the payload declares NO unit_basis — the derived value's unit is unknown
    const UNDECLARED = json({
      methodology: "m",
      matrix: {
        anchor: { sources: [], total: 100 },
        regions: [{ code: "we", label: "서유럽", weight: 100 }],
      },
      stepSummaries: [],
    });
    const { versionId } = seedSizing("ind-fx-und", UNDECLARED);
    db.run("UPDATE opportunity SET sizing_version_id = ? WHERE id = ?", [versionId, opp]);
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?",
      [json({ steps: [GOOD_STEP], set_by: ANALYST, set_at: NOW }), opp]);
    const pid = promote(opp);
    const inputs = gen.caseInputsBaseForProject(pid);
    expect(inputs.entryMarketFx).toBeNull();
    expect(inputs.entryMarketUnitUndeclared).toBe(true);
    expect(inputs.marketSizeKrwM).toBe(80000); // legacy anchor — never a raw unknown-scale pass-through
  });

  test("krw-denominated derived entry market is NEVER converted (entryMarketFx null)", () => {
    const opp = makeOpp();
    const krwPayload = json({
      methodology: "m",
      matrix: {
        anchor: { sources: [], total: 800 },
        regions: [{ code: "kr", label: "한국", weight: 100 }],
        scope: { regions: ["kr"], segments: [], unit_basis: "krw_m_year" },
      },
      stepSummaries: [],
    });
    const { versionId } = seedSizing("ind-fx-d", krwPayload);
    db.run("UPDATE opportunity SET sizing_version_id = ? WHERE id = ?", [versionId, opp]);
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?",
      [json({ steps: [GOOD_STEP], set_by: ANALYST, set_at: NOW }), opp]);
    const pid = promote(opp);
    const inputs = gen.caseInputsBaseForProject(pid);
    expect(inputs.entryMarketFx).toBeNull();
    expect(inputs.entryMarketFxUnsetCcy).toBeNull();
    expect(inputs.marketSizeKrwM).toBeCloseTo(400, 12); // 800 x 0.5, no conversion
  });
});
