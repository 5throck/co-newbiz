// @version 1.0.0
/**
 * ADR-0187 P4 evidence data (design 2026-10-27-process-ssot-decision-evidence 4.1):
 *  - D1 / H7: grade U when no proxy chain is recorded; U caps RAG at Amber, never Green; migration 0180
 *    widens the CHECK, preserves rows, labels legacy defaults and does not re-grade;
 *  - D2: base_rate provenance enforced in the DB and by the importer (all-or-nothing), read-only lookup;
 *  - D4 / H11: pre-IC permit/incentive capture (migration 0182) adopted by the S11 baseline by id.
 * ASCII-only source.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gradeDataConfidence, NO_CHAIN_RECORDED } from "../../packages/core-scoring/src/data-confidence.ts";
import { dataConfidenceFromChain } from "../../packages/core-scoring/src/rag-engine.ts";

const TEST_DB_PATH = "db/data/test-adr-0187-p4.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { deriveDataConfidence } = await import("../../db/lib/data-confidence.ts");
const br = await import("../../db/lib/base-rate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const pic = await import("../../app/web-next/lib/pre-ic-capture.ts");
const gx = await import("../../app/web-next/lib/greenfield-execution.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const NOW = "2026-10-28T00:00:00Z";
const runSql = (d: Database, sql: string) => { for (const s of splitSqlStatements(sql)) d.run(s); };
function dbBefore(target: string): Database {
  const d = new Database(":memory:");
  d.run("PRAGMA foreign_keys = ON");
  d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) { if (f >= target) break; runSql(d, readFileSync(join(DIR, f), "utf-8")); }
  return d;
}
const rollbackOf = (sql: string): string[] =>
  sql.slice(sql.indexOf("ROLLBACK-SQL-BEGIN"), sql.indexOf("ROLLBACK-SQL-END")).split("\n").slice(1).map((l) => l.replace(/^--\s*/, "").trim()).filter(Boolean);
const fileOf = (p: string) => files.find((f) => f.startsWith(p))!;

describe("D1 grade U", () => {
  test("zero hops + llm-estimate -> U with no_chain_recorded, never a defaulted B", () => {
    const r = gradeDataConfidence({ chainHops: 0, statisticalHops: 0, minR2: null, provenance: "llm-estimate" });
    expect(r.grade).toBe("U");
    expect(r.basis.startsWith(NO_CHAIN_RECORDED)).toBe(true);
    expect(r.basis).not.toContain("r2");
    expect(gradeDataConfidence({ chainHops: 0, statisticalHops: 0, minR2: null, provenance: null }).grade).toBe("U");
  });
  test("direct data stays A; 1 hop r2 0.7 B; 2 hops C; synthesized C", () => {
    expect(gradeDataConfidence({ chainHops: 0, statisticalHops: 0, minR2: null, provenance: "frozen-research" }).grade).toBe("A");
    expect(gradeDataConfidence({ chainHops: 1, statisticalHops: 1, minR2: 0.7, provenance: "llm-estimate" }).grade).toBe("B");
    expect(gradeDataConfidence({ chainHops: 2, statisticalHops: 2, minR2: 0.9, provenance: "frozen-research" }).grade).toBe("C");
    expect(gradeDataConfidence({ chainHops: 0, statisticalHops: 0, minR2: null, provenance: "llm-estimate", synthesized: true }).grade).toBe("C");
  });
  test("U caps the RAG dimension at Amber, never Green", () => {
    const dc = dataConfidenceFromChain("U", false);
    expect(dc.grade).toBe("amber");
    expect(dc.rationale).toContain("never be Green");
  });
  test("deriveDataConfidence on a migrated DB: industry with no proxy_link -> U", () => {
    expect(deriveDataConfidence(db, "no-such-industry", "llm-estimate").grade).toBe("U");
  });
});

describe("migration 0180", () => {
  const T = fileOf("0180_");
  const SQL = readFileSync(join(DIR, T), "utf-8");
  test("notransaction + reversible header + ROLLBACK-SQL; rebuild atomic inside BEGIN IMMEDIATE..COMMIT; FK check after", () => {
    expect(SQL.startsWith("-- @notransaction")).toBe(true);
    const body = SQL.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    const order = ["PRAGMA foreign_keys = OFF", "BEGIN IMMEDIATE", "DROP TABLE market_sizing_version", "ALTER TABLE market_sizing_version_new RENAME", "UPDATE market_sizing_version", "COMMIT", "PRAGMA foreign_keys = ON", "PRAGMA foreign_key_check"].map((t) => body.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(SQL).toContain("@reversible: true");
    expect(SQL).toContain("ADR-0014");
  });
  test("row-preserving, labels the legacy default without re-grading, admits U; rollback guards U rows", () => {
    const d = dbBefore(T);
    d.run("PRAGMA foreign_keys = OFF"); // parent analysis rows are irrelevant to the CHECK / label behaviour
    d.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis) VALUES ('v1','a1',1,'{}','u',?,'B',0,'backfill')", [NOW]);
    d.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis) VALUES ('v2','a1',2,'{}','u',?,'B',1,'derived')", [NOW]);
    d.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis) VALUES ('v0','a1',9,'{}','u',?,'B',NULL,'unknown hops')", [NOW]);
    runSql(d, SQL);
    expect((d.query("SELECT confidence_basis b FROM market_sizing_version WHERE id = 'v0'").get() as { b: string }).b).toBe("unknown hops");
    d.run("DELETE FROM market_sizing_version WHERE id = 'v0'");
    const rows = d.query("SELECT id, data_confidence_grade g, confidence_basis b FROM market_sizing_version ORDER BY id").all() as Array<{ id: string; g: string; b: string }>;
    expect(rows.map((r) => r.g)).toEqual(["B", "B"]);
    expect(rows.length).toBe(2);
    expect(rows[0]!.b).toBe("legacy_default: backfill");
    expect(rows[1]!.b).toBe("derived");
    d.run("PRAGMA foreign_keys = OFF"); // the migration re-enables FKs at its end
    d.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES ('v3','a1',3,'{}','u',?,'U')", [NOW]);
    expect(() => d.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES ('v4','a1',4,'{}','u',?,'X')", [NOW])).toThrow();
    expect(() => { for (const s of rollbackOf(SQL)) d.run(s); }).toThrow();
    d.run("PRAGMA foreign_keys = OFF");
    d.run("DELETE FROM market_sizing_version WHERE id = 'v3'");
    for (const s of rollbackOf(SQL)) d.run(s);
    expect(() => d.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES ('v5','a1',5,'{}','u',?,'U')", [NOW])).toThrow();
    expect((d.query("SELECT COUNT(*) c FROM market_sizing_version").get() as { c: number }).c).toBe(2);
    expect((d.query("SELECT confidence_basis b FROM market_sizing_version WHERE id = 'v1'").get() as { b: string }).b).toBe("backfill");
  });
});

describe("D2 base_rate provenance (migration 0181)", () => {
  const good = { reference_class_key: "gf.plant.capex_overrun", metric: "ratio", p10: 0.1, p50: 0.2, p90: 0.5, source: "internal PM-001", verified_on: "2026-10-01", maintainer: "risk-officer", evidence_kind: "internal_post_mortem" };
  test("the database itself rejects a row without provenance", () => {
    expect(() => db.run("INSERT INTO base_rate (id, reference_class_key, metric, p50, source, verified_on, maintainer, evidence_kind, imported_by, imported_at) VALUES ('x','k','m',1,'  ','2026-10-01','m','public_study','u',?)", [NOW])).toThrow();
    expect(() => db.run("INSERT INTO base_rate (id, reference_class_key, metric, p50, source, verified_on, maintainer, evidence_kind, imported_by, imported_at) VALUES ('x','k','m',1,'s','2026-10-01','m','guess','u',?)", [NOW])).toThrow();
  });
  test("an unsourced row rejects the whole import; nothing written", () => {
    const bad = { ...good, source: "", maintainer: undefined, verified_on: "2099-01-01" };
    const r = br.importBaseRates(db, [good, bad], { actor: "u1", now: NOW });
    expect(r.accepted).toBe(0);
    expect(r.rejected[0]!.index).toBe(1);
    expect(r.rejected[0]!.errors.join(";")).toContain("source is required");
    expect(r.rejected[0]!.errors.join(";")).toContain("maintainer is required");
    expect(r.rejected[0]!.errors.join(";")).toContain("future");
    expect(br.lookupBaseRates(db, good.reference_class_key)).toMatchObject({ status: "not_available", reason: "no_sourced_row" });
  });
  test("sourced rows import, dedupe, read back with provenance and cannot be deleted", () => {
    expect(br.importBaseRates(db, [good], { actor: "u1", now: NOW }).accepted).toBe(1);
    expect(br.importBaseRates(db, [good], { actor: "u1", now: NOW }).duplicates).toBe(1);
    const l = br.lookupBaseRates(db, good.reference_class_key, "ratio");
    expect(l.status).toBe("available");
    if (l.status === "available") expect(l.rows[0]).toMatchObject({ source: good.source, maintainer: "risk-officer", p50: 0.2 });
    expect(() => db.run("DELETE FROM base_rate")).toThrow();
    expect(() => db.run("UPDATE base_rate SET p50 = 9")).toThrow();
    if (l.status === "available") {
      const old = l.rows[0]!.id;
      expect(br.importBaseRates(db, [{ ...good, verified_on: "2026-10-02", p50: 0.25 }], { actor: "u1", now: NOW }).accepted).toBe(1);
      const newer = (db.query("SELECT id FROM base_rate WHERE verified_on = '2026-10-02'").get() as { id: string }).id;
      db.run("UPDATE base_rate SET superseded_by = ? WHERE id = ?", [newer, old]);
      expect(() => db.run("UPDATE base_rate SET superseded_by = NULL WHERE id = ?", [old])).toThrow();
    }
    expect(() => db.run("INSERT INTO base_rate (id, reference_class_key, metric, p50, source, verified_on, maintainer, evidence_kind, imported_by, imported_at) VALUES ('y','k','m',1,'s','2026-02-31','m','public_study','u',?)", [NOW])).toThrow();
    const pid = br.checkBaseRateRow({ ...good, note: "from PRJ-0042 close-out" }, NOW);
    expect(pid.ok).toBe(false);
    expect(br.checkBaseRateRow({ ...good, source: "post-mortem of 01HZY3K6Q8W2N4R5T7V9X0A1BC" }, NOW).ok).toBe(false);
    expect(br.checkBaseRateRow({ ...good, evidence_kind: "public_study", note: "NP-12 cited" }, NOW).ok).toBe(true);
    expect(br.checkBaseRateRow({ ...good, p10: 0.9 }, NOW).ok).toBe(false);
  });
  test("benchmark import requires provenance and integer KRW millions", () => {
    const c = { title: "t", summary_ko: "s", deal_type: "greenfield", deal_size_krw_m: 1.5, source: "s", verified_on: "2026-10-01", maintainer: "m", evidence_kind: "public_study" };
    expect(br.checkBenchmarkCaseRow(c, NOW).ok).toBe(false);
    expect(br.checkBenchmarkCaseRow({ ...c, deal_size_krw_m: 100, evidence_kind: undefined }, NOW).ok).toBe(false);
    expect(br.importBenchmarkCases(db, [{ ...c, deal_size_krw_m: 100 }], { actor: "u1", now: NOW }).accepted).toBe(1);
  });
  test("0181 and 0182 reversible headers and rollback restore the earlier shape", () => {
    for (const p of ["0181_", "0182_"]) {
      const T = fileOf(p);
      const SQL = readFileSync(join(DIR, T), "utf-8");
      expect(SQL.startsWith("-- @reversible: true")).toBe(true);
      const d = dbBefore(T);
      const before = (d.query("SELECT name, sql FROM sqlite_master WHERE name IN ('benchmark_case','permit','incentive') ORDER BY name").all() as Array<{ sql: string }>).map((r) => r.sql.replace(/\s+/g, " "));
      runSql(d, SQL);
      for (const s of rollbackOf(SQL)) d.run(s);
      const after = (d.query("SELECT name, sql FROM sqlite_master WHERE name IN ('benchmark_case','permit','incentive') ORDER BY name").all() as Array<{ sql: string }>).map((r) => r.sql.replace(/\s+/g, " "));
      expect(after).toEqual(before);
      if (p === "0181_") expect(d.query("SELECT name FROM sqlite_master WHERE name = 'base_rate'").get()).toBeNull();
    }
  });
});

describe("D4 pre-IC capture -> S11 adoption", () => {
  const A1 = "p4_lead";
  function seedGreenfield(): string {
    const opp = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `p4 ${opp}`, "t", "selected", A1, NOW]);
    db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, "greenfield", "existing_business_rbd", "t", A1, NOW]);
    const id = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track, origin) VALUES (?,?,?,?,?,?)", [id, `P4-${id.slice(-8)}`, NOW, opp, "greenfield", "internal"]);
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, A1, "lead", "root", NOW, "author"]);
    db.run("INSERT INTO project_case_classification (id, project_id, case_type, origin, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?)", [ulid(), id, "greenfield", "internal", A1, NOW, "t"]);
    return id;
  }
  test("capture validates stage and clawback terms; rows are tagged and attributed", () => {
    const p = seedGreenfield();
    expect(gx.executionBaselineScope(p, db).state).toBe("applies");
    expect(pic.capturePermitCandidate({ projectId: p, stage: "S11", name: "x", actor: A1 }, db)).toMatchObject({ ok: false, code: "invalid_request" });
    expect(pic.captureIncentiveCandidate({ projectId: p, stage: "S8", program_name: "subsidy", type: "region_subsidy", clawback_rule: " ", actor: A1 }, db)).toMatchObject({ ok: false, code: "invalid_request" });
    expect(pic.captureIncentiveCandidate({ projectId: p, stage: "S8", program_name: "subsidy", type: " ", clawback_rule: "none (basis: program terms)", actor: A1 }, db)).toMatchObject({ ok: false, code: "invalid_request" });
    const pr = pic.capturePermitCandidate({ projectId: p, stage: "S8", name: "factory registration", agency: "city", actor: A1, now: NOW }, db);
    expect(pr.ok).toBe(true);
    const row = db.query("SELECT stage_captured, captured_by FROM permit WHERE project_id = ?").get(p) as { stage_captured: string; captured_by: string };
    expect(row).toEqual({ stage_captured: "S8", captured_by: A1 });
    expect(db.query("SELECT COUNT(*) c FROM certification WHERE project_id = ?").get(p)).toEqual({ c: 0 });
  });
  test("S11 adopts captures by id without re-entry; a permit is never dated by default", () => {
    const p = seedGreenfield();
    const permit = pic.capturePermitCandidate({ projectId: p, stage: "S8", name: "permit A", agency: "agency", actor: A1, now: NOW }, db);
    const inc = pic.captureIncentiveCandidate({ projectId: p, stage: "S5", program_name: "regional grant", type: "region_subsidy", clawback_rule: "repay if relocated within 5y", construction_deadline: "2027-06-30", application_deadline: "2027-01-31", actor: A1, now: NOW }, db);
    if (!permit.ok || !inc.ok) throw new Error("capture failed");
    expect(pic.preIcLinkStatus(p, gx.EMPTY_ENTRIES, db).unlinked).toBe(2);
    const first = pic.adoptPreIcCaptures({ projectId: p, actor: A1, now: NOW }, db);
    if (!first.ok) throw new Error(first.message);
    expect(first.adopted.incentives).toEqual([inc.id]);
    expect(first.skipped).toEqual([{ id: permit.id, reason: "target_date_required" }]);
    expect(first.record.entries.incentive_obligations[0]).toMatchObject({ incentive_id: inc.id, deadline: "2027-01-31" });
    const second = pic.adoptPreIcCaptures({ projectId: p, permitTargetDates: { [permit.id]: "2027-03-01" }, actor: A1, now: NOW }, db);
    if (!second.ok) throw new Error(second.message);
    expect(second.adopted).toEqual({ permits: [permit.id], incentives: [] });
    expect(second.record.entries.incentive_obligations).toHaveLength(1);
    expect(second.record.confirmation).toBeNull();
    expect(pic.preIcLinkStatus(p, second.record.entries, db).unlinked).toBe(0);
    expect(pic.adoptPreIcCaptures({ projectId: p, actor: A1, now: NOW }, db).ok).toBe(false);
    const audits = db.query("SELECT action FROM audit_log WHERE target LIKE ? ORDER BY created_at, id").all(`${p}:%`) as Array<{ action: string }>;
    expect(audits.map((a) => a.action)).toContain("execution_baseline.pre_ic_adopted");
    const src = gx.executionBaselineStatus(p, db).sources as { permits: Array<{ stage_captured: string }> };
    expect(src.permits[0]!.stage_captured).toBe("S8");
  });
  test("adoption route is human-only on the in-process MCP port", () => {
    expect(isHumanOnly("POST", "/api/projects/X/pre-ic-captures/adopt", {})).toBe(true);
  });
});
