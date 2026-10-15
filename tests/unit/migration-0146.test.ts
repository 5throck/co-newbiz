// @version 1.0.0
/**
 * Migration 0146 (ADR-0176 slice 3) - investment_simulation_run confirmation columns.
 * Applies every earlier migration to a scratch :memory: database, then 0146, and proves the columns
 * are nullable/additive (a pre-existing run stays unconfirmed), the confirmed index exists, the
 * repository confirm path writes the audited row, and the header rollback restores the 0144 shape.
 * ASCII-only source.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";
import { confirmInvestmentSimulationRun, getLatestConfirmedInvestmentSimulationRun, insertInvestmentSimulationRun } from "../../db/repositories/investment-simulation-run.repository.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0146_"))!;
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
const NOW = "2026-10-15T00:00:00Z";
const runSql = (db: Database, sql: string) => { for (const s of splitSqlStatements(sql)) db.run(s); };

function before(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= TARGET) break;
    runSql(db, readFileSync(join(DIR, f), "utf-8"));
  }
  db.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o1','opp','u',?)", [NOW]);
  return db;
}
const cols = (db: Database): string[] => (db.query("PRAGMA table_info(investment_simulation_run)").all() as Array<{ name: string }>).map((c) => c.name);

describe("migration 0146 investment_simulation_run confirmation", () => {
  test("is declared reversible with rollback SQL", () => {
    expect(SQL).toContain("@reversible: true");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
  });

  test("additive: an existing 0144 run survives unconfirmed and invisible to S8", () => {
    const db = before();
    db.run(
      "INSERT INTO investment_simulation_run (id, opportunity_id, input_hash, seed, draw_count, horizon_years, assumptions_json, results_json, created_by, created_at) VALUES ('r0','o1','h',1,500,5,'{}','{}','u',?)",
      [NOW],
    );
    db.transaction(() => runSql(db, SQL))();
    expect(cols(db)).toEqual(expect.arrayContaining(["confirmed_by", "confirmed_at", "confirm_audit_id"]));
    const row = db.query("SELECT confirmed_by, confirmed_at FROM investment_simulation_run WHERE id = 'r0'").get() as { confirmed_by: string | null; confirmed_at: string | null };
    expect(row).toEqual({ confirmed_by: null, confirmed_at: null });
    expect(getLatestConfirmedInvestmentSimulationRun("o1", db)).toBeNull();
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'idx_isr_confirmed'").get()).not.toBeNull();
  });

  test("repository: confirm writes the audited row once, supersede keeps the confirmation, not_found / already_confirmed are refused", () => {
    const db = before();
    db.transaction(() => runSql(db, SQL))();
    const mk = (hash: string) => insertInvestmentSimulationRun({ opportunityId: "o1", inputHash: hash, seed: 7, drawCount: 500, horizonYears: 5, envelopeKrwM: null, assumptions: {}, results: {}, actor: "alice", now: NOW }, db);
    const a = mk("h1");
    expect(confirmInvestmentSimulationRun("o1", "missing", "bob", NOW, db)).toEqual({ ok: false, reason: "not_found" });
    expect(confirmInvestmentSimulationRun("o2", a.id, "bob", NOW, db)).toEqual({ ok: false, reason: "not_found" });
    const c = confirmInvestmentSimulationRun("o1", a.id, "bob", "2026-10-16T00:00:00Z", db);
    expect(c.ok).toBe(true);
    expect(confirmInvestmentSimulationRun("o1", a.id, "bob", NOW, db)).toEqual({ ok: false, reason: "already_confirmed" });
    const audits = db.query("SELECT actor_user_id, target FROM audit_log WHERE action = 'investment_simulation.confirmed'").all() as Array<{ actor_user_id: string; target: string }>;
    expect(audits.length).toBe(1);
    expect(audits[0].actor_user_id).toBe("bob");
    mk("h2"); // supersedes a, unconfirmed
    expect(getLatestConfirmedInvestmentSimulationRun("o1", db)!.id).toBe(a.id);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("header rollback drops the columns and index; the 0144 shape and rows remain", () => {
    const db = before();
    db.transaction(() => runSql(db, SQL))();
    db.run("INSERT INTO investment_simulation_run (id, opportunity_id, input_hash, seed, draw_count, horizon_years, assumptions_json, results_json, created_by, created_at) VALUES ('r1','o1','h',1,500,5,'{}','{}','u',?)", [NOW]);
    const rollback = SQL.split("ROLLBACK-SQL-BEGIN")[1].split("ROLLBACK-SQL-END")[0].split("\n").map((l) => l.replace(/^--\s?/, "")).join("\n");
    runSql(db, rollback);
    expect(cols(db)).not.toContain("confirmed_at");
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name = 'idx_isr_confirmed'").get()).toBeNull();
    expect((db.query("SELECT COUNT(*) AS n FROM investment_simulation_run").get() as { n: number }).n).toBe(1);
    db.transaction(() => runSql(db, SQL))();
    expect(cols(db)).toContain("confirmed_at");
  });
});
