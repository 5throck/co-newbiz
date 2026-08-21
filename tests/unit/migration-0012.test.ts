/**
 * Unit tests for migration 0012 (rag_rule rebuild + evidence registry +
 * certification transferability columns) — design of record
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decisions 1 & 2. Runs against a real scratch SQLite file (same pattern as
 * governance-engines.test.ts) so the CHECK/FK/UNIQUE constraints are
 * exercised by SQLite itself, not mocked.
 *
 * The DROP of the old rag_rule was verified safe pre-migration: 0 rows on a
 * fresh-migrated DB and 0 SQL readers repo-wide. These tests pin the NEW
 * shape so any future drift from Decision 1 fails loudly.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0012.sqlite";
const NOW = "2026-08-22T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let docId: string;

/** Decision 1's column set, in declaration order — the shape contract. */
const RAG_RULE_COLUMNS = [
  "id", "rule_key", "version", "stage_gate", "dimension", "grade",
  "condition_expr", "priority", "enabled", "policy_id", "thresholds_source", "created_at",
] as const;

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

function insertGovernanceDoc(): string {
  const id = ulid();
  db.run(
    "INSERT INTO governance_doc (id, layer, key, title, version, enforceability, owner_agent, doc_path, effective_from) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, "policy", "neb-policy", "Group New-Business Review Policy", "v1.0", "mandatory", "process-governance-manager", "policies/group/neb-policy.md", NOW],
  );
  return id;
}

type RuleOverrides = Partial<Record<"id" | "rule_key" | "version" | "stage_gate" | "dimension" | "grade" | "condition_expr" | "priority" | "enabled" | "policy_id" | "thresholds_source" | "created_at", unknown>>;

function insertRule(overrides: RuleOverrides = {}): void {
  const cols: string[] = [];
  const vals: unknown[] = [];
  const base: Record<string, unknown> = {
    id: ulid(),
    rule_key: `rule-${ulid().slice(-6)}`,
    stage_gate: "fs",
    dimension: "financial",
    grade: "red",
    condition_expr: '{"op":"cmp","var":"irr_over_hurdle_pp","cmp":"lt","value":0}',
    priority: 10,
    created_at: NOW,
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) {
    cols.push(k);
    vals.push(v);
  }
  db.run(
    `INSERT INTO rag_rule (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    vals as never[],
  );
}

function insertEvidenceVar(varKey: string, overrides: Record<string, unknown> = {}): void {
  const base: Record<string, unknown> = {
    var_key: varKey,
    label_ko: "IRR 허들 초과폭",
    value_type: "number",
    unit: "pp",
    source_kind: "computed",
    created_at: NOW,
    ...overrides,
  };
  const cols = Object.keys(base);
  db.run(
    `INSERT INTO evidence_var (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(base) as never[],
  );
}

function tableColumns(table: string): { name: string; type: string; dflt_value: string | null; notnull: number }[] {
  return db.query(`PRAGMA table_info(${table})`).all() as never[];
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = insertProject();
  docId = insertGovernanceDoc();
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// (a) certification transferability columns
// ---------------------------------------------------------------------------

describe("certification transferability columns", () => {
  test("all five columns exist with the Decision-1 types", () => {
    const byName = new Map(tableColumns("certification").map((c) => [c.name, c]));
    expect([...byName.keys()]).toEqual([
      "id", "project_id", "name", "agency", "statutory_days", "status",
      "transferability_basis", "transferable_on_coc", "transferability_evidence_ref",
      "load_bearing", "confirmed_at",
    ]);
    expect(byName.get("transferability_basis")).toMatchObject({ type: "TEXT" });
    expect(byName.get("transferable_on_coc")).toMatchObject({ type: "TEXT" });
    expect(byName.get("transferability_evidence_ref")).toMatchObject({ type: "TEXT" });
    expect(byName.get("load_bearing")).toMatchObject({ type: "INTEGER" });
    expect(byName.get("confirmed_at")).toMatchObject({ type: "TEXT" });
  });

  test("a pre-existing-shape insert (no new columns named) backfills load_bearing = 0", () => {
    const id = ulid();
    db.run("INSERT INTO certification (id, project_id, name) VALUES (?,?,?)", [id, projectId, "ISO 9001"]);
    const row = db.query("SELECT load_bearing, transferability_basis FROM certification WHERE id = ?").get(id) as { load_bearing: number; transferability_basis: string | null };
    expect(row.load_bearing).toBe(0);
    expect(row.transferability_basis).toBeNull();
  });

  test("transferability_basis accepts both enum values at DB level and rejects anything else", () => {
    // 'inferred' is legal AT THE DATABASE LEVEL by design: the DB records the
    // basis; the hard block on circulating an inference is the repository
    // write layer (PR-3, non-negotiable boundary #5) — layering under test.
    for (const basis of ["verified", "inferred"]) {
      const id = ulid();
      db.run("INSERT INTO certification (id, project_id, name, transferability_basis) VALUES (?,?,?,?)", [id, projectId, "Cert-" + basis, basis]);
      expect((db.query("SELECT transferability_basis FROM certification WHERE id = ?").get(id) as { transferability_basis: string }).transferability_basis).toBe(basis);
    }
    expect(() =>
      db.run("INSERT INTO certification (id, project_id, name, transferability_basis) VALUES (?,?,?,?)", [ulid(), projectId, "Cert-bad", "guessed"]),
    ).toThrow(/CHECK constraint failed/);
  });

  test("load_bearing rejects values outside {0,1}", () => {
    expect(() =>
      db.run("INSERT INTO certification (id, project_id, name, load_bearing) VALUES (?,?,?,?)", [ulid(), projectId, "Cert-lb", 2]),
    ).toThrow(/CHECK constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// (b) rag_rule rebuild — anti-tamper CHECK (design Decision 1, staging 1-2)
// ---------------------------------------------------------------------------

describe("rag_rule enabled-gating CHECK", () => {
  test("enabled=0 with no policy_id succeeds — disabled is the default state", () => {
    insertRule({ enabled: 0 });
  });

  test("omitting enabled defaults to 0 (old table defaulted to 1 — the flip is the point)", () => {
    const id = ulid();
    insertRule({ id });
    const row = db.query("SELECT enabled, version FROM rag_rule WHERE id = ?").get(id) as { enabled: number; version: number };
    expect(row.enabled).toBe(0);
    expect(row.version).toBe(1);
  });

  test("enabled=1 with NULL policy_id is rejected", () => {
    expect(() => insertRule({ enabled: 1, thresholds_source: "rag-framework.md §5" })).toThrow(/CHECK constraint failed/);
  });

  test("enabled=1 with NULL thresholds_source is rejected", () => {
    expect(() => insertRule({ enabled: 1, policy_id: docId })).toThrow(/CHECK constraint failed/);
  });

  test("enabled=1 with both policy_id and thresholds_source succeeds", () => {
    insertRule({ enabled: 1, policy_id: docId, thresholds_source: "rag-framework.md §5" });
  });

  test("enabled outside {0,1} is rejected", () => {
    expect(() => insertRule({ enabled: 2 })).toThrow(/CHECK constraint failed/);
  });

  test("enum CHECKs reject a bad stage_gate / dimension / grade", () => {
    expect(() => insertRule({ stage_gate: "idea" })).toThrow(/CHECK constraint failed/);
    expect(() => insertRule({ dimension: "esg" })).toThrow(/CHECK constraint failed/);
    expect(() => insertRule({ grade: "blue" })).toThrow(/CHECK constraint failed/);
  });
});

describe("rag_rule UNIQUE(rule_key, version)", () => {
  test("a second row with the same (rule_key, version) is rejected; a bumped version is not", () => {
    const key = `unique-${ulid().slice(-6)}`;
    insertRule({ rule_key: key });
    expect(() => insertRule({ rule_key: key })).toThrow(/UNIQUE constraint failed/);
    insertRule({ rule_key: key, version: 2 });
    const count = (db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE rule_key = ?").get(key) as { c: number }).c;
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// FK enforcement (PRAGMA foreign_keys=ON is set on every connection by
// db/client.ts — these constraints are real, not advisory)
// ---------------------------------------------------------------------------

describe("foreign keys", () => {
  test("rag_rule.policy_id must reference an existing governance_doc", () => {
    expect(() =>
      insertRule({ enabled: 1, policy_id: "01NOSUCHGOVERNANCEDOC", thresholds_source: "x" }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("rag_rule_variable rejects an unknown var_key and an unknown rule_id; a valid pair inserts", () => {
    insertEvidenceVar("irr_over_hurdle_pp");
    const ruleId = ulid();
    insertRule({ id: ruleId });

    expect(() =>
      db.run("INSERT INTO rag_rule_variable (rule_id, var_key) VALUES (?,?)", [ruleId, "no_such_var"]),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      db.run("INSERT INTO rag_rule_variable (rule_id, var_key) VALUES (?,?)", ["01NOSUCHRULE", "irr_over_hurdle_pp"]),
    ).toThrow(/FOREIGN KEY constraint failed/);

    db.run("INSERT INTO rag_rule_variable (rule_id, var_key) VALUES (?,?)", [ruleId, "irr_over_hurdle_pp"]);
    const rows = db.query("SELECT rule_id, var_key FROM rag_rule_variable WHERE rule_id = ?").all(ruleId);
    expect(rows).toEqual([{ rule_id: ruleId, var_key: "irr_over_hurdle_pp" }]);
  });

  test("evidence_var enum CHECKs reject bad value_type / unit / source_kind", () => {
    expect(() => insertEvidenceVar("bad_type", { value_type: "float" })).toThrow(/CHECK constraint failed/);
    expect(() => insertEvidenceVar("bad_unit", { unit: "percent" })).toThrow(/CHECK constraint failed/);
    expect(() => insertEvidenceVar("bad_kind", { source_kind: "guessed" })).toThrow(/CHECK constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// DROP safety — the old definition is gone, the new one matches Decision 1
// ---------------------------------------------------------------------------

describe("rag_rule shape (old table dropped, Decision-1 shape in place)", () => {
  test("column set matches Decision 1 exactly and no old-shape artifact survives", () => {
    // Old shape (0006): id, stage_gate, dimension, grade, condition_expr,
    // priority, enabled, policy_id — no rule_key/version/thresholds_source/
    // created_at, and enabled DEFAULT 1. Exact-list equality proves both the
    // additions and that nothing stale lingered through the DROP+CREATE.
    expect(tableColumns("rag_rule").map((c) => c.name)).toEqual([...RAG_RULE_COLUMNS]);
    const enabled = tableColumns("rag_rule").find((c) => c.name === "enabled")!;
    expect(enabled.dflt_value).toBe("0"); // the anti-tamper default flip
  });

  test("the Decision-1 indexes exist (unique key index + lookup index)", () => {
    const idx = db
      .query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rag_rule'")
      .all() as { name: string; sql: string | null }[];
    const names = idx.map((i) => i.name);
    expect(names).toContain("idx_rag_rule_key");
    expect(names).toContain("idx_rag_rule");
    const uniqueIdx = idx.find((i) => i.name === "idx_rag_rule_key")!;
    expect(uniqueIdx.sql).toMatch(/UNIQUE INDEX/i);
  });

  test("rag_rule_variable index exists for the reverse rename-impact lookup", () => {
    const idx = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rag_rule_variable'")
      .all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain("idx_rag_rule_variable_var");
  });
});

// ---------------------------------------------------------------------------
// Migration runner idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing and skips all 12", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped).toContain("0012_rag_rule_rebuild_and_evidence_var.sql");
    expect(skipped.length).toBe(12);
  });

  test("0012 is recorded in schema_migrations", () => {
    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows[rows.length - 1].filename).toBe("0012_rag_rule_rebuild_and_evidence_var.sql");
    expect(rows.length).toBe(12);
  });
});
