// @version 1.0.0
/**
 * ADR-0194 item B (PR-2): the point-in-time data source of kill criterion #5
 * (greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement, re-evaluated at fs).
 * Real scratch SQLite through the full migration chain and the REAL registry: migration 0189 (apply / rollback /
 * re-apply), the site_announcement repository (B-2 future dates, evidence, per-kind live uniqueness C-1, same-kind
 * correction), the dimension-input effective_on rules (B-2), the filler truth table for infra.site_announced_on /
 * infra.plan_finalized_on / infra.plan_finalized_by_announcement (B-1: missing, never 'yes', on every gap; equal dates
 * clean; earliest of several kinds), the registry predicate end to end, the REST route (auth, 404-not-403, attribution,
 * audit) and the MCP tools as REST clients.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-site-announcement.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const repo = await import("../../db/repositories/site-announcement.repository.ts");
const dimRepo = await import("../../db/repositories/dimension-input.repository.ts");
const { fillSnapshot, SNAPSHOT_VAR_KEYS } = await import("../../db/lib/snapshot-filler.ts");
const { evaluateKillCriteria } = await import("../../db/lib/kill-criteria.ts");
const { isIsoCalendarDate, seoulToday } = await import("../../db/lib/iso-date.ts");
const { callTool, REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
const { InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const S = await import("./_gate-integrity-support.ts");

const NOW = "2026-11-07T09:00:00.000Z"; // Asia/Seoul calendar date 2026-11-07
const FILL_NOW = new Date(NOW);
const ANALYST = "sa-analyst";
const REVIEWER = "sa-reviewer";
const OUTSIDER = "sa-outsider";
const VIEWER = "sa-viewer";
const ADMIN = "sa-admin";
const INFRA_PLAN = "infrastructure_plan_not_finalized_at_site_announcement";
const cookies: Record<string, string> = {};

async function login(userId: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: `pw-${userId}-123456` }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  for (const [userId, role] of [[ANALYST, "analyst"], [REVIEWER, "analyst"], [OUTSIDER, "analyst"], [VIEWER, "viewer"], [ADMIN, "admin"]] as const) {
    await createUser(db, { userId, role, password: `pw-${userId}-123456`, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const u of [ANALYST, REVIEWER, OUTSIDER, VIEWER, ADMIN]) cookies[u] = await login(u);
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

/** A greenfield project with ANALYST, REVIEWER and VIEWER as members. */
function newProject(): string {
  const pid = S.insertProject(db, null, "greenfield");
  for (const u of [ANALYST, REVIEWER, VIEWER]) S.addMember(db, pid, u);
  return pid;
}
function newRun(pid: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, pid, `hash-${id.slice(-6)}`, ANALYST, NOW]);
  return id;
}
const record = (pid: string, over: Record<string, unknown> = {}, at = NOW) =>
  repo.recordSiteAnnouncement(db, { projectId: pid, announcedOn: "2026-03-10", announcementKind: "public_announcement", evidenceRef: "doc:announcement-1", recordedBy: ANALYST, now: at, ...over } as never);

/** Raw plan assertion (bypasses the repository so every stored state, including illegal ones, can be tested). */
function plan(pid: string, answer: string, opts: { effectiveOn?: string | null; reviewed?: boolean; observedAt?: string; supersededBy?: string | null; evidenceRef?: string } = {}): string {
  const id = ulid();
  db.run(
    "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, effective_on, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, newRun(pid), pid, "infra.plan_finalized", "text", answer, opts.evidenceRef ?? "doc:plan-1", ANALYST, opts.reviewed === false ? null : REVIEWER, "test", opts.observedAt ?? "2026-11-01T00:00:00Z", opts.effectiveOn ?? null, opts.supersededBy ?? null],
  );
  return id;
}
/** Raw announcement row (for states the repository refuses, such as a future or malformed date). */
function rawAnnouncement(pid: string, announcedOn: string, kind = "public_announcement", supersededBy: string | null = null): string {
  const id = ulid();
  db.run(
    "INSERT INTO site_announcement (id, project_id, announced_on, announcement_kind, evidence_ref, recorded_by, recorded_at, superseded_by) VALUES (?,?,?,?,?,?,?,?)",
    [id, pid, announcedOn, kind, "doc:raw", ANALYST, "2026-11-01T00:00:00Z", supersededBy],
  );
  return id;
}
function fill(pid: string, now = FILL_NOW) {
  const runId = newRun(pid);
  fillSnapshot({ runId, projectId: pid, now }, db);
  const row = (k: string) => db.query("SELECT var_key, value_text, value_num, status, evidence_ref FROM project_variable_snapshot WHERE run_id = ? AND var_key = ?").get(runId, k) as { var_key: string; value_text: string | null; value_num: number | null; status: string; evidence_ref: string | null };
  return { runId, announced: row("infra.site_announced_on"), finalizedOn: row("infra.plan_finalized_on"), derived: row("infra.plan_finalized_by_announcement") };
}

describe("migration 0189", () => {
  const DIR = join(PROJECT_ROOT, "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const TARGET = files.find((f) => f.startsWith("0189_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");
  const run = (d: Database, sql: string) => { for (const s of splitSqlStatements(sql)) d.run(s); };
  const rollbackStatements = (): string[] => {
    const block = SQL.slice(SQL.indexOf("ROLLBACK-SQL-BEGIN"), SQL.indexOf("ROLLBACK-SQL-END"));
    return block.split("\n").slice(1).map((l) => l.replace(/^--\s*/, "").trim()).filter(Boolean);
  };
  function dbBefore(): Database {
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) {
      if (f >= TARGET) break;
      run(d, readFileSync(join(DIR, f), "utf-8"));
    }
    return d;
  }
  const tables = (d: Database) => (d.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name).sort();
  const columns = (d: Database, t: string) => (d.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((r) => r.name);

  test("opens with the reversible header, declares ROLLBACK-SQL (snapshot rows, vars, table, column) and is additive (ADR-0014)", () => {
    expect(SQL.startsWith("-- @reversible: true")).toBe(true);
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL).toContain("ROLLBACK-SQL-END");
    const vars = "('infra.site_announced_on', 'infra.plan_finalized_on', 'infra.plan_finalized_by_announcement')";
    expect(rollbackStatements()).toEqual([
      `DELETE FROM project_variable_snapshot WHERE var_key IN ${vars};`,
      `DELETE FROM evidence_var WHERE var_key IN ${vars};`,
      "DROP TABLE site_announcement;",
      "ALTER TABLE dimension_input DROP COLUMN effective_on;",
    ]);
    const code = SQL.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(code).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE \w+ SET\b/i); // no backfill, nothing removed
    expect(code.match(/\bALTER TABLE\b/gi)).toHaveLength(1); // only the nullable effective_on column
  });

  test("apply, rollback and re-apply on a scratch DB; FK check clean; the rollback needs SQLite 3.35+ (DROP COLUMN)", () => {
    const d = dbBefore();
    const ver = (d.query("select sqlite_version() v").get() as { v: string }).v.split(".").map(Number);
    expect(ver[0] > 3 || (ver[0] === 3 && ver[1] >= 35)).toBe(true);
    const tablesBefore = tables(d);
    const columnsBefore = columns(d, "dimension_input");
    run(d, SQL);
    expect(tables(d).filter((t) => !tablesBefore.includes(t))).toEqual(["site_announcement"]);
    expect(columns(d, "dimension_input").filter((c) => !columnsBefore.includes(c))).toEqual(["effective_on"]);
    // a project snapshot row on one of the new vars must not block the rollback (FK to evidence_var)
    d.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P1','2026-11-07T00:00:00Z')");
    d.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES ('r1','p1','h','u','2026-11-07T00:00:00Z')");
    d.run("INSERT INTO project_variable_snapshot (run_id, project_id, var_key, value_num, value_text, evidence_ref, observed_at, status) VALUES ('r1','p1','infra.site_announced_on',NULL,'2026-03-10',NULL,NULL,'present')");
    for (const stmt of rollbackStatements()) d.run(stmt.replace(/;$/, ""));
    expect(tables(d)).toEqual(tablesBefore);
    expect(columns(d, "dimension_input")).toEqual(columnsBefore);
    expect(d.query("SELECT COUNT(*) AS n FROM evidence_var WHERE var_key LIKE 'infra.%announc%' OR var_key = 'infra.plan_finalized_on' OR var_key = 'infra.plan_finalized_by_announcement'").get()).toEqual({ n: 0 });
    expect(d.query("SELECT COUNT(*) AS n FROM evidence_var WHERE var_key = 'infra.plan_finalized'").get()).toEqual({ n: 1 }); // 0029 row untouched
    run(d, SQL); // re-apply
    expect(tables(d)).toContain("site_announcement");
    expect(columns(d, "dimension_input")).toContain("effective_on");
    expect(d.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("registers the three vars (string, computed/asserted/computed) and the table enforces vocabulary, date shape, evidence and per-kind live uniqueness (C-1)", () => {
    const vars = db.query("SELECT var_key, value_type, source_kind, requires_evidence_ref FROM evidence_var WHERE var_key IN ('infra.site_announced_on','infra.plan_finalized_on','infra.plan_finalized_by_announcement') ORDER BY var_key").all();
    expect(vars).toEqual([
      { var_key: "infra.plan_finalized_by_announcement", value_type: "string", source_kind: "computed", requires_evidence_ref: 0 },
      { var_key: "infra.plan_finalized_on", value_type: "string", source_kind: "asserted", requires_evidence_ref: 0 },
      { var_key: "infra.site_announced_on", value_type: "string", source_kind: "computed", requires_evidence_ref: 0 },
    ]);
    expect(SNAPSHOT_VAR_KEYS).toEqual(expect.arrayContaining(["infra.site_announced_on", "infra.plan_finalized_on", "infra.plan_finalized_by_announcement"]));
    const pid = newProject();
    const ins = (over: Record<string, unknown> = {}) => {
      const r = { id: ulid(), project_id: pid, site_id: null, announced_on: "2026-03-10", announcement_kind: "board_resolution", evidence_ref: "doc:x", recorded_by: ANALYST, recorded_at: NOW, superseded_by: null, ...over };
      db.run("INSERT INTO site_announcement (id, project_id, site_id, announced_on, announcement_kind, evidence_ref, recorded_by, recorded_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?)", Object.values(r) as never);
    };
    expect(() => ins({ announcement_kind: "press_leak" })).toThrow();
    expect(() => ins({ announced_on: "2026/03/10" })).toThrow();
    expect(() => ins({ announced_on: "10-03-2026" })).toThrow();
    expect(() => ins({ evidence_ref: "   " })).toThrow();
    expect(() => ins({ project_id: "no-such-project" })).toThrow();
    ins(); // board_resolution live
    expect(() => ins()).toThrow(); // a second LIVE row of the same kind
    ins({ announcement_kind: "public_announcement" }); // a different kind coexists (C-1)
    ins({ superseded_by: db.query("SELECT id FROM site_announcement WHERE project_id = ? LIMIT 1").get(pid)!.id as string }); // superseded rows of a kind are unlimited
  });
});

describe("iso-date helpers", () => {
  test("real calendar dates only; Asia/Seoul calendar date", () => {
    expect(isIsoCalendarDate("2026-03-10")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-3-10", "20260310", "2026-03-10T00:00:00Z", "", null, 20260310]) expect(isIsoCalendarDate(bad)).toBe(false);
    expect(isIsoCalendarDate("2024-02-29")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(seoulToday("2026-11-07T14:59:59Z")).toBe("2026-11-07");
    expect(seoulToday("2026-11-07T15:00:00Z")).toBe("2026-11-08"); // 00:00 in Seoul
  });
});

describe("site_announcement repository (B-2, C-1)", () => {
  test("records an event with the session user, a resolvable evidence citation and an audit row", () => {
    const pid = newProject();
    const row = record(pid, { announcementKind: "board_resolution", announcedOn: "2026-02-01", evidenceRef: "https://example.com/board-minutes.pdf" });
    expect(row).toMatchObject({ project_id: pid, announced_on: "2026-02-01", announcement_kind: "board_resolution", evidence_ref: "https://example.com/board-minutes.pdf", recorded_by: ANALYST, recorded_at: NOW, superseded_by: null, site_id: null });
    const audit = db.query("SELECT actor_user_id, action, target FROM audit_log WHERE action = 'project.site_announcement.record' AND target LIKE ?").get(`${pid}:%`) as { actor_user_id: string; action: string; target: string };
    expect(audit.actor_user_id).toBe(ANALYST);
    expect(audit.target).toContain(`announced_on=2026-02-01`);
    expect(db.query("SELECT COUNT(*) AS n FROM data_access_log WHERE table_key = 'site_announcement' AND project_id = ?").get(pid)).toEqual({ n: 1 });
  });

  test("rejects an unknown kind, a missing / malformed / impossible date, and a date later than today (B-2)", () => {
    const pid = newProject();
    const bad = (over: Record<string, unknown>) => () => record(pid, over);
    expect(bad({ announcementKind: "press_leak" })).toThrow(/announcement_kind must be one of/);
    expect(bad({ announcementKind: undefined })).toThrow(/announcement_kind/);
    expect(bad({ announcedOn: undefined })).toThrow(/announced_on is required/);
    expect(bad({ announcedOn: "2026-3-1" })).toThrow(/announced_on is required/);
    expect(bad({ announcedOn: "2026-02-30" })).toThrow(/real calendar date/);
    expect(bad({ announcedOn: "2026-11-08" })).toThrow(/later than today/); // tomorrow
    expect(bad({ announcedOn: "2027-01-01" })).toThrow(/later than today/);
    // Seoul-date boundary: 2026-11-08 is today in Seoul from 15:00Z on 2026-11-07
    expect(() => record(pid, { announcedOn: "2026-11-08" }, "2026-11-07T15:00:00.000Z")).not.toThrow();
    expect(() => record(pid, { announcedOn: "2026-11-07", announcementKind: "mou_signing" }, NOW)).not.toThrow(); // today is allowed
    expect(repo.listSiteAnnouncements(db, pid).live.map((r) => r.announcement_kind).sort()).toEqual(["mou_signing", "public_announcement"]);
  });

  test("evidence_ref is mandatory and must be a resolvable citation", () => {
    const pid = newProject();
    for (const ref of [undefined, "", "   ", "see attached memo", "http://insecure.example.com/a", "doc:", 42]) {
      expect(() => record(pid, { evidenceRef: ref })).toThrow(/evidence_ref/);
    }
    expect(() => record(pid, { evidenceRef: "x".repeat(repo.EVIDENCE_REF_MAX + 1) })).toThrow(/at most/);
    for (const ref of ["doc:announcement-1", "src:KIS-2025", "https://example.com/a"]) expect(() => record(pid, { evidenceRef: ref, announcementKind: ref.startsWith("doc") ? "board_resolution" : ref.startsWith("src") ? "mou_signing" : "regulatory_filing" })).not.toThrow();
    expect(repo.listSiteAnnouncements(db, pid).live).toHaveLength(3);
  });

  test("one live row per kind; re-recording a kind is an audited correction of THAT kind only (C-1); a different kind never supersedes", () => {
    const pid = newProject();
    const board = record(pid, { announcementKind: "board_resolution", announcedOn: "2026-01-15", evidenceRef: "doc:board" });
    const pub = record(pid, { announcementKind: "public_announcement", announcedOn: "2026-03-10" });
    let list = repo.listSiteAnnouncements(db, pid);
    expect(list.live.map((r) => r.id).sort()).toEqual([board.id, pub.id].sort()); // both live
    expect(list.history).toEqual([]);
    expect(list.earliest_announced_on).toBe("2026-01-15"); // the later public announcement did not move the reference date
    // correct the public announcement
    const fixed = record(pid, { announcementKind: "public_announcement", announcedOn: "2026-03-12", evidenceRef: "doc:announcement-2" }, "2026-11-07T10:00:00.000Z");
    list = repo.listSiteAnnouncements(db, pid);
    expect(list.live.map((r) => r.id).sort()).toEqual([board.id, fixed.id].sort());
    expect(list.history.map((r) => [r.id, r.superseded_by])).toEqual([[pub.id, fixed.id]]);
    expect(list.live.find((r) => r.id === board.id)!.superseded_by).toBeNull(); // the board resolution was untouched
    expect(list.live.map((r) => r.announcement_kind)).toEqual(["board_resolution", "public_announcement"]); // canonical order
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'project.site_announcement.correct' AND target LIKE ?").get(`${pid}:%`) as { target: string };
    expect(audit.target).toContain(`supersedes=${pub.id}`);
    expect(audit.target).toContain("2026-03-10 -> 2026-03-12");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("a non-member, a missing project and a foreign site are refused; recorded_by must be given", () => {
    const pid = newProject();
    expect(() => record(pid, { recordedBy: OUTSIDER })).toThrow(/Project not found/);
    expect(() => record("no-such-project")).toThrow(/Project not found/);
    const other = newProject();
    const siteId = ulid();
    db.run("INSERT INTO site (id, project_id, name, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)", [siteId, other, "Other site", ANALYST, NOW, NOW]);
    expect(() => record(pid, { siteId })).toThrow(/site_id must name a site of this project/);
    expect(record(other, { siteId }).site_id).toBe(siteId);
    expect(() => record(pid, { recordedBy: "" })).toThrow(/identity/);
    expect(repo.listSiteAnnouncements(db, pid).live).toEqual([]);
    expect(repo.listSiteAnnouncements(db, pid).earliest_announced_on).toBeNull();
  });

  test("an MNPI project needs the writer on the insider list (FR-SEC-06)", () => {
    const pid = newProject();
    db.run("INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)", [pid, "restricted", 1, "test", NOW]);
    expect(() => record(pid)).toThrow(/Project not found/); // member, but not an insider
    db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [pid, ANALYST, NOW, "test insider"]);
    expect(() => record(pid)).not.toThrow();
  });
});

describe("dimension_input.effective_on (B-2)", () => {
  const assertPlan = (pid: string, value: string, over: Record<string, unknown> = {}) =>
    dimRepo.assert({ project_id: pid, run_id: newRun(pid), var_key: "infra.plan_finalized", value: { kind: "text", value }, evidence_ref: "doc:plan-1", asserted_by: ANALYST, rationale: "plan reviewed", effective_on: "2026-02-20", now: NOW, ...over } as never, db);

  test("'yes' requires effective_on and a resolvable evidence_ref; it is never defaulted from observed_at, now or a gate date", () => {
    const pid = newProject();
    expect(() => assertPlan(pid, "yes", { effective_on: undefined })).toThrow(/requires effective_on/);
    expect(() => assertPlan(pid, "yes", { effective_on: null })).toThrow(/requires effective_on/);
    expect(() => assertPlan(pid, "yes", { effective_on: "", observed_at: "2026-02-20T00:00:00Z" })).toThrow(/requires effective_on/); // observed_at is not a source
    expect(() => assertPlan(pid, "yes", { evidence_ref: "" })).toThrow(/requires an evidence_ref/);
    expect(() => assertPlan(pid, "yes", { evidence_ref: "plan memo" })).toThrow(/requires an evidence_ref/);
    expect(db.query("SELECT COUNT(*) AS n FROM dimension_input WHERE project_id = ?").get(pid)).toEqual({ n: 0 });
    const row = assertPlan(pid, "yes", { observed_at: "2026-11-01T00:00:00Z" });
    expect(row.effective_on).toBe("2026-02-20"); // as supplied, not observed_at
    expect(row.observed_at).toBe("2026-11-01T00:00:00Z");
    expect(row.reviewed_by).toBeNull(); // born unreviewed: the reviewed gate is unchanged
    expect(dimRepo.getLiveAssertion(pid, "infra.plan_finalized", db)!.effective_on).toBe("2026-02-20");
  });

  test("rejects a malformed, impossible or future effective_on; today is allowed", () => {
    const pid = newProject();
    for (const d of ["2026-2-20", "20260220", "2026-02-30", "not a date", "2026-11-08", "2027-01-01"]) {
      expect(() => assertPlan(pid, "yes", { effective_on: d })).toThrow(/effective_on/);
    }
    expect(assertPlan(pid, "yes", { effective_on: "2026-11-07" }).effective_on).toBe("2026-11-07");
  });

  test("'no' refuses a finalization date; elsewhere effective_on is optional and validated when given", () => {
    const pid = newProject();
    expect(() => assertPlan(pid, "no", { effective_on: "2026-02-20" })).toThrow(/cannot carry effective_on/);
    expect(assertPlan(pid, "no", { effective_on: undefined, evidence_ref: "" }).effective_on).toBeNull();
    const row = dimRepo.assert({ project_id: pid, run_id: newRun(pid), var_key: "market.entry_barrier", value: { kind: "text", value: "high" }, evidence_ref: "doc:m", asserted_by: ANALYST, rationale: "r", now: NOW }, db);
    expect(row.effective_on).toBeNull();
    expect(() => dimRepo.assert({ project_id: pid, run_id: newRun(pid), var_key: "market.entry_barrier", value: { kind: "text", value: "low" }, evidence_ref: "doc:m", asserted_by: ANALYST, rationale: "r", effective_on: "2099-01-01", now: NOW }, db)).toThrow(/later than today/);
  });

  test("infra.plan_finalized_on is not asserted directly (one writer: effective_on)", () => {
    const pid = newProject();
    expect(() => dimRepo.assert({ project_id: pid, run_id: newRun(pid), var_key: "infra.plan_finalized_on", value: { kind: "text", value: "2026-02-20" }, evidence_ref: "doc:p", asserted_by: ANALYST, rationale: "r", now: NOW }, db)).toThrow(/not asserted directly/);
  });

  test("re-assertion supersedes, resets review, and the reviewed live row feeds the filler", () => {
    const pid = newProject();
    const first = assertPlan(pid, "yes", { effective_on: "2026-02-20" });
    dimRepo.review({ input_id: first.id, reviewed_by: REVIEWER, now: NOW }, db);
    rawAnnouncement(pid, "2026-03-10");
    expect(fill(pid).derived).toMatchObject({ status: "present", value_text: "yes" });
    const second = assertPlan(pid, "yes", { effective_on: "2026-04-01" }); // supersedes; born unreviewed
    expect(fill(pid).derived.status).toBe("missing"); // unreviewed replacement fills nothing
    dimRepo.review({ input_id: second.id, reviewed_by: REVIEWER, now: NOW }, db);
    expect(fill(pid).derived).toMatchObject({ status: "present", value_text: "no" }); // finalized after the announcement
  });
});

describe("filler truth table (B-1: missing, never 'yes', on every gap; equal dates clean)", () => {
  test("announced + finalized before -> yes (clean); both dates and the derived var carry their evidence", () => {
    const pid = newProject();
    const a = rawAnnouncement(pid, "2026-03-10");
    const p = plan(pid, "yes", { effectiveOn: "2026-02-20" });
    const f = fill(pid);
    expect(f.announced).toMatchObject({ status: "present", value_text: "2026-03-10", evidence_ref: `site_announcement:${a}` });
    expect(f.finalizedOn).toMatchObject({ status: "present", value_text: "2026-02-20", evidence_ref: `dimension_input:${p}` });
    expect(f.derived).toMatchObject({ status: "present", value_text: "yes", evidence_ref: `site_announcement:${a};dimension_input:${p}` });
  });

  test("equal dates are clean (finalized on the announcement day)", () => {
    const pid = newProject();
    rawAnnouncement(pid, "2026-03-10");
    plan(pid, "yes", { effectiveOn: "2026-03-10" });
    expect(fill(pid).derived).toMatchObject({ status: "present", value_text: "yes" });
  });

  test("finalized after the announcement -> no (triggers)", () => {
    const pid = newProject();
    rawAnnouncement(pid, "2026-03-10");
    plan(pid, "yes", { effectiveOn: "2026-03-11" });
    const f = fill(pid);
    expect(f.derived).toMatchObject({ status: "present", value_text: "no" });
    expect(f.finalizedOn.value_text).toBe("2026-03-11");
  });

  test("a reviewed 'no' with an announcement on record -> no (triggers); without an announcement -> missing", () => {
    const pid = newProject();
    plan(pid, "no");
    expect(fill(pid).derived.status).toBe("missing"); // plan not final, but no announcement on record: unassessed
    rawAnnouncement(pid, "2026-03-10");
    const f = fill(pid);
    expect(f.derived).toMatchObject({ status: "present", value_text: "no" });
    expect(f.finalizedOn.status).toBe("missing"); // a 'no' has no finalization date
  });

  test("every unassessed variant leaves the derived var MISSING, never 'yes'", () => {
    const missingDerived = (setup: (pid: string) => void) => {
      const pid = newProject();
      setup(pid);
      const f = fill(pid);
      expect(f.derived.status).toBe("missing");
      expect(f.derived.value_text).toBeNull();
      return f;
    };
    missingDerived(() => {}); // nothing recorded
    missingDerived((pid) => rawAnnouncement(pid, "2026-03-10")); // announcement, no assertion
    missingDerived((pid) => plan(pid, "yes", { effectiveOn: "2026-02-20" })); // assertion, no announcement
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "yes", { effectiveOn: null }); }); // yes without effective_on
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "yes", { effectiveOn: "2026-02-20", reviewed: false }); }); // unreviewed
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "no", { reviewed: false }); }); // unreviewed no
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "maybe", { effectiveOn: "2026-02-20" }); }); // any other answer
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "Yes", { effectiveOn: "2026-02-20" }); }); // only the exact literal counts
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "yes", { effectiveOn: "2026-02-30" }); }); // impossible date
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "yes", { effectiveOn: "2026-2-20" }); }); // malformed date
    missingDerived((pid) => { rawAnnouncement(pid, "2026-03-10"); plan(pid, "yes", { effectiveOn: "2026-11-08" }); }); // future effective_on that slipped in
    missingDerived((pid) => { rawAnnouncement(pid, "2026-11-08"); plan(pid, "yes", { effectiveOn: "2026-02-20" }); }); // future announcement that slipped in
  });

  test("a superseded reviewed assertion is not evidence", () => {
    const pid = newProject();
    rawAnnouncement(pid, "2026-03-10");
    const old = plan(pid, "yes", { effectiveOn: "2026-02-20" });
    const next = plan(pid, "no", { reviewed: false, supersededBy: old });
    db.run("UPDATE dimension_input SET superseded_by = ? WHERE id = ?", [next, old]);
    db.run("UPDATE dimension_input SET superseded_by = NULL WHERE id = ?", [next]);
    expect(fill(pid).derived.status).toBe("missing"); // the live row is the unreviewed replacement
  });

  test("a superseded announcement is ignored: a correction replaces the date; the chain end is the live one", () => {
    const pid = newProject();
    plan(pid, "yes", { effectiveOn: "2026-02-20" });
    record(pid, { announcedOn: "2026-01-01" }); // wrongly early
    record(pid, { announcedOn: "2026-03-10" }, "2026-11-07T10:00:00.000Z"); // corrected, same kind
    const f = fill(pid);
    expect(f.announced.value_text).toBe("2026-03-10");
    expect(f.derived.value_text).toBe("yes");
  });

  test("two live kinds: the EARLIEST date of any kind counts (C-1)", () => {
    const pid = newProject();
    record(pid, { announcementKind: "public_announcement", announcedOn: "2026-03-10" });
    record(pid, { announcementKind: "board_resolution", announcedOn: "2026-01-15", evidenceRef: "doc:board" });
    record(pid, { announcementKind: "mou_signing", announcedOn: "2026-05-01", evidenceRef: "doc:mou" });
    plan(pid, "yes", { effectiveOn: "2026-02-20" }); // after the board resolution, before the public announcement
    const f = fill(pid);
    expect(f.announced.value_text).toBe("2026-01-15");
    expect(f.derived).toMatchObject({ status: "present", value_text: "no" }); // would be 'yes' if the later public announcement were the reference
  });

  test("proxy rejection: observed_at, recorded_at, gate dates and document timestamps never stand in for either date", () => {
    const pid = newProject();
    // an infra assertion with observed_at long before everything, a recorded gate decision and a document row - but no dates
    plan(pid, "yes", { effectiveOn: null, observedAt: "2020-01-01T00:00:00Z" });
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "project", pid, "fs", "go", "seed", ANALYST, "2020-01-02T00:00:00Z"]);
    const f = fill(pid);
    expect(f.announced.status).toBe("missing");
    expect(f.finalizedOn.status).toBe("missing");
    expect(f.derived.status).toBe("missing");
    // the filler reads only site_announcement.announced_on and dimension_input.effective_on for the two dates
    const src = readFileSync(join(PROJECT_ROOT, "db/lib/snapshot-filler.ts"), "utf-8");
    const body = src.slice(src.indexOf("function fillSiteAnnouncementVars"), src.indexOf("/** #14: P3 evaluations exist"));
    expect(body).toContain("announced_on");
    expect(body).toContain("effective_on");
    expect(body).not.toMatch(/decided_at|gate_decision|created_at|\bdocument\b/);
    expect(body).not.toMatch(/plan\.observed_at\s*<=|<=\s*plan\.observed_at|observed_at\s*<=/); // observed_at is only provenance, never compared
  });

  test("a bare project writes all three vars missing; the snapshot still has one row per seeded var", () => {
    const pid = newProject();
    const f = fill(pid);
    expect([f.announced.status, f.finalizedOn.status, f.derived.status]).toEqual(["missing", "missing", "missing"]);
    expect(db.query("SELECT COUNT(*) AS n FROM project_variable_snapshot WHERE run_id = ?").get(f.runId)).toEqual({ n: SNAPSHOT_VAR_KEYS.length });
  });
});

describe("registry predicate #5 end to end (the real greenfield-screening registry)", () => {
  const evalFive = (pid: string) => {
    const r = evaluateKillCriteria(db, { runId: newRun(pid), projectId: pid, procedure: "greenfield-screening", now: NOW });
    return r.outcomes.find((o) => o.criterion_id === INFRA_PLAN)!;
  };
  test("the predicate reads only the derived var; clean = false, finalized after = true (escalate), every gap = unassessed", () => {
    const entry = JSON.parse(readFileSync(join(PROJECT_ROOT, "procedures/_kill-criteria/greenfield-screening__infrastructure_plan_not_finalized_at_site_announcement.json"), "utf-8"));
    expect(entry.predicate).toEqual({ op: "in", var: "infra.plan_finalized_by_announcement", values: ["no"] });
    expect(entry.action).toBe("escalate_to_risk_officer");
    expect(entry.reevaluate_at).toBe("fs");

    const gap = newProject();
    expect(evalFive(gap).outcome).toBe("unassessed");
    rawAnnouncement(gap, "2026-03-10");
    expect(evalFive(gap).outcome).toBe("unassessed"); // announcement only

    const clean = newProject();
    rawAnnouncement(clean, "2026-03-10");
    plan(clean, "yes", { effectiveOn: "2026-03-10" });
    expect(evalFive(clean).outcome).toBe("false"); // equal date: clean, evaluated and not triggered

    const late = newProject();
    rawAnnouncement(late, "2026-03-10");
    plan(late, "yes", { effectiveOn: "2026-03-11" });
    expect(evalFive(late).outcome).toBe("true");

    const notFinal = newProject();
    rawAnnouncement(notFinal, "2026-03-10");
    plan(notFinal, "no");
    expect(evalFive(notFinal).outcome).toBe("true");

    const noDate = newProject();
    rawAnnouncement(noDate, "2026-03-10");
    plan(noDate, "yes", { effectiveOn: null });
    expect(evalFive(noDate).outcome).toBe("unassessed"); // never clean without the date
  });
});

describe("REST /api/projects/{id}/site-announcement", () => {
  const url = (pid: string) => `/api/projects/${pid}/site-announcement`;
  const post = (pid: string, body: unknown, as: string | null = ANALYST) => nextRequest(url(pid), { method: "POST", body: JSON.stringify(body), headers: as ? { cookie: cookies[as] } : {} });
  const get = (pid: string, as: string | null = ANALYST) => nextRequest(url(pid), { headers: as ? { cookie: cookies[as] } : {} });
  const ok = { announced_on: "2026-03-10", announcement_kind: "public_announcement", evidence_ref: "doc:announcement-1" };

  test("unauthenticated 401; admin 403; viewer reads but cannot write; a non-member gets 404 (not 403) on both verbs", async () => {
    const pid = newProject();
    expect((await get(pid, null)).status).toBe(401);
    expect((await post(pid, ok, null)).status).toBe(401);
    expect((await get(pid, ADMIN)).status).toBe(403);
    expect((await post(pid, ok, ADMIN)).status).toBe(403);
    expect((await post(pid, ok, VIEWER)).status).toBe(403);
    expect((await get(pid, VIEWER)).status).toBe(200);
    expect((await get(pid, OUTSIDER)).status).toBe(404);
    expect((await post(pid, ok, OUTSIDER)).status).toBe(404);
    expect((await get("no-such-project")).status).toBe(404);
    expect((await post("no-such-project", ok)).status).toBe(404);
    expect(repo.listSiteAnnouncements(db, pid).live).toEqual([]); // nothing leaked in by the refused writes
  });

  test("POST records as the session user (a spoofed recorded_by is ignored), is audited, and GET returns the live rows, kinds and the reference date", async () => {
    const pid = newProject();
    const res = await post(pid, { ...ok, recorded_by: "attacker", recordedBy: "attacker" });
    expect(res.status).toBe(201);
    const row = ((await res.json()) as { data: any }).data;
    expect(row).toMatchObject({ project_id: pid, announced_on: "2026-03-10", announcement_kind: "public_announcement", recorded_by: ANALYST, superseded_by: null });
    expect(db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'project.site_announcement.record' AND actor_user_id = ? AND target LIKE ?").get(ANALYST, `${pid}:%`)).toEqual({ n: 1 });
    await post(pid, { announced_on: "2026-01-15", announcement_kind: "board_resolution", evidence_ref: "doc:board" });
    const got = ((await (await get(pid)).json()) as { data: any; meta: any }).data;
    expect(got.project_id).toBe(pid);
    expect(got.live.map((r: any) => r.announcement_kind)).toEqual(["board_resolution", "public_announcement"]);
    expect(got.earliest_announced_on).toBe("2026-01-15");
    expect(got.unrecorded_kinds).toEqual(["mou_signing", "regulatory_filing"]);
    expect(got.vocabulary.announcement_kinds).toEqual([...repo.ANNOUNCEMENT_KINDS]);
    expect(got.history).toEqual([]);
  });

  test("re-posting a kind corrects it (history kept); a different kind is separate; the body is validated with 400", async () => {
    const pid = newProject();
    await post(pid, ok);
    expect((await post(pid, { ...ok, announced_on: "2026-03-12", evidence_ref: "doc:announcement-2" })).status).toBe(201);
    const got = ((await (await get(pid)).json()) as { data: any }).data;
    expect(got.live).toHaveLength(1);
    expect(got.live[0].announced_on).toBe("2026-03-12");
    expect(got.history).toHaveLength(1);
    expect(got.history[0].announced_on).toBe("2026-03-10");
    for (const bad of [
      { ...ok, announced_on: "2099-01-01" },
      { ...ok, announced_on: "March 10" },
      { ...ok, announced_on: undefined },
      { ...ok, announcement_kind: "rumor" },
      { ...ok, evidence_ref: undefined },
      { ...ok, evidence_ref: "memo" },
      { ...ok, site_id: "no-such-site" },
    ]) {
      const r = await post(pid, bad);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
    }
    expect((await nextRequest(url(pid), { method: "POST", body: "not json", headers: { cookie: cookies[ANALYST] } })).status).toBe(400);
    expect(repo.listSiteAnnouncements(db, pid).live).toHaveLength(1);
  });
});

describe("MCP tools (ADR-0011: REST client, the calling user's identity; the DB-import scan stays in tests/unit/mcp.test.ts)", () => {
  const port = (userId = ANALYST) => new InProcessRestPort({ userId, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });

  test("record_site_announcement writes through the REST route as the calling user; a spoofed recorded_by is ignored; get_site_announcements reads it back", async () => {
    const pid = newProject();
    const ctx = { port: port(), scopes: ["read", "write", "propose"] };
    const rec = (await callTool("http", ctx, "record_site_announcement", { projectId: pid, body: { announced_on: "2026-03-10", announcement_kind: "mou_signing", evidence_ref: "doc:mou-1", recorded_by: "attacker" } })) as any;
    expect(JSON.stringify(rec)).toContain("mou_signing");
    const back = (await callTool("http", ctx, "get_site_announcements", { projectId: pid })) as any;
    expect(JSON.stringify(back)).toContain("2026-03-10");
    const live = repo.listSiteAnnouncements(db, pid).live;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ announcement_kind: "mou_signing", recorded_by: ANALYST });
  });

  test("a non-member caller is refused by the REST layer (404), and a future date is refused by the route", async () => {
    const pid = newProject();
    const outsider = { port: port(OUTSIDER), scopes: ["read", "write", "propose"] };
    const refused = (await callTool("http", outsider, "record_site_announcement", { projectId: pid, body: { announced_on: "2026-03-10", announcement_kind: "mou_signing", evidence_ref: "doc:mou-1" } }).catch((e: Error) => e)) as any;
    expect(JSON.stringify(refused instanceof Error ? refused.message : refused)).toMatch(/not.?found|404/i);
    const future = (await callTool("http", { port: port(), scopes: ["read", "write"] }, "record_site_announcement", { projectId: pid, body: { announced_on: "2099-01-01", announcement_kind: "mou_signing", evidence_ref: "doc:mou-1" } }).catch((e: Error) => e)) as any;
    expect(JSON.stringify(future instanceof Error ? future.message : future)).toMatch(/later than today|invalid_request/i);
    expect(repo.listSiteAnnouncements(db, pid).live).toEqual([]);
  });

  test("the record tool needs the write scope; it is a record tool (kind write), not a proposal, and its description binds the agent to user-given dates", async () => {
    const tool = REGISTRY.find((t) => t.name === "record_site_announcement")!;
    expect(tool).toMatchObject({ scope: "write", kind: "write" });
    expect(tool.routes).toEqual(["POST /api/projects/{projectId}/site-announcement"]);
    expect(tool.description).toMatch(/explicitly given/i);
    expect(tool.description).toMatch(/never infer/i);
    expect(tool.description).toMatch(/earliest/i);
    expect(REGISTRY.find((t) => t.name === "get_site_announcements")).toMatchObject({ scope: "read", kind: "read" });
    const pid = newProject();
    await expect(callTool("http", { port: port(), scopes: ["read"] }, "record_site_announcement", { projectId: pid, body: { announced_on: "2026-03-10", announcement_kind: "mou_signing", evidence_ref: "doc:m" } })).rejects.toThrow(/write/);
    expect(repo.listSiteAnnouncements(db, pid).live).toEqual([]);
  });
});

describe("REST /api/projects/{id}/dimension-inputs (+ review): the capture path for infra.plan_finalized and effective_on", () => {
  const url = (pid: string) => `/api/projects/${pid}/dimension-inputs`;
  const post = (pid: string, body: unknown, as: string | null = ANALYST) => nextRequest(url(pid), { method: "POST", body: JSON.stringify(body), headers: as ? { cookie: cookies[as] } : {} });
  const get = (pid: string, q = "", as: string | null = ANALYST) => nextRequest(url(pid) + q, { headers: as ? { cookie: cookies[as] } : {} });
  const review = (pid: string, rowId: string, as: string | null = REVIEWER) => nextRequest(`${url(pid)}/${rowId}/review`, { method: "POST", body: "{}", headers: as ? { cookie: cookies[as] } : {} });
  const yes = { var_key: "infra.plan_finalized", value: "yes", evidence_ref: "doc:plan-1", rationale: "plan reviewed", effective_on: "2026-02-20" };
  const withRun = () => { const pid = newProject(); newRun(pid); return pid; };
  const data = async (r: Response) => ((await r.json()) as { data: any }).data;

  test("auth: 401, admin 403, viewer reads but cannot write, a non-member gets 404 on every verb; nothing is written by refused calls", async () => {
    const pid = withRun();
    expect((await get(pid, "", null)).status).toBe(401);
    expect((await post(pid, yes, null)).status).toBe(401);
    expect((await get(pid, "", ADMIN)).status).toBe(403);
    expect((await post(pid, yes, ADMIN)).status).toBe(403);
    expect((await post(pid, yes, VIEWER)).status).toBe(403);
    expect((await get(pid, "", VIEWER)).status).toBe(200);
    expect((await get(pid, "", OUTSIDER)).status).toBe(404);
    expect((await post(pid, yes, OUTSIDER)).status).toBe(404);
    expect((await get("no-such-project")).status).toBe(404);
    expect((await review(pid, "x", OUTSIDER)).status).toBe(404);
    expect(dimRepo.listProjectAssertions(db, pid)).toEqual([]);
  });

  test("POST records an UNREVIEWED assertion as the session user with effective_on; a spoofed asserted_by/reviewed_by is ignored; audited; GET lists it with the vocabulary", async () => {
    const pid = withRun();
    const res = await post(pid, { ...yes, asserted_by: "attacker", reviewed_by: ANALYST });
    expect(res.status).toBe(201);
    const row = await data(res);
    expect(row).toMatchObject({ project_id: pid, var_key: "infra.plan_finalized", value_text: "yes", effective_on: "2026-02-20", asserted_by: ANALYST, reviewed_by: null, superseded_by: null });
    expect(db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dimension_input_asserted' AND actor_user_id = ? AND target = ?").get(ANALYST, `${pid}:infra.plan_finalized`)).toEqual({ n: 1 });
    const got = await data(await get(pid, "?var_key=infra.plan_finalized"));
    expect(got.inputs).toHaveLength(1);
    expect(got.live).toHaveLength(1);
    const vars = got.vocabulary.assertable_vars.map((v: any) => v.var_key);
    expect(vars).toContain("infra.plan_finalized");
    expect(vars).not.toContain("infra.plan_finalized_on");
    expect(vars).not.toContain("project.site_required");
    expect((await data(await get(pid, "?var_key=market.entry_barrier"))).inputs).toEqual([]);
  });

  test("B-2 over REST: yes needs effective_on and a citation, a future/impossible date and a no with a date are refused (400), an unknown var and a wrong value type too; no run is 409", async () => {
    const pid = withRun();
    const bad = async (over: Record<string, unknown>, status = 400) => { const r = await post(pid, { ...yes, ...over }); expect(r.status).toBe(status); return r; };
    await bad({ effective_on: undefined });
    await bad({ effective_on: "2099-01-01" });
    await bad({ effective_on: "2026-02-30" });
    await bad({ evidence_ref: "memo" });
    await bad({ value: "no" }); // no + effective_on
    await bad({ var_key: "infra.plan_finalized_on", value: "2026-02-20" });
    await bad({ var_key: "project.site_required", value: true });
    await bad({ var_key: "no.such.var" });
    await bad({ value: true }); // string var, boolean value
    await bad({ rationale: "" });
    await bad({ effective_on: 20260220 });
    expect((await post(pid, { ...yes, value: "no", effective_on: undefined })).status).toBe(201);
    expect(dimRepo.listProjectAssertions(db, pid)).toHaveLength(1);
    const noRun = newProject();
    const r = await post(noRun, yes);
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).error.code).toBe("no_run");
  });

  test("review: human-only, a different person, live and unreviewed only; the reviewed row becomes evidence for #5", async () => {
    const pid = withRun();
    const rowId = (await data(await post(pid, yes))).id as string;
    rawAnnouncement(pid, "2026-03-10");
    expect(fill(pid).derived.status).toBe("missing"); // unreviewed: not evidence
    const self = await review(pid, rowId, ANALYST);
    expect(self.status).toBe(409);
    expect(((await self.json()) as any).error.code).toBe("second_person_required");
    expect((await review(pid, rowId, VIEWER)).status).toBe(403);
    expect((await review(pid, rowId, ADMIN)).status).toBe(404); // admin is blocked from deals
    expect((await review(pid, "no-such-row")).status).toBe(404);
    const other = withRun();
    expect((await review(other, rowId)).status).toBe(404); // a row of another project
    // a bearer (agent-delegated) caller is refused
    const port = new InProcessRestPort({ userId: REVIEWER, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    const viaMcp = await port.post(`${url(pid)}/${rowId}/review`, {});
    expect(viaMcp.error?.code).toBe("human_only");
    expect(dimRepo.getLiveAssertion(pid, "infra.plan_finalized", db)!.reviewed_by).toBeNull();
    const done = await review(pid, rowId);
    expect(done.status).toBe(200);
    expect((await data(done)).reviewed_by).toBe(REVIEWER);
    expect(db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dimension_input_reviewed' AND actor_user_id = ?").get(REVIEWER)).toMatchObject({ n: expect.any(Number) });
    expect(fill(pid).derived).toMatchObject({ status: "present", value_text: "yes" });
    const again = await review(pid, rowId);
    expect(again.status).toBe(409);
    expect(((await again.json()) as any).error.code).toBe("review_rejected");
  });

  test("a re-assertion supersedes the live row and resets review (history kept)", async () => {
    const pid = withRun();
    const first = (await data(await post(pid, yes))).id as string;
    await review(pid, first);
    const second = (await data(await post(pid, { ...yes, effective_on: "2026-04-01" }))).id as string;
    const got = await data(await get(pid));
    expect(got.live.map((r: any) => r.id)).toEqual([second]);
    expect(got.live[0].reviewed_by).toBeNull();
    expect(got.inputs).toHaveLength(2);
    const stale = await review(pid, first);
    expect(stale.status).toBe(409); // the superseded row cannot be reviewed
  });

  test("MCP: record_dimension_input / get_dimension_inputs are REST clients as the calling user; there is no review tool and the review route is human-only", async () => {
    const pid = withRun();
    const port = new InProcessRestPort({ userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    const ctx = { port, scopes: ["read", "write", "propose"] };
    const rec = (await callTool("http", ctx, "record_dimension_input", { projectId: pid, body: { ...yes, asserted_by: "attacker" } })) as any;
    expect(JSON.stringify(rec)).toContain("infra.plan_finalized");
    const live = dimRepo.getLiveAssertion(pid, "infra.plan_finalized", db)!;
    expect(live).toMatchObject({ asserted_by: ANALYST, reviewed_by: null, effective_on: "2026-02-20" });
    expect(JSON.stringify(await callTool("http", ctx, "get_dimension_inputs", { projectId: pid, query: { var_key: "infra.plan_finalized" } }))).toContain("2026-02-20");
    const tool = REGISTRY.find((t) => t.name === "record_dimension_input")!;
    expect(tool).toMatchObject({ scope: "write", kind: "write" });
    expect(tool.routes).toEqual(["POST /api/projects/{projectId}/dimension-inputs"]);
    expect(tool.description).toMatch(/explicitly given/i);
    expect(tool.description).toMatch(/never infer/i);
    expect(REGISTRY.some((t) => t.routes.some((r) => /dimension-inputs\/.*review/.test(r)))).toBe(false);
    await expect(callTool("http", { port, scopes: ["read"] }, "record_dimension_input", { projectId: pid, body: yes })).rejects.toThrow(/write/);
    const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
    expect(isHumanOnly("POST", `/api/projects/${pid}/dimension-inputs/${live.id}/review`, {})).toBe(true);
  });
});

describe("caveat removal (B-3)", () => {
  test("the #5 evidence caveat text is gone from the snapshot module and both locales", () => {
    const snap = readFileSync(join(PROJECT_ROOT, "app/web-next/lib/gate-snapshot.ts"), "utf-8");
    expect(snap).not.toContain("C-6 pending");
    expect(snap).toContain("export const KILL_EVIDENCE_CAVEATS: Readonly<Record<string, string>> = {};");
    for (const l of ["en", "ko"]) {
      const j = JSON.parse(readFileSync(join(PROJECT_ROOT, `app/web-next/locales/${l}.json`), "utf-8"));
      expect(j.killCriteria.caveats).toEqual({});
    }
  });
});
