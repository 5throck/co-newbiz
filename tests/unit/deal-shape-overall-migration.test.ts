// @version 1.0.0
/**
 * ADR-0201 / migration 0198 (table rebuild): legacy rows copied verbatim, FK clean, both partial unique indexes, the table CHECK,
 * the guarded ROLLBACK-SQL block. In-memory SQLite built through the migration chain up to 0197, then 0198 applied.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const ROOT = join(import.meta.dirname, "../..");

describe("migration 0198 (table rebuild)", () => {
  const DIR = join(ROOT, "db", "migrations");
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const TARGET = files.find((f) => f.startsWith("0198_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");
  const run = (d: Database, sql: string) => {
    for (const s of splitSqlStatements(sql)) d.run(s);
  };
  const before = (): Database => {
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)",
    );
    for (const f of files) {
      if (f >= TARGET) break;
      run(d, readFileSync(join(DIR, f), "utf-8"));
    }
    return d;
  };
  const seedLegacy = (d: Database) => {
    d.run(
      "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES ('o1','t','industry','selected','u','x')",
    );
    const ins = (id: string, shape: string, viable: number, sup: string | null) =>
      d.run(
        "INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by) VALUES (?, 'o1', ?, 'integration', ?, 'r', NULL, 'u', 'x', ?)",
        [id, shape, viable, sup],
      );
    ins("new", "spv", 0, null);
    ins("old", "spv", 1, "new");
    ins("jv", "joint_venture", 1, null);
  };

  test("opens with the irreversible-in-general header, a guarded ROLLBACK-SQL block and @notransaction", () => {
    expect(SQL.startsWith("-- @notransaction")).toBe(true);
    expect(SQL).toContain("@reversible: false in the general case");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL).toContain("WHERE shape IS NULL");
  });

  test("rebuild copies legacy rows verbatim (row parity), keeps FK clean and installs both partial unique indexes", () => {
    const d = before();
    seedLegacy(d);
    const rowsBefore = d.query("SELECT * FROM opportunity_deal_shape_evaluation ORDER BY id").all();
    run(d, SQL);
    expect(d.query("SELECT * FROM opportunity_deal_shape_evaluation ORDER BY id").all()).toEqual(rowsBefore);
    expect(d.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const idx = (
      d
        .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='opportunity_deal_shape_evaluation'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(["idx_odse_live", "idx_odse_live_overall", "idx_odse_opp"]));
    const fk = d.query("PRAGMA foreign_key_list(opportunity_deal_shape_evaluation)").all() as Array<{ table: string }>;
    expect(fk.map((f) => f.table).sort()).toEqual(["opportunity", "opportunity_deal_shape_evaluation"]);
  });

  test("the table CHECK admits legacy not-viable shape rows and an overall row, and refuses half-null or viable overall rows", () => {
    const d = before();
    run(d, SQL);
    d.run(
      "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES ('o2','t','industry','selected','u','x')",
    );
    const o = "o2";
    const rawInsert = (_o: string, over: Record<string, unknown> = {}) => {
      const r = {
        id: ulid(),
        opportunity_id: o,
        shape: "spv",
        intent: "integration",
        viable: 1,
        rationale: "x",
        evidence_ref: null,
        evaluated_by: "u",
        evaluated_at: "x",
        superseded_by: null,
        ...over,
      };
      d.run(
        "INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
        Object.values(r) as never,
      );
    };
    expect(() => rawInsert(o, { viable: 0 })).not.toThrow(); // legacy shape row
    expect(() => rawInsert(o, { shape: null, intent: null, viable: 0 })).not.toThrow(); // overall row
    expect(() => rawInsert(o, { shape: null, intent: null, viable: 0 })).toThrow(); // second live overall row
    expect(() => rawInsert(o, { shape: null, intent: null, viable: 1, superseded_by: "x" })).toThrow(); // overall must be viable 0
    expect(() => rawInsert(o, { shape: null, intent: "integration", viable: 0, superseded_by: "x" })).toThrow();
    expect(() => rawInsert(o, { shape: "spv", intent: null })).toThrow();
  });

  test("rollback guard: the 0188-shape rebuild is only valid while no overall row exists", () => {
    const d = before();
    seedLegacy(d);
    run(d, SQL);
    const guard = () =>
      (
        d.query("SELECT COUNT(*) AS n FROM opportunity_deal_shape_evaluation WHERE shape IS NULL").get() as {
          n: number;
        }
      ).n;
    expect(guard()).toBe(0);
    d.run(
      "INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evaluated_by, evaluated_at) VALUES ('ov','o1',NULL,NULL,0,'none','u','x')",
    );
    expect(guard()).toBe(1);
  });
});
