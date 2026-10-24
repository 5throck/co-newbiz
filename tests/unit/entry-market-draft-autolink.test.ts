// @version 1.0.0
/**
 * 2026-10-17 decider-feedback draft fix - the AI-draft "not linked" bug.
 *
 * ROOT CAUSE: POST /api/opportunities/:id/entry-market-derivation/draft read
 * the S1 link via its own SQL over opportunity.sizing_version_id, BYPASSING
 * readSizingLink. Two failure shapes both surfaced as the misleading generic
 * 409 not_linked even though the card showed the auto-link chip:
 *   (a) a pre-existing opportunity whose link existed only as a PENDING lazy
 *       auto-link (readSizingLink materializes it on its reads; the draft
 *       route never ran it), and
 *   (b) a stored link whose pinned version payload has no anchor value
 *       (anchor.total missing / unparsable) - a DIFFERENT cause, reported
 *       with the SAME wrong message.
 *
 * Fix: the draft route applies the SAME lazyAutoLinkOnRead on its read
 * (same rules: no manual freeze, industry has a completed analysis) and an
 * anchor-less pinned version is a DISTINCT 409 anchor_unavailable naming the
 * real cause. Covered: lazy-linked -> draft proceeds; stored link with an
 * anchor-less version -> the distinct code and message. Real route handler +
 * scratch SQLite; LLM faked (no live call).
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-entry-market-draft-autolink.sqlite");
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

// Fake the LLM so a proceeding draft exercises the full route with no live call.
const realLlm = { ...await import("../../app/web-next/lib/llm.ts") }; // snapshot BEFORE mock.module mutates the module in place
let replies: string[] = [];
mock.module("../../app/web-next/lib/llm.ts", () => ({
  ...realLlm,
  isLlmConfigured: () => true,
  completeDetailed: async () => {
    const text = replies.shift() ?? "";
    return {
      text,
      usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, model: "mock-model", provider: "mock" },
      finishReason: "stop",
    };
  },
}));

const NOW = new Date().toISOString();
const ANALYST = "draft-auto-analyst";
let cookie = "";
const json = JSON.stringify;
const ANCHOR_PAYLOAD = json({ anchor: { sources: [], total: 800 }, scope: { regions: ["we"], segments: [], unit_basis: "usd_m_year" } });
/** A parseable matrix with NO anchor value - the link is fine, the anchor is not. */
const ANCHORLESS_PAYLOAD = json({ anchor: { sources: [] }, scope: { regions: ["we"], segments: [], unit_basis: "usd_m_year" } });

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

function goodStepsJson(): string {
  return json({
    steps: [
      { base: "s1_anchor", factor: 0.5, source: "region share", as_of: "2026-06", region_tags: ["we"], segment_tags: [] },
      { base: "step:0", factor: 0.4, source: "segment share", as_of: "2026-06", region_tags: [], segment_tags: ["seg"] },
    ],
  });
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-draft-auto-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-draft-auto-1");
});
afterAll(() => {
  // bun's mock.restore() does not undo mock.module() — re-register the real
  // module so the mock does not leak into later files in the same process.
  mock.module("../../app/web-next/lib/llm.ts", () => ({ ...realLlm }));
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("draft route consults the same lazy auto-link as the card", () => {
  test("lazy-linked opportunity: draft proceeds (no 409) and the link materializes", async () => {
    const versionId = seedSizing("ind-draft-auto", ANCHOR_PAYLOAD);
    const opp = makeOpp("ind-draft-auto");
    // precondition: no stored link yet - the card would show the chip only
    // because readSizingLink lazily auto-links on ITS reads.
    const before = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opp) as { v: string | null };
    expect(before.v).toBeNull();
    replies = [goodStepsJson()];
    const res = await postDraft(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.source).toBe("llm");
    expect(body.data.draft).not.toBeNull();
    expect(body.data.draft.computed.anchor_value_krw_m).toBe(800);
    // the lazy auto-link has now materialized on the draft read too
    const after = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opp) as { v: string | null };
    expect(after.v).toBe(versionId);
  });

  test("stored link whose pinned version has NO anchor value: distinct anchor_unavailable, not the generic not_linked", async () => {
    seedSizing("ind-draft-anchorless", ANCHORLESS_PAYLOAD);
    const opp = makeOpp("ind-draft-anchorless");
    db.run("UPDATE opportunity SET sizing_analysis_id = ?, sizing_version_id = ? WHERE id = ?", ["ana-ind-draft-anchorless", "ver-ind-draft-anchorless", opp]);
    const res = await postDraft(opp);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("anchor_unavailable");
    // the message names the real cause (the version carries no anchor
    // value) and is DISTINCT from the generic not-linked phrasing
    const NOT_LINKED_EN = "No linked S1 market-sizing analysis";
    const ANCHOR_EN = "anchor value";
    const msg = String(body.error.message);
    expect(msg).not.toContain(NOT_LINKED_EN);
    expect(msg).toContain(ANCHOR_EN);
  });
});
