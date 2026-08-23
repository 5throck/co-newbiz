/**
 * Unit tests for migration 0018 (technical_execution + risk dimension
 * evidence layer) — design of record
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * plan row PR-7 (risk axes per Decision 8), ADR-0046 §5. Real scratch SQLite
 * (the migration-0013/0016/0017 pattern: runMigrations on a temp WAL DB,
 * resetDb in afterAll) so the CHECKs and FKs are exercised by SQLite itself.
 *
 * PR-7 is evidence-layer-only by design — the threshold agendas owned every
 * number, vocabulary, enum, and gate assignment until the records
 * (docs/decisions/technical-execution-thresholds.md and
 * docs/decisions/risk-thresholds.md, 2026-08-23) approved them. These tests
 * pin the exact seed set (the all-computed, zero-asserted property included),
 * the placeholder discipline at its 0018 layer, the join-table wiring (via
 * collectPredicateVars — reuse, not re-implementation), the antitrust
 * exclusion asserted positively, and the staging guard, so the post-meeting
 * PRs build against a contract that cannot drift.
 *
 * 0019 KNOCK-ON (the 0014→0017→0018 lesson, applied again): this file runs
 * the FULL migration chain, and migration 0019 finalized the eight staged
 * rows per the records — placeholders replaced by real scalars, covenant
 * re-graded amber→red with priority 7→5 (D-M-RISK-4 layer 2), partner gate
 * dd→pre_fs with lte 0→lte 1 (D-M-RISK-3), tech priorities restated 2/4/6/7
 * (D-M-TE-8) — and added three new tech rules under other keys. Rule-row
 * assertions are scoped to the rule-0018-* ids; the final values are pinned
 * by tests/unit/migration-0019.test.ts.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { parsePredicate, type Predicate, type Scalar } from "../../db/lib/predicate.ts";
import { collectPredicateVars } from "../../db/lib/applies-when.ts";

const TEST_DB_PATH = "db/data/test-migration-0018.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const NOW = "2026-08-23T10:00:00Z";
const SEED_CREATED_AT = "2026-08-23T00:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

/** The 11 seeded var_keys — every source an existing table/column, hence all computed. */
const SEEDED_VARS = [
  "tech.trl_grade",
  "tech.ip_ownership_status",
  "cert.non_transferable_on_coc",
  "permit.critical_path_duration",
  "permit.unresolved_on_critical_path",
  "risk.contingent_expected_value",
  "risk.contingent_max_amount",
  "risk.contingent_max_probability",
  "risk.covenants_breached",
  "risk.partner_candidates_active",
  "risk.partner_dependency_risk",
] as const;

const SEED_PREFIXES = ["tech.%", "cert.%", "permit.%", "risk.%"] as const;

const STAGED_RULES = [
  "tech-dd-trl-grade",
  "tech-dd-ip-clarity",
  "tech-dd-cert-transferability",
  "tech-dd-permit-critical-path",
  "risk-dd-contingent-expected-value",
  "risk-dd-contingent-two-factor",
  "risk-dd-covenant-breach",
  "risk-dd-partner-sourcing",
] as const;

/**
 * The two rules whose ONLY scalars are count values — zod forces count.value
 * to z.number(), so no string placeholder is possible. They carry the
 * documented degenerate maximal-sensitivity integers (gte 1 / lte 0) and are
 * the sanctioned exceptions to the ≥1-placeholder contract.
 */
const DEGENERATE_COUNT_RULES = new Set(["tech-dd-cert-transferability", "risk-dd-covenant-breach"]);

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

function seededVarWhere(): string {
  // cert.% is a SHARED prefix post-0019 (it seeded
  // cert.load_bearing_non_transferable_on_coc, pinned in
  // migration-0019.test.ts) — exclude that one so this file pins 0018's own 11
  return "(var_key LIKE 'tech.%' OR var_key LIKE 'permit.%' OR var_key LIKE 'risk.%' OR (var_key LIKE 'cert.%' AND var_key != 'cert.load_bearing_non_transferable_on_coc'))";
}

function ruleRows(): RuleRow[] {
  // scoped to 0018's own rows: 0019 added three tech rules under the same
  // rule_key prefixes and restated the staged rows' values per the records
  return db
    .query("SELECT id, rule_key, version, stage_gate, dimension, grade, condition_expr, priority, enabled, policy_id, thresholds_source FROM rag_rule WHERE id LIKE 'rule-0018-%'")
    .all() as never[];
}

/** Parse one staged rule's condition_expr through the REAL gate (PredicateSchema). */
function parseRule(row: RuleRow): Predicate {
  return parsePredicate(JSON.parse(row.condition_expr));
}

/**
 * Deep-walk a parsed AST counting scalar leaves equal to the placeholder
 * marker (the 0017 walker, reused verbatim in shape — value slots only).
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
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// Seed integrity — the 11 evidence_var rows
// ---------------------------------------------------------------------------

describe("evidence_var seeds", () => {
  test("the exact 11-key set is seeded — no more, no fewer", () => {
    const rows = db
      .query(`SELECT var_key FROM evidence_var WHERE ${seededVarWhere()} ORDER BY var_key`)
      .all() as { var_key: string }[];
    expect(rows.map((r) => r.var_key)).toEqual([...SEEDED_VARS].sort());
    // registry total as a LOWER BOUND only — the exact-total pin is the
    // future-coupling hazard 0017 hit twice (0014→0017→here); future
    // migrations may only ADD vars, and 0018's own exact count is pinned by
    // the prefix-scoped key set above
    expect((db.query("SELECT COUNT(*) AS c FROM evidence_var").get() as { c: number }).c).toBeGreaterThanOrEqual(25);
  });

  test("every 0018 var is computed with requires_evidence_ref=0 — ZERO asserted vars this time", () => {
    // unlike market (asserted entry_barrier / right_to_win.*), every source here
    // is an existing table/column, so there is no human-judgement var to assert
    const rows = db
      .query(`SELECT var_key, source_kind, requires_evidence_ref FROM evidence_var WHERE ${seededVarWhere()}`)
      .all() as { var_key: string; source_kind: string; requires_evidence_ref: number }[];
    expect(rows).toHaveLength(11);
    for (const row of rows) {
      expect(row.source_kind, row.var_key).toBe("computed");
      expect(row.requires_evidence_ref, row.var_key).toBe(0);
    }
  });

  test("value_type and unit match the spec table (count-unit vars included)", () => {
    const rows = db
      .query(`SELECT var_key, value_type, unit FROM evidence_var WHERE ${seededVarWhere()}`)
      .all() as { var_key: string; value_type: string; unit: string | null }[];
    const byKey = new Map(rows.map((r) => [r.var_key, r]));
    expect(byKey.get("tech.trl_grade")).toMatchObject({ value_type: "string", unit: null });
    expect(byKey.get("tech.ip_ownership_status")).toMatchObject({ value_type: "string", unit: null });
    expect(byKey.get("cert.non_transferable_on_coc")).toMatchObject({ value_type: "number", unit: "count" });
    expect(byKey.get("permit.critical_path_duration")).toMatchObject({ value_type: "number", unit: "months" });
    expect(byKey.get("permit.unresolved_on_critical_path")).toMatchObject({ value_type: "number", unit: "count" });
    expect(byKey.get("risk.contingent_expected_value")).toMatchObject({ value_type: "number", unit: "krw" });
    expect(byKey.get("risk.contingent_max_amount")).toMatchObject({ value_type: "number", unit: "krw" });
    expect(byKey.get("risk.contingent_max_probability")).toMatchObject({ value_type: "number", unit: "ratio" });
    expect(byKey.get("risk.covenants_breached")).toMatchObject({ value_type: "number", unit: "count" });
    expect(byKey.get("risk.partner_candidates_active")).toMatchObject({ value_type: "number", unit: "count" });
    expect(byKey.get("risk.partner_dependency_risk")).toMatchObject({ value_type: "string", unit: null });
  });

  test("created_at is the SAME fixed literal 0017 used — both seed sets byte-deterministic", () => {
    const rows = db
      .query(`SELECT var_key, created_at FROM evidence_var WHERE ${seededVarWhere()}`)
      .all() as { var_key: string; created_at: string }[];
    expect(rows).toHaveLength(11);
    for (const row of rows) expect(row.created_at, row.var_key).toBe(SEED_CREATED_AT);
  });

  test("antitrust was excluded BY PREMISE at 0018 — ADR-0062 (Class C record) reversed it to exactly ONE tripwire var, still no RAG rule", () => {
    // The 0018 premise held until 2026-08-24: docs/decisions/2026-08-24-class-c-decisions.md
    // reversed it and ADR-0062 scoped the reversal to ONE computed var seeded by
    // migration 0025 — a kill-criteria tripwire, deliberately NOT a grading input.
    const vars = (db.query("SELECT var_key FROM evidence_var WHERE var_key LIKE '%antitrust%'").all() as { var_key: string }[]).map((r) => r.var_key);
    expect(vars).toEqual(["antitrust.presumption_screens_triggered"]);
    // The double-counting guard survives the reversal: no rag_rule grades over it.
    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE condition_expr LIKE '%antitrust%'").get() as { c: number }).c).toBe(0);
    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule_variable WHERE var_key LIKE '%antitrust%'").get() as { c: number }).c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Staged rag_rule skeleton — placeholder discipline
// ---------------------------------------------------------------------------

describe("rag_rule staged skeleton", () => {
  test("exactly eight 0018 rows, dimension split 4 technical_execution + 4 risk, priorities restated by 0019", () => {
    const rows = ruleRows();
    expect(rows.map((r) => r.rule_key).sort()).toEqual([...STAGED_RULES].sort());
    expect(rows.filter((r) => r.dimension === "technical_execution")).toHaveLength(4);
    expect(rows.filter((r) => r.dimension === "risk")).toHaveLength(4);
    // 0019's restatements per the records (final values pinned in
    // migration-0019.test.ts): D-M-TE-8 tech 2/4/6/7 and D-M-RISK-4 layer 2
    // risk 5/6/7/8 — Red before Amber within a dimension
    const byKey = new Map(rows.map((r) => [r.rule_key, r]));
    expect(byKey.get("tech-dd-trl-grade")!.priority).toBe(2);
    expect(byKey.get("tech-dd-ip-clarity")!.priority).toBe(4);
    expect(byKey.get("tech-dd-cert-transferability")!.priority).toBe(6);
    expect(byKey.get("tech-dd-permit-critical-path")!.priority).toBe(7);
    expect(byKey.get("risk-dd-covenant-breach")!.priority).toBe(5);
    expect(byKey.get("risk-dd-contingent-expected-value")!.priority).toBe(6);
    expect(byKey.get("risk-dd-contingent-two-factor")!.priority).toBe(7);
    expect(byKey.get("risk-dd-partner-sourcing")!.priority).toBe(8);
  });

  test("version 1 across the 0022 activation — anchors flipped on, content untouched; gate/grade per the records' restatements", () => {
    for (const row of ruleRows()) {
      expect(row.version, row.rule_key).toBe(1);
      // 0022 (PR-9) activated all eight rows: a data flip with both anchors,
      // not a content change — version stays 1
      expect(row.enabled, row.rule_key).toBe(1);
      expect(row.policy_id, row.rule_key).not.toBeNull();
      expect(row.thresholds_source, row.rule_key).not.toBeNull();
    }
    const byKey = new Map(ruleRows().map((r) => [r.rule_key, r]));
    // 'dd' was the 0018 staging default; D-M-RISK-3 restated partner to pre_fs
    expect(byKey.get("risk-dd-partner-sourcing")!.stage_gate).toBe("pre_fs");
    // amber was the placeholder grade; D-M-RISK-2/4 re-graded covenant Red
    expect(byKey.get("risk-dd-covenant-breach")!.grade).toBe("red");
  });

  test("every condition_expr PARSES under the real PredicateSchema gate", () => {
    for (const row of ruleRows()) {
      expect(() => parseRule(row), row.rule_key).not.toThrow();
    }
  });

  test("no _threshold_placeholder leaf remains — 0019 replaced them with the records' scalars", () => {
    // the ≥1-placeholder contract held while the rows were staged (the two
    // degenerate-count rules excepted); both records filled every scalar in 0019
    for (const row of ruleRows()) {
      expect(countPlaceholderLeaves(parseRule(row)), row.rule_key).toBe(0);
    }
  });

  test("the two count-only rules remain bare gte-1 counts (values confirmed, not degenerate, post-0019)", () => {
    for (const key of DEGENERATE_COUNT_RULES) {
      const row = ruleRows().find((r) => r.rule_key === key)!;
      const parsed = parseRule(row);
      if (parsed.op !== "count") throw new Error(`${key} is not a bare count`);
      expect(parsed.cmp, key).toBe("gte");
      expect(parsed.value, key).toBe(1); // confirmed by D-M-RISK-6 #3 and D-M-TE-8 row 6
    }
  });

  test("collectPredicateVars of every parse is a subset of the 0018 seed set", () => {
    const seeded = new Set<string>(SEEDED_VARS);
    for (const row of ruleRows()) {
      const vars = collectPredicateVars(parseRule(row));
      for (const v of vars) expect(seeded.has(v), `${row.rule_key} references unseeded var ${v}`).toBe(true);
    }
  });

  test("the structures match the agenda §3 shapes (spot-assertions, not just parseability)", () => {
    const byKey = new Map(ruleRows().map((r) => [r.rule_key, r]));
    // tech §3.1: the bare membership form on the TRL grade
    expect(parseRule(byKey.get("tech-dd-trl-grade")!)).toMatchObject({ op: "in", var: "tech.trl_grade" });
    // tech §3.2: in-UNASSIGNED-or-null — the agenda's own sketch, is_null conjunct
    // contested as gate-dependent and re-decided at the meeting
    const ip = parseRule(byKey.get("tech-dd-ip-clarity")!);
    if (ip.op === "any_of") {
      expect(ip.of.map((c) => c.op)).toEqual(["in", "is_null"]);
      expect(ip.of[1]).toMatchObject({ var: "tech.ip_ownership_status" });
    } else {
      throw new Error("tech-dd-ip-clarity is not any_of");
    }
    // tech §3.3(b): duration months branch OR unresolved count
    const permitRule = parseRule(byKey.get("tech-dd-permit-critical-path")!);
    if (permitRule.op === "any_of") {
      expect(permitRule.of[0]).toMatchObject({ var: "permit.critical_path_duration", unit: "months", cmp: "gt" });
      expect(permitRule.of[1]).toMatchObject({ op: "count", var: "permit.unresolved_on_critical_path", cmp: "gte", value: 1 });
    } else {
      throw new Error("tech-dd-permit-critical-path is not any_of");
    }
    // risk §3.1(a): the expected-value form with a krw unit
    expect(parseRule(byKey.get("risk-dd-contingent-expected-value")!)).toMatchObject({
      op: "cmp", var: "risk.contingent_expected_value", cmp: "gte", unit: "krw",
    });
    // risk §3.1(b): the two-factor form — krw AND ratio branches (both forms
    // staged per option (c); the meeting may drop either)
    const twoFactor = parseRule(byKey.get("risk-dd-contingent-two-factor")!);
    if (twoFactor.op === "all_of") {
      expect(twoFactor.of[0]).toMatchObject({ var: "risk.contingent_max_amount", unit: "krw" });
      expect(twoFactor.of[1]).toMatchObject({ var: "risk.contingent_max_probability", unit: "ratio" });
    } else {
      throw new Error("risk-dd-contingent-two-factor is not all_of");
    }
    // risk §3.3: the conjunction — thin pool AND high dependency. The staged
    // lte 0 (degenerate "none exist") was re-decided to lte 1 by D-M-RISK-3
    // ("no alternative" ≡ fewer than two viable candidates)
    const partner = parseRule(byKey.get("risk-dd-partner-sourcing")!);
    if (partner.op === "all_of") {
      expect(partner.of[0]).toMatchObject({ op: "count", var: "risk.partner_candidates_active", cmp: "lte", value: 1 });
      expect(partner.of[1]).toMatchObject({ op: "in", var: "risk.partner_dependency_risk" });
    } else {
      throw new Error("risk-dd-partner-sourcing is not all_of");
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

  test("the ip-clarity rule's in + is_null share ONE join row (composite PK dedups the shared var)", () => {
    const row = ruleRows().find((r) => r.rule_key === "tech-dd-ip-clarity")!;
    const joined = db.query("SELECT var_key FROM rag_rule_variable WHERE rule_id = ?").all(row.id) as { var_key: string }[];
    expect(joined).toEqual([{ var_key: "tech.ip_ownership_status" }]);
  });

  test("11 join rows total for the 0018 rules (0019's three new rules wired separately); every target is a 0018 seed", () => {
    const seeded = new Set<string>(SEEDED_VARS);
    const rows = db
      .query("SELECT rv.var_key FROM rag_rule_variable rv JOIN rag_rule r ON r.id = rv.rule_id WHERE r.id LIKE 'rule-0018-%'")
      .all() as { var_key: string }[];
    expect(rows).toHaveLength(11);
    for (const row of rows) expect(seeded.has(row.var_key), row.var_key).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Staging guard — enabled=1 without the governance anchors is a CHECK failure
// ---------------------------------------------------------------------------

describe("staging guard on the 0018 rows", () => {
  test("enabled=1 with both policy_id and thresholds_source NULL is rejected", () => {
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1, policy_id = NULL, thresholds_source = NULL WHERE rule_key = 'risk-dd-covenant-breach'"),
    ).toThrow(/CHECK constraint failed/);
  });

  test("enabled=1 with only one anchor present is still rejected (the CHECK requires BOTH)", () => {
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1, policy_id = NULL, thresholds_source = 'D-MX-1 2026-99-99' WHERE rule_key = 'tech-dd-trl-grade'"),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1, policy_id = 'gov-nonexistent', thresholds_source = NULL WHERE rule_key = 'risk-dd-partner-sourcing'"),
    ).toThrow(/CHECK constraint failed/);
  });

  test("even a CHECK-satisfying enablement fails on the policy FK — the anchor must name a governance_doc row that exists", () => {
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1, policy_id = 'gov-nonexistent', thresholds_source = 'D-MX-1 2026-99-99' WHERE rule_key = 'tech-dd-permit-critical-path'"),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("the failed UPDATEs rolled back — every 0018 row is still exactly as 0022 activated it", () => {
    for (const row of ruleRows()) {
      expect(row.enabled, row.rule_key).toBe(1);
      expect(row.policy_id, row.rule_key).not.toBeNull();
      expect(row.thresholds_source, row.rule_key).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Runner idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing; 0018 is recorded in schema_migrations", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped).toContain("0018_technical_risk_evidence_layer.sql");
    expect(skipped.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);

    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0018_technical_risk_evidence_layer.sql");
    // and the seed sets survived untouched — 0018's eight rules (scoped to its
    // own ids; 0019's three additions are pinned in migration-0019.test.ts),
    // registry total lower-bounded (see the pin-hazard note above)
    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE id LIKE 'rule-0018-%'").get() as { c: number }).c).toBe(8);
    expect((db.query("SELECT COUNT(*) AS c FROM evidence_var").get() as { c: number }).c).toBeGreaterThanOrEqual(25);
  });
});
