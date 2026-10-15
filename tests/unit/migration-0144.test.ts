// @version 1.0.0
/**
 * Migration 0144 (ADR-0176 slice 2) - investment_simulation_run.
 * Applies every migration BEFORE 0144 to a scratch :memory: database, then 0144, and proves the
 * table shape, CHECKs (draw clamp, envelope > 0, valid JSON, status/supersede pairing), the
 * one-current-run-per-opportunity partial unique index, the repository supersede chain with its
 * audited investment_simulation.run row, and the header rollback. ASCII-only source.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";
import { getLatestInvestmentSimulationRun, insertInvestmentSimulationRun } from "../../db/repositories/investment-simulation-run.repository.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0144_"))!;
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
// Repository selects the slice-3 confirmation columns (migration 0146), so a fresh db applies it too.
const SQL_0146 = readFileSync(join(DIR, files.find((f) => f.startsWith("0146_"))!), "utf-8");
const NOW = "2026-10-15T00:00:00Z";

const runSql = (db: Database, sql: string) => { for (const s of splitSqlStatements(sql)) db.run(s); };

function applyBefore(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= TARGET) break;
    runSql(db, readFileSync(join(DIR, f), "utf-8"));
  }
}

function fresh(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  applyBefore(db);
  db.transaction(() => runSql(db, SQL))();
  db.transaction(() => runSql(db, SQL_0146))();
  db.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o1','opp','u',?)", [NOW]);
  db.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o2','opp2','u',?)", [NOW]);
  return db;
}

const ins = (db: Database, over: Record<string, unknown> = {}) => {
  const r = { id: "r1", opp: "o1", draws: 500, env: null as number | null, a: "{}", res: "{}", status: "current", sup: null as string | null, ...over };
  db.run(
    "INSERT INTO investment_simulation_run (id, opportunity_id, input_hash, seed, draw_count, horizon_years, envelope_krw_m, assumptions_json, results_json, status, superseded_by, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [r.id, r.opp, "h", 1, r.draws, 5, r.env, r.a, r.res, r.status, r.sup, "u", NOW] as never,
  );
};

describe("migration 0144 investment_simulation_run", () => {
  test("filename is the next migration after 0143 and table has the ADR-0176 columns", () => {
    expect(TARGET).toBe("0144_investment_simulation_run.sql");
    const db = fresh();
    const cols = (db.query("PRAGMA table_info(investment_simulation_run)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "opportunity_id", "input_hash", "seed", "draw_count", "horizon_years", "envelope_krw_m", "assumptions_json", "results_json", "status", "superseded_by", "created_by", "created_at", "audit_id", "confirmed_by", "confirmed_at", "confirm_audit_id"]); // last three: migration 0146 (slice 3)
    // No per-draw storage column of any kind.
    expect(cols.some((c) => /draw_?vectors|per_draw/i.test(c))).toBe(false);
  });

  test("CHECKs: draw count 100..5000, envelope > 0, valid JSON, status/supersede pairing, FK to opportunity", () => {
    const db = fresh();
    expect(() => ins(db, { draws: 99 })).toThrow();
    expect(() => ins(db, { draws: 5001 })).toThrow();
    expect(() => ins(db, { env: 0 })).toThrow();
    expect(() => ins(db, { env: -5 })).toThrow();
    expect(() => ins(db, { a: "not json" })).toThrow();
    expect(() => ins(db, { res: "{" })).toThrow();
    expect(() => ins(db, { status: "bogus" })).toThrow();
    expect(() => ins(db, { status: "superseded", sup: null })).toThrow();
    expect(() => ins(db, { status: "current", sup: "r9" })).toThrow();
    expect(() => ins(db, { opp: "missing" })).toThrow();
    ins(db, { draws: 100, env: 1.5 });
    ins(db, { id: "r2", opp: "o2", draws: 5000 });
  });

  test("at most one current run per opportunity (partial unique index)", () => {
    const db = fresh();
    ins(db);
    expect(() => ins(db, { id: "r2" })).toThrow();
    ins(db, { id: "r3", opp: "o2" });
  });

  test("repository: a new run supersedes the previous one, history is kept, audit row is appended", () => {
    const db = fresh();
    const mk = (hash: string) => insertInvestmentSimulationRun({
      opportunityId: "o1", inputHash: hash, seed: 7, drawCount: 500, horizonYears: 5, envelopeKrwM: 1000,
      assumptions: { a: 1 }, results: { r: [1, 2] }, actor: "alice", now: NOW,
    }, db);
    const first = mk("h1");
    expect(first.status).toBe("current");
    expect(first.results).toEqual({ r: [1, 2] });
    const second = mk("h2");
    expect(second.id).not.toBe(first.id);
    expect(getLatestInvestmentSimulationRun("o1", db)!.id).toBe(second.id);
    expect(getLatestInvestmentSimulationRun("o2", db)).toBeNull();
    const rows = db.query("SELECT id, status, superseded_by FROM investment_simulation_run ORDER BY created_at, id").all() as Array<{ id: string; status: string; superseded_by: string | null }>;
    expect(rows.length).toBe(2);
    const old = rows.find((r) => r.id === first.id)!;
    expect(old.status).toBe("superseded");
    expect(old.superseded_by).toBe(second.id);
    const audits = db.query("SELECT actor_user_id, action, target FROM audit_log WHERE action = 'investment_simulation.run'").all() as Array<{ actor_user_id: string; target: string }>;
    expect(audits.length).toBe(2);
    expect(audits[0].actor_user_id).toBe("alice");
    expect(audits.map((a) => a.target)).toContain(`o1#${second.id}`);
    expect((db.query("SELECT audit_id FROM investment_simulation_run WHERE id = ?").get(second.id) as { audit_id: string | null }).audit_id).not.toBeNull();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("header rollback drops the table and its indexes; 0144 re-applies", () => {
    const db = fresh();
    const rollback = SQL.split("ROLLBACK-SQL-BEGIN")[1].split("ROLLBACK-SQL-END")[0].split("\n").map((l) => l.replace(/^--\s?/, "")).join("\n");
    runSql(db, rollback);
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'investment_simulation_run'").get()).toBeNull();
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name IN ('idx_isr_current','idx_isr_opp')").get()).toBeNull();
    db.transaction(() => runSql(db, SQL))();
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'investment_simulation_run'").get()).not.toBeNull();
  });
});
