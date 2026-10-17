// @version 1.0.0
/**
 * ADR-0179 amendment slice A (2026-10-17) - the opportunity -> S1
 * market-sizing link. Migration 0149 SQL on :memory: through 0148, the
 * sizing-link route (PUT human-only: agents 403, viewer 403, analyst+ OK +
 * audit; invalid 400; clear), the additive linked_sizing reference fields on
 * the target-scope GET, and the compatibility flag transitions
 * unknown -> ok / mismatch via the link, bit-identical when unlinked.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-sizing-link.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const linkRoute = await import("../../app/web-next/app/api/opportunities/[id]/sizing-link/route.ts");
const scopeRoute = await import("../../app/web-next/app/api/opportunities/[id]/target-scope/route.ts");
const { readSizingLink } = await import("../../app/web-next/app/api/opportunities/[id]/sizing-link/route.ts");
const { resolveAnchorScopeFlag } = await import("../../app/web-next/lib/anchor-scope.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");

const NOW = new Date().toISOString();
const ANALYST = "sizing-link-analyst";
const VIEWER = "sizing-link-viewer";
let cookie = "";
let viewerCookie = "";
const json = JSON.stringify;

const LABEL_OK = "ok";
const SCOPED_PAYLOAD = json({
  anchor: { sources: [], total: 123456 },
  scope: { regions: ["we", "ee"], segments: ["Stage V"], unit_basis: "usd_m_year" },
});
const WW_PAYLOAD = json({
  anchor: { sources: [], total: 999999 },
  scope: { regions: ["worldwide"], segments: [], unit_basis: "krw_m_year" },
});

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function seedSizing(industryId: string, payload: string) {
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryId, industryId, "t", "Test Industry", NOW]);
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [`ana-${industryId}`, industryId, "completed", ANALYST, NOW]);
  db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES (?,?,?,?,?,?,?)",
    [`ver-${industryId}`, `ana-${industryId}`, 1, payload, ANALYST, NOW, "C"]);
  return { analysisId: `ana-${industryId}`, versionId: `ver-${industryId}` };
}

function makeOpp(track: "greenfield" | "brownfield"): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, track, "r", "alt", ANALYST, NOW]);
  for (const gate of track === "greenfield" ? ["screening", "pre_fs"] : ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  if (track === "greenfield") {
    db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, null]);
  } else {
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "T", "shortlisted", 1, NOW, NOW]);
  }
  return oppId;
}
const promote = (oppId: string): string => promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
const putScope = (id: string, body: unknown) =>
  nextRequest(`/api/opportunities/${id}/target-scope`, { method: "PUT", headers: { cookie }, body: json(body) });
const putLink = (id: string, body: unknown, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${id}/sizing-link`, { method: "PUT", headers, body: json(body) });
const getLink = (id: string, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${id}/sizing-link`, { method: "GET", headers });
const getScope = (id: string, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${id}/target-scope`, { method: "GET", headers });

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-sizing-link-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-sizing-viewer-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-sizing-link-12");
  viewerCookie = await login(VIEWER, "pw-sizing-viewer-1");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// -- migration 0149 ------------------------------------------------------------------------------
describe("migration 0149 sizing link columns", () => {
  const DIR = join(PROJECT_ROOT, "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const TARGET = files.find((f) => f.startsWith("0149_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");
  const runSql = (d: Database, sql: string) => { for (const s of splitSqlStatements(sql)) d.run(s); };
  function through(last: string): Database {
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) { if (f > last) break; runSql(d, readFileSync(join(DIR, f), "utf-8")); }
    return d;
  }

  test("additive nullable FK columns on top of 0148; NULL default; no backfill", () => {
    expect(SQL).toContain("@reversible: true");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    const d = through("0148_zzz");
    const colsBefore = (d.query("PRAGMA table_info(opportunity)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(colsBefore).not.toContain("sizing_analysis_id");
    expect(colsBefore).not.toContain("sizing_version_id");
    d.transaction(() => runSql(d, SQL))();
    const info = d.query("PRAGMA table_info(opportunity)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
    for (const col of ["sizing_analysis_id", "sizing_version_id"]) {
      const c = info.find((x) => x.name === col)!;
      expect(c.dflt_value).toBeNull();
      expect(c.notnull).toBe(0);
    }
    d.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o1','opp','u',?)", [NOW]);
    const row = d.query("SELECT sizing_analysis_id AS a, sizing_version_id AS v FROM opportunity WHERE id = 'o1'").get() as { a: string | null; v: string | null };
    expect(row.a).toBeNull();
    expect(row.v).toBeNull();
  });

  test("FK references enforced", () => {
    const d = through("0148_zzz");
    d.transaction(() => runSql(d, SQL))();
    d.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o2','opp','u',?)", [NOW]);
    expect(() => d.run("UPDATE opportunity SET sizing_version_id = 'nope' WHERE id = 'o2'")).toThrow();
  });
});

// -- the route ------------------------------------------------------------------------------------
describe("sizing-link route", () => {
  test("agents (delegated principal) are 403 human_only and the route is registered human-only", async () => {
    const opp = makeOpp("greenfield");
    const { analysisId, versionId } = seedSizing("ind-link-a", SCOPED_PAYLOAD);
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    const res = await runAsPrincipal(principal, () =>
      linkRoute.PUT(new Request("http://x/t", { method: "PUT", body: json({ version_id: versionId }) }), { params: Promise.resolve({ id: opp }) }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "human_only" } });
    expect(isHumanOnly("PUT", `/api/opportunities/${opp}/sizing-link`, { version_id: versionId })).toBe(true);
    expect(isHumanOnly("GET", `/api/opportunities/${opp}/sizing-link`, null)).toBe(false);
    expect((db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opp) as { v: string | null }).v).toBeNull();
    expect(analysisId).toBeTruthy();
  });

  test("viewer PUT is 403; analyst PUT pins the link, audits; version-only derives the analysis", async () => {
    const opp = makeOpp("greenfield");
    const { versionId } = seedSizing("ind-link-b", SCOPED_PAYLOAD);
    expect((await putLink(opp, { version_id: versionId }, { cookie: viewerCookie })).status).toBe(403);
    const res = await putLink(opp, { version_id: versionId });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { link: { analysis_id: `ana-ind-link-b`, version_id: versionId } } });
    expect((db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'opportunity_sizing_link.write' AND target LIKE ?").get(`${opp}#%`) as { n: number }).n).toBe(1);
    const res2 = await putLink(opp, { analysis_id: "ana-ind-link-b", version_id: versionId });
    expect(res2.status).toBe(200);
  });

  test("invalid links are 400 invalid_request and the columns stay untouched", async () => {
    const opp = makeOpp("greenfield");
    const { versionId } = seedSizing("ind-link-c", SCOPED_PAYLOAD);
    const res = await putLink(opp, { version_id: "01NOVERSION" });
    expect(res.status).toBe(400);
    const res2 = await putLink(opp, { analysis_id: "ana-OTHER", version_id: versionId });
    expect(res2.status).toBe(400);
    const res3 = await putLink(opp, {});
    expect(res3.status).toBe(400);
    const res4 = await putLink(opp, "nonsense");
    expect(res4.status).toBe(400);
    expect((db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opp) as { v: string | null }).v).toBeNull();
  });

  test("clear: both-null PUT resets the link (NULL = unlinked)", async () => {
    const opp = makeOpp("greenfield");
    const { versionId } = seedSizing("ind-link-d", SCOPED_PAYLOAD);
    await putLink(opp, { version_id: versionId });
    const res = await putLink(opp, { analysis_id: null, version_id: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { link: null, reference: null } });
    const row = db.query("SELECT sizing_analysis_id AS a, sizing_version_id AS v FROM opportunity WHERE id = ?").get(opp) as { a: string | null; v: string | null };
    expect(row.a).toBeNull();
    expect(row.v).toBeNull();
  });

  test("unknown opportunity: 404 on GET and PUT", async () => {
    expect((await getLink("01NOPE00000000000000000000")).status).toBe(404);
    expect((await putLink("01NOPE00000000000000000000", { version_id: "x" })).status).toBe(404);
  });
});

// -- reference fields ------------------------------------------------------------------------------
describe("reference display fields", () => {
  test("sizing-link GET returns scope, anchor value, confidence grade and href", async () => {
    const opp = makeOpp("greenfield");
    const { versionId } = seedSizing("ind-ref-a", SCOPED_PAYLOAD);
    await putLink(opp, { version_id: versionId });
    const body = await getLink(opp).then((r) => r.json());
    expect(body).toMatchObject({
      data: {
        link: { analysis_id: "ana-ind-ref-a", version_id: versionId },
        reference: {
          analysis_id: "ana-ind-ref-a",
          version_id: versionId,
          version_no: 1,
          anchor_value_krw_m: 123456,
          confidence_grade: "C",
          href: `/deals/${opp}/s1`,
          scope: { regions: ["we", "ee"], segments: ["Stage V"], unit_basis: "usd_m_year" },
        },
      },
    });
  });

  test("unlinked GET: link null, reference null", async () => {
    const opp = makeOpp("greenfield");
    const body = await getLink(opp).then((r) => r.json());
    expect(body).toMatchObject({ data: { link: null, reference: null } });
  });

  test("target-scope GET carries the additive linked_sizing field", async () => {
    const opp = makeOpp("greenfield");
    const { versionId } = seedSizing("ind-ref-b", SCOPED_PAYLOAD);
    await putLink(opp, { version_id: versionId });
    const body = await getScope(opp).then((r) => r.json());
    expect(body.data.linked_sizing).toMatchObject({ version_id: versionId, anchor_value_krw_m: 123456, confidence_grade: "C" });
    expect(body.data.scope).toBeNull();
  });

  test("unparsable payload: scope null, anchor value null, never a read failure", async () => {
    const opp = makeOpp("greenfield");
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", ["ind-ref-c", "ind-ref-c", "t", "T", NOW]);
    db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", ["ana-ind-ref-c", "ind-ref-c", "completed", ANALYST, NOW]);
    db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
      ["ver-ind-ref-c", "ana-ind-ref-c", 1, "not json at all", ANALYST, NOW]);
    const res = await putLink(opp, { version_id: "ver-ind-ref-c" });
    expect(res.status).toBe(200);
    const body = await getLink(opp).then((r) => r.json());
    expect(body.data.reference.scope).toBeNull();
    expect(body.data.reference.anchor_value_krw_m).toBeNull();
    // tolerant helper too
    expect(readSizingLink(db, opp).reference!.version_no).toBe(1);
  });
});

// -- lazy auto-link on the read path ---------------------------------------------------------------
describe("lazy auto-link on the read path", () => {
  test("pre-existing unlinked opportunity with a completed industry analysis is auto-linked on first GET", async () => {
    // Simulate a PRE-EXISTING opportunity: industry set, no link stored,
    // no audit lineage at all (predates the auto-link feature).
    const opp = makeOpp("greenfield");
    const seed = seedSizing("ind-lazy-a", SCOPED_PAYLOAD);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", ["ind-lazy-a", opp]);
    const body = await getLink(opp).then((r) => r.json());
    expect(body.data.link).toMatchObject({ analysis_id: seed.analysisId, version_id: seed.versionId });
    expect(body.data.reference.version_id).toBe(seed.versionId);
    expect(body.data.link_provenance).toBe("auto");
    expect(
      (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'opportunity_sizing_link.auto' AND target LIKE ?").get(`${opp}%`) as { n: number }).n,
    ).toBe(1);
  });

  test("manual-override frozen opportunity stays unlinked on GET (audit-as-lineage)", async () => {
    const opp = makeOpp("greenfield");
    const seed = seedSizing("ind-lazy-b", SCOPED_PAYLOAD);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", ["ind-lazy-b", opp]);
    // A person manually CLEARS the link: a manual write freezes auto forever.
    await putLink(opp, { analysis_id: null, version_id: null });
    const body = await getLink(opp).then((r) => r.json());
    expect(body.data.link).toBeNull();
    expect(body.data.reference).toBeNull();
    expect(body.data.link_provenance).toBe("manual");
    // and the lazy path never re-links a manually frozen opportunity
    const { lazyAutoLinkOnRead } = await import("../../app/web-next/lib/sizing-auto-link.ts");
    expect(lazyAutoLinkOnRead(db, opp, NOW)).toBeNull();
    // frozen staleness hint surfaces instead
    expect(body.data.newer_version_available).toBe(false);
  });

  test("industry without a completed analysis stays unlinked on GET", async () => {
    const opp = makeOpp("greenfield");
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", ["ind-no-analysis", "ind-no-analysis", "t", "T", NOW]);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", ["ind-no-analysis", opp]);
    const body = await getLink(opp).then((r) => r.json());
    expect(body.data.link).toBeNull();
    expect(body.data.reference).toBeNull();
    expect(body.data.link_provenance).toBe("none");
  });

  test("corrupted state degrades: unknown id returns null; dangling stored link never throws on read", async () => {
    const { lazyAutoLinkOnRead } = await import("../../app/web-next/lib/sizing-auto-link.ts");
    expect(lazyAutoLinkOnRead(db, "01NOPE00000000000000000000", NOW)).toBeNull();
    // dangling stored link (FK-off raw writer simulates pre-FK legacy rows):
    // reference degrades to null, the read succeeds
    const opp = makeOpp("greenfield");
    const raw = new Database(TEST_DB_PATH);
    raw.run("PRAGMA foreign_keys = OFF");
    raw.run("UPDATE opportunity SET sizing_analysis_id = 'ana-GONE', sizing_version_id = 'ver-GONE' WHERE id = ?", [opp]);
    raw.close();
    const body = await getLink(opp).then((r) => r.json());
    expect(body.data.link).toMatchObject({ analysis_id: "ana-GONE", version_id: "ver-GONE" });
    expect(body.data.reference).toBeNull();
  });
});

// -- compatibility flag via the link --------------------------------------------------------------... (truncated)
describe("compatibility flag via the link", () => {
  test("unknown -> ok / mismatch when the link lands; bit-identical inputs when unlinked", async () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    await putScope(opp, { regions: ["we"], segments: [], unit_basis: "krw_m_year" });
    // unlinked: honest unknown
    expect(resolveAnchorScopeFlag(db, pid).status).toBe("unknown");
    const before = gen.caseInputsBaseForProject(pid);
    expect(before.anchorScope).toBeNull();
    // link a scoped version whose regions include the target -> ok
    const good = seedSizing("ind-flag-a", SCOPED_PAYLOAD); // regions we, ee
    await putLink(opp, { version_id: good.versionId });
    expect(resolveAnchorScopeFlag(db, pid).status).toBe("ok");
    // link a worldwide version -> mismatch (coverage is not compatibility)
    const ww = seedSizing("ind-flag-b", WW_PAYLOAD);
    await putLink(opp, { version_id: ww.versionId });
    expect(resolveAnchorScopeFlag(db, pid).status).toBe("mismatch");
    // clearing returns to unknown
    await putLink(opp, { analysis_id: null, version_id: null });
    expect(resolveAnchorScopeFlag(db, pid).status).toBe("unknown");
    // bit-identity: linked/restored inputs equal the unlinked base apart from anchorScope
    const after = gen.caseInputsBaseForProject(pid);
    expect(after.anchorScope).toBeNull();
    const { anchorScope: _a, ...beforeRest } = before as Record<string, unknown>;
    const { anchorScope: _b, ...afterRest } = after as Record<string, unknown>;
    expect(afterRest).toEqual(beforeRest);
  });

  test("unlinked generator inputs keep anchorScope null and stay stable across reads (bit-identity)", () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    const a = gen.caseInputsBaseForProject(pid);
    expect(a.anchorScope).toBeNull();
    expect(gen.caseInputsBaseForProject(pid)).toEqual(a);
  });

  test("note fragment fires anchor_scope=ok only with a linked scoped anchor", async () => {
    const { anchorScopeNoteFragment } = await import("../../app/web-next/lib/anchor-scope.ts");
    const target = { regions: ["we"] as never, segments: [], unit_basis: "krw_m_year" as const, set_by: "u", set_at: NOW };
    expect(anchorScopeNoteFragment(target)).toContain("anchor_scope=unknown");
    expect(anchorScopeNoteFragment(target, { regions: ["we", "ee"] })).toContain("anchor_scope=ok");
  });
});
