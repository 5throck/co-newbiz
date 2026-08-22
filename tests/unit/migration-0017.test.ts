/**
 * Unit tests for migration 0017 (market dimension evidence layer) — design of
 * record docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decisions 2 + 6, ADR-0046 §5. Real scratch SQLite (the migration-0013/0016
 * pattern: runMigrations on a temp WAL DB, resetDb in afterAll) so the CHECKs,
 * FKs, and the composite PK are exercised by SQLite itself, not mocked.
 *
 * PR-6 is evidence-layer-only by design — the thresholds agenda owned every
 * number until docs/decisions/market-thresholds.md (2026-08-23) approved them.
 * These tests pin the snapshot shape (including the documented fourth status),
 * the exact seed set, the placeholder discipline inside condition_expr at its
 * 0017 layer, the join-table wiring (via collectPredicateVars — reuse, not
 * re-implementation), and the staging guard, so the post-meeting PRs build
 * against a contract that cannot drift.
 *
 * 0019 KNOCK-ON (the 0014→0017 lesson, applied again): this file runs the
 * FULL migration chain, and migration 0019 finalized the five staged rows per
 * the record — placeholders replaced by real scalars, right-to-win re-graded
 * amber→green (D-M-MKT-10.1) — and added gate-split/new rules under other
 * keys. Rule-row assertions are therefore scoped to the rule-0017-* ids and
 * state only what 0017 itself still guarantees; the final values are pinned
 * by tests/unit/migration-0019.test.ts.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { parsePredicate, type Predicate, type Scalar } from "../../db/lib/predicate.ts";
import { collectPredicateVars } from "../../db/lib/applies-when.ts";

const TEST_DB_PATH = "db/data/test-migration-0017.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const NOW = "2026-08-23T10:00:00Z";
const SEED_CREATED_AT = "2026-08-23T00:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let runId: string;

/** Decision 2's snapshot DDL, in declaration order — the shape contract. */
const SNAPSHOT_COLUMNS = [
  "run_id", "project_id", "var_key", "value_num", "value_text",
  "evidence_ref", "observed_at", "status",
] as const;

const STATUS_MEMBERS = ["present", "missing", "stale", "low_confidence"] as const;

/** The 10 seeded var_keys (spec table's 9 + market.link_fit_quality, option (a)). */
const SEEDED_VARS = [
  "market.bargaining_power_hhi",
  "market.switching_cost_grade",
  "market.tam",
  "market.growth_rate",
  "market.top3_share",
  "market.entry_barrier",
  "right_to_win.customer_overlap",
  "right_to_win.tech_overlap",
  "right_to_win.brand_transferability",
  "market.link_fit_quality",
] as const;

const COMPUTED_VARS = new Set([
  "market.bargaining_power_hhi",
  "market.switching_cost_grade",
  "market.tam",
  "market.growth_rate",
  "market.top3_share",
  "market.link_fit_quality",
]);

const STAGED_RULES = [
  "market-dd-bargaining-power",
  "market-dd-competitive-demerit",
  "market-dd-switching-cost",
  "market-dd-tam-growth",
  "market-dd-right-to-win",
] as const;

interface RuleRow {
  id: string;
  rule_key: string;
  version: number;
  stage_gate: string;
  dimension: string;
  grade: string;
  condition_expr: string;
  priority: number;
  enabled: number;
  policy_id: string | null;
  thresholds_source: string | null;
}

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

function insertRun(): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, projectId, `hash-${id.slice(-6)}`, "user-001", NOW]);
  return id;
}

function insertSnapshot(varKey: string, status: string, overrides: Record<string, unknown> = {}): void {
  const base: Record<string, unknown> = {
    run_id: runId,
    project_id: projectId,
    var_key: varKey,
    value_num: 42,
    value_text: null,
    evidence_ref: "source.pdf#p3",
    observed_at: NOW,
    status,
    ...overrides,
  };
  const cols = Object.keys(base);
  db.run(
    `INSERT INTO project_variable_snapshot (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(base) as never[],
  );
}

function tableColumns(table: string): { name: string; type: string; notnull: number; pk: number }[] {
  return db.query(`PRAGMA table_info(${table})`).all() as never[];
}

function indexSql(table: string): { name: string; sql: string | null }[] {
  return db.query(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`).all() as never[];
}

function ruleRows(): RuleRow[] {
  // scoped to 0017's own rows: 0019 added market-dd-right-to-win-absent under
  // the same rule_key prefix and re-graded/filled the originals per the record
  return db
    .query("SELECT id, rule_key, version, stage_gate, dimension, grade, condition_expr, priority, enabled, policy_id, thresholds_source FROM rag_rule WHERE id LIKE 'rule-0017-%' ORDER BY priority")
    .all() as never[];
}

/** Parse one staged rule's condition_expr through the REAL gate (PredicateSchema). */
function parseRule(row: RuleRow): Predicate {
  return parsePredicate(JSON.parse(row.condition_expr));
}

/**
 * Deep-walk a parsed AST counting scalar leaves equal to the placeholder
 * marker. Var collection is collectPredicateVars's job (reused below); this
 * walker only inspects the VALUE slots, which that helper deliberately does
 * not visit.
 */
function countPlaceholderLeaves(pred: Predicate, marker = "_threshold_placeholder"): number {
  switch (pred.op) {
    case "all_of":
    case "any_of":
    case "none_of":
    case "at_least":
      return pred.of.reduce((n, child) => n + countPlaceholderLeaves(child, marker), 0);
    case "cmp":
      return pred.value === marker ? 1 : 0;
    case "in":
      return pred.values.filter((v: Scalar) => v === marker).length;
    case "is_null":
      return 0;
    case "count":
      return pred.value === marker ? 1 : 0;
  }
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = insertProject();
  runId = insertRun();
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// Shape contract — project_variable_snapshot (Decision 2 DDL + the 4th status)
// ---------------------------------------------------------------------------

describe("shape: project_variable_snapshot", () => {
  test("column set matches the Decision 2 DDL exactly (order included)", () => {
    expect(tableColumns("project_variable_snapshot").map((c) => c.name)).toEqual([...SNAPSHOT_COLUMNS]);
    const byName = new Map(tableColumns("project_variable_snapshot").map((c) => [c.name, c]));
    expect(byName.get("run_id")).toMatchObject({ notnull: 1 });
    expect(byName.get("project_id")).toMatchObject({ notnull: 1 });
    expect(byName.get("var_key")).toMatchObject({ notnull: 1 });
    expect(byName.get("value_num")).toMatchObject({ type: "NUMERIC", notnull: 0 });
    expect(byName.get("value_text")).toMatchObject({ notnull: 0 });
    expect(byName.get("evidence_ref")).toMatchObject({ notnull: 0 });
    expect(byName.get("observed_at")).toMatchObject({ notnull: 0 });
    expect(byName.get("status")).toMatchObject({ notnull: 1 });
  });

  test("composite PK is exactly (run_id, project_id, var_key)", () => {
    const pks = tableColumns("project_variable_snapshot").filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    expect(pks.map((c) => c.name)).toEqual(["run_id", "project_id", "var_key"]);
  });

  test("the project-scoped index exists with the documented column order", () => {
    const idx = indexSql("project_variable_snapshot").find((i) => i.name === "idx_project_variable_snapshot_project");
    expect(idx).toBeDefined();
    expect(idx!.sql).toMatch(/ON project_variable_snapshot\(project_id, var_key\)/i);
  });

  test("all three FKs are enforced (run, md_project, evidence_var)", () => {
    expect(() => insertSnapshot("market.tam", "present", { run_id: "01NOSUCHRUN000000000001" })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertSnapshot("market.tam", "present", { project_id: "01NOSUCHPROJECT0000001" })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertSnapshot("no_such_var", "present")).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("the status CHECK accepts all four members incl. low_confidence and rejects anything else", () => {
    // one distinct seeded var per status so the composite PK never collides
    insertSnapshot("market.tam", "present");
    insertSnapshot("market.growth_rate", "missing", { value_num: null, evidence_ref: null, observed_at: null });
    insertSnapshot("market.top3_share", "stale");
    insertSnapshot("market.link_fit_quality", "low_confidence"); // the documented fourth member
    expect(() => insertSnapshot("market.entry_barrier", "unknown")).toThrow(/CHECK constraint failed/);
    expect(() => insertSnapshot("market.entry_barrier", "excluded")).toThrow(/CHECK constraint failed/);
    expect(() => insertSnapshot("market.entry_barrier", "PRESENT")).toThrow(/CHECK constraint failed/); // enum is case-sensitive
  });

  test("the composite PK rejects a second row for the same (run, project, var)", () => {
    insertSnapshot("market.bargaining_power_hhi", "present");
    expect(() => insertSnapshot("market.bargaining_power_hhi", "missing")).toThrow(/UNIQUE constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// Seed integrity — the 10 evidence_var rows
// ---------------------------------------------------------------------------

describe("evidence_var seeds", () => {
  test("the exact 10-key set is seeded — no more, no fewer (fit-quality option (a))", () => {
    const rows = db
      .query("SELECT var_key FROM evidence_var WHERE var_key LIKE 'market.%' OR var_key LIKE 'right_to_win.%' ORDER BY var_key")
      .all() as { var_key: string }[];
    expect(rows.map((r) => r.var_key)).toEqual([...SEEDED_VARS].sort());
    // 0017's seeds are 0017's to pin (the 0014→0017 knock-on lesson, applied to
    // this file by 0018): exact count scoped to this migration's prefixes,
    // registry total as a lower bound — future migrations may only ADD vars.
    expect((db.query("SELECT COUNT(*) AS c FROM evidence_var WHERE var_key LIKE 'market.%' OR var_key LIKE 'right_to_win.%'").get() as { c: number }).c).toBe(10);
    expect((db.query("SELECT COUNT(*) AS c FROM evidence_var").get() as { c: number }).c).toBeGreaterThanOrEqual(14);
  });

  test("market.competitive_intensity is deliberately NOT seeded (agenda §5.1)", () => {
    expect((db.query("SELECT COUNT(*) AS c FROM evidence_var WHERE var_key = 'market.competitive_intensity'").get() as { c: number }).c).toBe(0);
  });

  test("computed/asserted split and requires_evidence_ref are correct", () => {
    const rows = db
      .query("SELECT var_key, source_kind, requires_evidence_ref FROM evidence_var WHERE var_key LIKE 'market.%' OR var_key LIKE 'right_to_win.%'")
      .all() as { var_key: string; source_kind: string; requires_evidence_ref: number }[];
    for (const row of rows) {
      const computed = COMPUTED_VARS.has(row.var_key);
      expect(row.source_kind, row.var_key).toBe(computed ? "computed" : "asserted");
      // asserted vars are human judgement — evidence mandatory; computed vars
      // carry provenance through their source query, not per-row refs
      expect(row.requires_evidence_ref, row.var_key).toBe(computed ? 0 : 1);
    }
  });

  test("value_type and unit match the spec table", () => {
    const rows = db
      .query("SELECT var_key, value_type, unit FROM evidence_var WHERE var_key LIKE 'market.%' OR var_key LIKE 'right_to_win.%'")
      .all() as { var_key: string; value_type: string; unit: string | null }[];
    const byKey = new Map(rows.map((r) => [r.var_key, r]));
    expect(byKey.get("market.bargaining_power_hhi")).toMatchObject({ value_type: "number", unit: "ratio" });
    expect(byKey.get("market.switching_cost_grade")).toMatchObject({ value_type: "string", unit: null });
    expect(byKey.get("market.tam")).toMatchObject({ value_type: "number", unit: "krw" });
    expect(byKey.get("market.growth_rate")).toMatchObject({ value_type: "number", unit: "ratio" });
    expect(byKey.get("market.top3_share")).toMatchObject({ value_type: "number", unit: "ratio" });
    expect(byKey.get("market.entry_barrier")).toMatchObject({ value_type: "string", unit: null });
    expect(byKey.get("right_to_win.customer_overlap")).toMatchObject({ value_type: "number", unit: null });
    expect(byKey.get("right_to_win.tech_overlap")).toMatchObject({ value_type: "number", unit: null });
    expect(byKey.get("right_to_win.brand_transferability")).toMatchObject({ value_type: "number", unit: null });
    expect(byKey.get("market.link_fit_quality")).toMatchObject({ value_type: "number", unit: "ratio" });
  });

  test("created_at is the fixed literal — the seed set is byte-deterministic", () => {
    const rows = db
      .query("SELECT var_key, created_at FROM evidence_var WHERE var_key LIKE 'market.%' OR var_key LIKE 'right_to_win.%'")
      .all() as { var_key: string; created_at: string }[];
    expect(rows).toHaveLength(10);
    for (const row of rows) expect(row.created_at, row.var_key).toBe(SEED_CREATED_AT);
  });
});

// ---------------------------------------------------------------------------
// Staged rag_rule skeleton — placeholder discipline
// ---------------------------------------------------------------------------

describe("rag_rule staged skeleton", () => {
  test("exactly five 0017 rows, priorities 1..5, all dd/market/version 1; grade amber except the 0019 re-grade", () => {
    const rows = ruleRows();
    expect(rows.map((r) => r.rule_key)).toEqual([...STAGED_RULES]);
    expect(rows.map((r) => r.priority)).toEqual([1, 2, 3, 4, 5]);
    for (const row of rows) {
      expect(row.version, row.rule_key).toBe(1);
      expect(row.stage_gate, row.rule_key).toBe("dd");
      expect(row.dimension, row.rule_key).toBe("market");
      // amber was the 0017 placeholder grade (the only one surviving the
      // Decision 9 Green cap); 0019 re-graded the merit rule green per
      // D-M-MKT-10.1 — still enabled=0 until calibration lifts the cap
      expect(row.grade, row.rule_key).toBe(row.rule_key === "market-dd-right-to-win" ? "green" : "amber");
    }
  });

  test("all rows are enabled=0 with policy_id and thresholds_source NULL (the CHECK's other branch)", () => {
    for (const row of ruleRows()) {
      expect(row.enabled, row.rule_key).toBe(0);
      expect(row.policy_id, row.rule_key).toBeNull();
      expect(row.thresholds_source, row.rule_key).toBeNull();
    }
  });

  test("every condition_expr PARSES under the real PredicateSchema gate", () => {
    for (const row of ruleRows()) {
      expect(() => parseRule(row), row.rule_key).not.toThrow();
    }
  });

  test("no _threshold_placeholder leaf remains — 0019 replaced them with the record's scalars", () => {
    // the ≥1-placeholder contract held while the rows were staged; the record
    // (docs/decisions/market-thresholds.md) filled every scalar in 0019
    for (const row of ruleRows()) {
      const parsed = parseRule(row);
      expect(countPlaceholderLeaves(parsed), row.rule_key).toBe(0);
    }
  });

  test("collectPredicateVars of every parse is a subset of the 0017 seed set", () => {
    const seeded = new Set<string>(SEEDED_VARS);
    for (const row of ruleRows()) {
      const vars = collectPredicateVars(parseRule(row));
      for (const v of vars) expect(seeded.has(v), `${row.rule_key} references unseeded var ${v}`).toBe(true);
    }
  });

  test("the structures match the agenda §3 shapes (spot-assertions, not just parseability)", () => {
    const byKey = new Map(ruleRows().map((r) => [r.rule_key, r]));
    // §3.1: two conjuncts — HHI gte, fit-quality gte
    const bargaining = parseRule(byKey.get("market-dd-bargaining-power")!);
    expect(bargaining).toMatchObject({ op: "all_of" });
    expect(bargaining.op === "all_of" ? bargaining.of.length : 0).toBe(2);
    // §3.2: the composite — growth lt, entry_barrier in, top3 gte
    const demerit = parseRule(byKey.get("market-dd-competitive-demerit")!);
    expect(demerit).toMatchObject({ op: "all_of" });
    if (demerit.op === "all_of") {
      expect(demerit.of.map((c) => c.op)).toEqual(["cmp", "in", "cmp"]);
      expect(demerit.of[1]).toMatchObject({ op: "in", var: "market.entry_barrier" });
    }
    // §3.3: a bare in-predicate on the switching-cost grade
    expect(parseRule(byKey.get("market-dd-switching-cost")!)).toMatchObject({ op: "in", var: "market.switching_cost_grade" });
    // §3.4: any_of with per-branch units (krw / ratio)
    const tamGrowth = parseRule(byKey.get("market-dd-tam-growth")!);
    if (tamGrowth.op === "any_of") {
      expect(tamGrowth.of).toHaveLength(2);
      expect(tamGrowth.of[0]).toMatchObject({ var: "market.tam", unit: "krw" });
      expect(tamGrowth.of[1]).toMatchObject({ var: "market.growth_rate", unit: "ratio" });
    } else {
      throw new Error("market-dd-tam-growth is not any_of");
    }
    // §3.6: at_least over the three decomposed rtw vars (k is schema-forced integer)
    const rtw = parseRule(byKey.get("market-dd-right-to-win")!);
    if (rtw.op === "at_least") {
      expect(rtw.of.map((c) => (c.op === "cmp" ? c.var : c.op))).toEqual([
        "right_to_win.customer_overlap",
        "right_to_win.tech_overlap",
        "right_to_win.brand_transferability",
      ]);
      expect(Number.isInteger(rtw.k)).toBe(true);
    } else {
      throw new Error("market-dd-right-to-win is not at_least");
    }
  });
});

// ---------------------------------------------------------------------------
// Join-table consistency — rag_rule_variable == parsed var set
// ---------------------------------------------------------------------------

describe("rag_rule_variable wiring", () => {
  test("for each staged rule, join rows equal the parsed condition_expr var set exactly", () => {
    for (const row of ruleRows()) {
      const joined = new Set(
        (db.query("SELECT var_key FROM rag_rule_variable WHERE rule_id = ?").all(row.id) as { var_key: string }[]).map((r) => r.var_key),
      );
      const parsed = collectPredicateVars(parseRule(row));
      expect([...joined].sort(), row.rule_key).toEqual([...parsed].sort()); // no missing, no extra
    }
  });

  test("growth_rate is wired to every rule that references it (the shared-var case)", () => {
    // 0017 wired the two dd rules; 0019 added the two gate-split tam-growth
    // rows (D-M-MKT-9) with the same expr — four wirings now
    const rules = (db
      .query("SELECT rule_id FROM rag_rule_variable WHERE var_key = 'market.growth_rate'")
      .all() as { rule_id: string }[]).map((r) => r.rule_id);
    expect(rules.sort()).toEqual([
      "rule-0017-market-dd-competitive-demerit",
      "rule-0017-market-dd-tam-growth",
      "rule-0019-market-pre-fs-tam-growth",
      "rule-0019-market-screening-tam-growth",
    ].sort());
  });

  test("every join row for the staged rules targets a seeded var (FK-enforced, asserted anyway)", () => {
    const seeded = new Set<string>(SEEDED_VARS);
    const rows = db
      .query("SELECT rv.var_key FROM rag_rule_variable rv JOIN rag_rule r ON r.id = rv.rule_id WHERE r.rule_key LIKE 'market-dd-%'")
      .all() as { var_key: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(seeded.has(row.var_key), row.var_key).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Staging guard — enabled=1 without the governance anchors is a CHECK failure
// ---------------------------------------------------------------------------

describe("staging guard on the market rows", () => {
  test("enabled=1 with both policy_id and thresholds_source NULL is rejected", () => {
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1 WHERE rule_key = 'market-dd-switching-cost'"),
    ).toThrow(/CHECK constraint failed/);
  });

  test("enabled=1 with only one anchor present is still rejected (the CHECK requires BOTH)", () => {
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1, thresholds_source = 'D-MX-1 2026-99-99' WHERE rule_key = 'market-dd-tam-growth'"),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1, policy_id = 'gov-nonexistent' WHERE rule_key = 'market-dd-right-to-win'"),
    ).toThrow(/CHECK constraint failed/);
  });

  test("even a CHECK-satisfying enablement fails on the policy FK — governance_doc has no citable row yet", () => {
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1, policy_id = 'gov-nonexistent', thresholds_source = 'D-MX-1 2026-99-99' WHERE rule_key = 'market-dd-bargaining-power'"),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("the failed UPDATEs left every staged row still disabled", () => {
    for (const row of ruleRows()) expect(row.enabled, row.rule_key).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Runner idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing; 0017 is recorded in schema_migrations", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped).toContain("0017_market_evidence_layer.sql");
    expect(skipped.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);

    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0017_market_evidence_layer.sql");
    // and the seed sets survived untouched — 0017's five staged rules + 10 vars
    // (counts scoped to 0017's own rows per the 0014→0017 knock-on precedent;
    // 0019's additional market rows are pinned in migration-0019.test.ts)
    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE id LIKE 'rule-0017-%'").get() as { c: number }).c).toBe(5);
    expect((db.query("SELECT COUNT(*) AS c FROM evidence_var WHERE var_key LIKE 'market.%' OR var_key LIKE 'right_to_win.%'").get() as { c: number }).c).toBe(10);
  });
});
