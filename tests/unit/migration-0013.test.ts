/**
 * Unit tests for migration 0013 (classification infrastructure) — design of
 * record docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decisions 3, 5b, 5c, 5d. Runs against a real scratch SQLite file (same
 * pattern as migration-0012.test.ts) so the CHECK/FK/UNIQUE constraints —
 * including the two partial "live-row" unique indexes — are exercised by
 * SQLite itself, not mocked.
 *
 * PR-4 is schema-only by design: no repository code reads these tables yet
 * (that proof is PR-5, same release window). These tests pin the shapes and
 * constraint semantics so PR-5 builds against a contract that cannot drift.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0013.sqlite";
const SURVIVAL_DB_PATH = "db/data/test-migration-0013-survival.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const NOW = "2026-08-22T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let runId: string;

/** Decision 3's column set, in declaration order — the shape contract. */
const DIMENSION_INPUT_COLUMNS = [
  "id", "run_id", "project_id", "var_key", "value_kind", "value_text",
  "value_num", "unit", "evidence_ref", "asserted_by", "reviewed_by",
  "rationale", "observed_at", "superseded_by",
] as const;

/** Decision 5b's column set, in declaration order. */
const CLASSIFICATION_COLUMNS = [
  "id", "project_id", "case_type", "origin", "technology_track",
  "classified_by", "approver_role", "approved_by", "approved_at",
  "classified_at", "rationale", "superseded_by",
] as const;

const HYPOTHESIS_COLUMNS = [
  "id", "project_id", "run_id", "asset_or_stock", "stake_type",
  "instrument_mix", "vehicle", "commercialization_path",
  "tax_structure_note", "liability_isolation_note",
  "financing_leverage_note", "exit_structure_note",
  "four_axis_review_completed", "hypothesized_by", "hypothesized_at", "rationale",
] as const;

/** Migration 0006's column set — the (e) rebuild must preserve it exactly.
 * (0016 later APPENDS invalidated_at + invalidated_by_classification — the
 * post-0016 live shape; the rebuild-preservation claim under test is that the
 * first ten columns and their order are untouched.) */
const COMPLIANCE_CHECK_COLUMNS = [
  "id", "project_id", "gate", "rule_key", "layer", "result", "detail",
  "waiver_id", "detected_at", "resolved_at", "invalidated_at", "invalidated_by_classification",
] as const;

function insertProject(currentStageGate?: string): string {
  const id = ulid();
  if (currentStageGate === undefined) {
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  } else {
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate) VALUES (?,?,?,?)", [id, `NP-${id.slice(-6)}`, NOW, currentStageGate]);
  }
  return id;
}

function insertRun(pid: string = projectId): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, pid, `hash-${id.slice(-6)}`, "user-001", NOW]);
  return id;
}

function insertEvidenceVar(varKey: string, overrides: Record<string, unknown> = {}): void {
  const base: Record<string, unknown> = {
    var_key: varKey,
    label_ko: "단언 변수",
    value_type: "string",
    source_kind: "asserted",
    created_at: NOW,
    ...overrides,
  };
  const cols = Object.keys(base);
  db.run(
    `INSERT INTO evidence_var (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(base) as never[],
  );
}

function insertDimensionInput(varKey: string, overrides: Record<string, unknown> = {}): string {
  const id = ulid();
  const base: Record<string, unknown> = {
    id,
    run_id: runId,
    project_id: projectId,
    var_key: varKey,
    value_kind: "text",
    value_text: "asserted value",
    evidence_ref: "source.pdf#p3",
    asserted_by: "user-001",
    rationale: "judgement input with citation",
    observed_at: NOW,
    ...overrides,
  };
  const cols = Object.keys(base);
  db.run(
    `INSERT INTO dimension_input (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(base) as never[],
  );
  return id;
}

function insertClassification(overrides: Record<string, unknown> = {}): string {
  const id = ulid();
  const base: Record<string, unknown> = {
    id,
    project_id: projectId,
    case_type: "greenfield",
    origin: "external",
    classified_by: "user-001",
    classified_at: NOW,
    rationale: "external origin — enlarges the validator set",
    ...overrides,
  };
  const cols = Object.keys(base);
  db.run(
    `INSERT INTO project_case_classification (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(base) as never[],
  );
  return id;
}

function insertHypothesis(overrides: Record<string, unknown> = {}): string {
  const id = ulid();
  const base: Record<string, unknown> = {
    id,
    project_id: projectId,
    hypothesized_by: "user-001",
    hypothesized_at: NOW,
    rationale: "early structure hypothesis",
    ...overrides,
  };
  const cols = Object.keys(base);
  db.run(
    `INSERT INTO deal_structure_hypothesis (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(base) as never[],
  );
  return id;
}

function insertComplianceCheck(result: string, overrides: Record<string, unknown> = {}): string {
  const id = ulid();
  const base: Record<string, unknown> = {
    id,
    project_id: projectId,
    gate: "fs",
    rule_key: `rule-${id.slice(-6)}`,
    layer: "policy",
    result,
    detected_at: NOW,
    ...overrides,
  };
  const cols = Object.keys(base);
  db.run(
    `INSERT INTO compliance_check (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(base) as never[],
  );
  return id;
}

function tableColumns(table: string): { name: string; type: string; dflt_value: string | null; notnull: number }[] {
  return db.query(`PRAGMA table_info(${table})`).all() as never[];
}

function indexSql(table: string): { name: string; sql: string | null }[] {
  return db.query(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`).all() as never[];
}

/**
 * Mark `oldId` superseded by `newId` and make `newId` the live row. The
 * successor must already exist as a NON-live row (superseded_by set at
 * insert, so the partial live index does not fire); then the predecessor
 * retires first (its FK on superseded_by is satisfied — the successor
 * exists), and only then does the successor go live into the freed slot.
 * Reversing the two UPDATEs trips the partial unique index. PR-5's
 * repository will wrap this shape in one transaction.
 */
function supersede(table: string, oldId: string, newId: string): void {
  db.run(`UPDATE ${table} SET superseded_by = ? WHERE id = ?`, [newId, oldId]);
  db.run(`UPDATE ${table} SET superseded_by = NULL WHERE id = ?`, [newId]);
}

/** Register a fresh evidence var so each test owns its (project, var) slot. */
function freshVar(): string {
  const key = `t_${ulid().slice(-8).toLowerCase()}`;
  insertEvidenceVar(key);
  return key;
}

beforeAll(() => {
  for (const p of [TEST_DB_PATH, SURVIVAL_DB_PATH]) {
    if (existsSync(p)) rmSync(p);
  }
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = insertProject();
  runId = insertRun();
  // right_to_win.customer_overlap needs no fixture insert since migration 0017
  // seeds it (the var_key is now a PK-conflicting duplicate); the dimension_input
  // rows below only need the var to EXIST for the FK.
  insertEvidenceVar("market.competitive_intensity", { label_ko: "경쟁강도", value_type: "number", unit: "ratio" });
  insertEvidenceVar("market.entry_barrier_grade", { label_ko: "진입장벽 등급" });
});

afterAll(() => {
  resetDb();
  for (const base of [TEST_DB_PATH, SURVIVAL_DB_PATH]) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = base + suffix;
      if (existsSync(p)) rmSync(p);
    }
  }
});

// ---------------------------------------------------------------------------
// Shape contract — exact Decision-DDL equality, 0012-test style
// ---------------------------------------------------------------------------

describe("shape: four new tables + md_project.current_stage_gate", () => {
  test("dimension_input column set matches Decision 3 exactly (order included)", () => {
    expect(tableColumns("dimension_input").map((c) => c.name)).toEqual([...DIMENSION_INPUT_COLUMNS]);
    const byName = new Map(tableColumns("dimension_input").map((c) => [c.name, c]));
    expect(byName.get("value_num")).toMatchObject({ type: "NUMERIC" });
    expect(byName.get("run_id")).toMatchObject({ notnull: 1 });
    expect(byName.get("reviewed_by")).toMatchObject({ notnull: 0 }); // application-layer gate (PR-5), nullable at DB
  });

  test("project_case_classification column set matches Decision 5b exactly", () => {
    expect(tableColumns("project_case_classification").map((c) => c.name)).toEqual([...CLASSIFICATION_COLUMNS]);
    const track = tableColumns("project_case_classification").find((c) => c.name === "technology_track")!;
    expect(track.dflt_value).toBe("'none'");
  });

  test("deal_structure_hypothesis column set matches the DDL (ADR-0045 axes + shape axes)", () => {
    expect(tableColumns("deal_structure_hypothesis").map((c) => c.name)).toEqual([...HYPOTHESIS_COLUMNS]);
    const review = tableColumns("deal_structure_hypothesis").find((c) => c.name === "four_axis_review_completed")!;
    expect(review.dflt_value).toBe("0");
    expect(review).toMatchObject({ type: "INTEGER", notnull: 1 });
  });

  test("compliance_check column set/order survives the 4-step rebuild unchanged", () => {
    expect(tableColumns("compliance_check").map((c) => c.name)).toEqual([...COMPLIANCE_CHECK_COLUMNS]);
  });

  test("md_project keeps current_stage_gate as its fourth column (Decision 5c)", () => {
    // Migration 0047 later appended company_id (synergy/project-company
    // binding), 0033's PK rebuild preserved column order, and ADR-0095's
    // 0063 appended origin / source_opportunity_id / track (promotion
    // foundation). The 0013 contract being pinned here: current_stage_gate
    // lands fourth, in order.
    expect(tableColumns("md_project").map((c) => c.name)).toEqual([
      "id", "project_no", "created_at", "current_stage_gate", "company_id",
      "origin", "source_opportunity_id", "track",
    ]);
  });

  test("the three new indexes exist, live-row indexes are partial UNIQUE", () => {
    const di = indexSql("dimension_input");
    expect(di.map((i) => i.name)).toEqual(expect.arrayContaining(["idx_dimension_input_live", "idx_dimension_input_project"]));
    const diLive = di.find((i) => i.name === "idx_dimension_input_live")!;
    expect(diLive.sql).toMatch(/UNIQUE INDEX/i);
    expect(diLive.sql).toMatch(/WHERE superseded_by IS NULL/i);

    const pcc = indexSql("project_case_classification");
    expect(pcc.map((i) => i.name)).toContain("idx_case_classification_live");
    const pccLive = pcc.find((i) => i.name === "idx_case_classification_live")!;
    expect(pccLive.sql).toMatch(/UNIQUE INDEX/i);
    expect(pccLive.sql).toMatch(/WHERE superseded_by IS NULL/i);

    expect(indexSql("compliance_check").map((i) => i.name)).toContain("idx_compliance_check");
  });
});

// ---------------------------------------------------------------------------
// dimension_input — value-kind XOR CHECK + live-row partial unique + FKs
// ---------------------------------------------------------------------------

describe("dimension_input value-kind XOR CHECK", () => {
  test("a num row with value_text set is rejected", () => {
    expect(() =>
      insertDimensionInput("market.competitive_intensity", { value_kind: "num", value_num: 0.42, value_text: "0.42", unit: "ratio" }),
    ).toThrow(/CHECK constraint failed/);
  });

  test("a num row with value_num NULL is rejected", () => {
    expect(() =>
      insertDimensionInput("market.competitive_intensity", { value_kind: "num", value_text: null, unit: "ratio" }),
    ).toThrow(/CHECK constraint failed/);
  });

  test("a text row with value_num set is rejected", () => {
    expect(() =>
      insertDimensionInput("market.entry_barrier_grade", { value_kind: "text", value_text: "high", value_num: 3 }),
    ).toThrow(/CHECK constraint failed/);
  });

  test("all three valid forms insert (num / text / bool)", () => {
    insertDimensionInput("market.competitive_intensity", { value_kind: "num", value_num: 0.42, value_text: null, unit: "ratio" });
    insertDimensionInput("market.entry_barrier_grade", { value_kind: "text", value_text: "high", value_num: null });
    insertDimensionInput("right_to_win.customer_overlap", { value_kind: "bool", value_text: "true", value_num: null });
  });

  test("value_kind outside {num,text,bool} is rejected", () => {
    expect(() => insertDimensionInput(freshVar(), { value_kind: "float" })).toThrow(/CHECK constraint failed/);
  });
});

describe("dimension_input live-row partial unique index", () => {
  test("a second live row for the same (project_id, var_key) is rejected", () => {
    const varKey = freshVar();
    insertDimensionInput(varKey);
    expect(() => insertDimensionInput(varKey)).toThrow(/UNIQUE constraint failed/);
  });

  test("superseding the live row frees the slot; history never blocks re-assertion", () => {
    const varKey = freshVar();
    const oldId = insertDimensionInput(varKey);
    // successor is born non-live (superseded_by points at the predecessor),
    // so the partial index does not fire on insert
    const newId = ulid();
    db.run(
      "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, evidence_ref, asserted_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [newId, runId, projectId, varKey, "text", "very high", "source.pdf#p7", "user-002", "revised after review", NOW, oldId],
    );
    supersede("dimension_input", oldId, newId);
    let live = db
      .query("SELECT id FROM dimension_input WHERE project_id = ? AND var_key = ? AND superseded_by IS NULL")
      .all(projectId, varKey) as { id: string }[];
    expect(live.map((r) => r.id)).toEqual([newId]);
    expect((db.query("SELECT superseded_by FROM dimension_input WHERE id = ?").get(oldId) as { superseded_by: string }).superseded_by).toBe(newId);

    // a third assertion supersedes the second the same way — history rows
    // (superseded_by set) never block re-assertion
    const thirdId = ulid();
    db.run(
      "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, evidence_ref, asserted_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [thirdId, runId, projectId, varKey, "text", "moderate", "source.pdf#p9", "user-003", "second revision", NOW, newId],
    );
    supersede("dimension_input", newId, thirdId);
    live = db
      .query("SELECT id FROM dimension_input WHERE project_id = ? AND var_key = ? AND superseded_by IS NULL")
      .all(projectId, varKey) as { id: string }[];
    expect(live.map((r) => r.id)).toEqual([thirdId]);
    const total = (db.query("SELECT COUNT(*) AS c FROM dimension_input WHERE var_key = ?").get(varKey) as { c: number }).c;
    expect(total).toBe(3); // full history retained, exactly one live
  });
});

describe("dimension_input foreign keys", () => {
  test("run_id, project_id, var_key must all reference existing rows", () => {
    expect(() => insertDimensionInput(freshVar(), { run_id: "01NOSUCHRUN00000000" })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertDimensionInput(freshVar(), { project_id: "01NOSUCHPROJECT0001" })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertDimensionInput("no_such_var")).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("superseded_by must reference an existing dimension_input", () => {
    const id = ulid();
    expect(() =>
      db.run(
        "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, evidence_ref, asserted_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [id, runId, projectId, freshVar(), "text", "x", "ref", "user-001", "r", NOW, "01NOSUCHDIMINPUT01"],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// project_case_classification — enum CHECKs + one-live-per-project + self-FK
// ---------------------------------------------------------------------------

describe("project_case_classification enum CHECKs", () => {
  test("bad case_type / origin / technology_track are rejected", () => {
    expect(() => insertClassification({ project_id: insertProject(), case_type: "bluefield" })).toThrow(/CHECK constraint failed/);
    expect(() => insertClassification({ project_id: insertProject(), origin: "jv" })).toThrow(/CHECK constraint failed/); // 'joint' is the JV value (overturn 5)
    expect(() => insertClassification({ project_id: insertProject(), technology_track: "rnd" })).toThrow(/CHECK constraint failed/);
  });

  test("technology_track defaults to 'none' and all four origins insert", () => {
    for (const origin of ["internal", "external", "hybrid", "joint"]) {
      const pid = insertProject();
      const id = insertClassification({ project_id: pid, origin });
      const row = db.query("SELECT origin, technology_track FROM project_case_classification WHERE id = ?").get(id) as { origin: string; technology_track: string };
      expect(row.origin).toBe(origin);
      expect(row.technology_track).toBe("none");
    }
  });

  test("approver columns are nullable at DB level (origin-conditional approval is PR-5's gate)", () => {
    const id = insertClassification({ project_id: insertProject(), origin: "internal" });
    const row = db.query("SELECT approver_role, approved_by, approved_at FROM project_case_classification WHERE id = ?").get(id) as Record<string, string | null>;
    expect(row.approver_role).toBeNull();
    expect(row.approved_by).toBeNull();
    expect(row.approved_at).toBeNull();
  });
});

describe("project_case_classification live-row partial unique index", () => {
  test("two live rows for the same project are rejected; superseding frees the slot", () => {
    const pid = insertProject();
    const first = insertClassification({ project_id: pid });
    expect(() => insertClassification({ project_id: pid })).toThrow(/UNIQUE constraint failed/);

    const second = ulid();
    db.run(
      "INSERT INTO project_case_classification (id, project_id, case_type, origin, technology_track, classified_by, classified_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?,?,?)",
      [second, pid, "brownfield", "hybrid", "none", "user-002", NOW, "re-classified after DD", first],
    );
    supersede("project_case_classification", first, second);
    const live = db.query("SELECT id, case_type FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL").get(pid) as { id: string; case_type: string };
    expect(live).toEqual({ id: second, case_type: "brownfield" });
  });

  test("superseded_by must reference an existing classification row (self-FK)", () => {
    const pid = insertProject();
    expect(() =>
      db.run(
        "INSERT INTO project_case_classification (id, project_id, case_type, origin, technology_track, classified_by, classified_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?,?,?)",
        [ulid(), pid, "greenfield", "external", "none", "user-001", NOW, "r", "01NOSUCHCLASSIF001"],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// deal_structure_hypothesis — optional axes, strict enums, default-0 review
// ---------------------------------------------------------------------------

describe("deal_structure_hypothesis", () => {
  test("a minimal row (all five axis enums NULL) inserts; four_axis_review_completed defaults to 0", () => {
    const id = insertHypothesis();
    const row = db.query("SELECT asset_or_stock, stake_type, instrument_mix, vehicle, commercialization_path, four_axis_review_completed FROM deal_structure_hypothesis WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row.asset_or_stock).toBeNull();
    expect(row.stake_type).toBeNull();
    expect(row.instrument_mix).toBeNull();
    expect(row.vehicle).toBeNull();
    expect(row.commercialization_path).toBeNull();
    expect(row.four_axis_review_completed).toBe(0);
  });

  test("bad enum values are rejected on every axis", () => {
    expect(() => insertHypothesis({ asset_or_stock: "swap" })).toThrow(/CHECK constraint failed/);
    expect(() => insertHypothesis({ stake_type: "plurality" })).toThrow(/CHECK constraint failed/);
    expect(() => insertHypothesis({ instrument_mix: "tertiary" })).toThrow(/CHECK constraint failed/);
    expect(() => insertHypothesis({ vehicle: "trust" })).toThrow(/CHECK constraint failed/);
    expect(() => insertHypothesis({ commercialization_path: "acquire" })).toThrow(/CHECK constraint failed/);
  });

  test("FR-RBD-07 / FR-RBD-12 enum members insert (internal_venture_spinoff, minority_venture_investment)", () => {
    insertHypothesis({ vehicle: "internal_venture_spinoff", commercialization_path: "minority_venture_investment", asset_or_stock: "mixed", stake_type: "joint_control", instrument_mix: "mixed" });
  });

  test("four_axis_review_completed outside {0,1} is rejected; project/run FKs are enforced", () => {
    expect(() => insertHypothesis({ four_axis_review_completed: 2 })).toThrow(/CHECK constraint failed/);
    expect(() => insertHypothesis({ project_id: "01NOSUCHPROJECT0002" })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertHypothesis({ run_id: "01NOSUCHRUN00000001" })).toThrow(/FOREIGN KEY constraint failed/);
    insertHypothesis({ run_id: runId }); // nullable, but a valid run_id attaches
  });
});

// ---------------------------------------------------------------------------
// compliance_check — Decision 5d: result += 'not_applicable' via rebuild
// ---------------------------------------------------------------------------

describe("compliance_check result extension", () => {
  test("'not_applicable' inserts, and all four pre-0013 values still do", () => {
    for (const result of ["pass", "blocked", "reason_required", "waived", "not_applicable"]) {
      insertComplianceCheck(result);
    }
    expect(() => insertComplianceCheck("skipped")).toThrow(/CHECK constraint failed/);
  });

  test("the layer CHECK and project FK survived the rebuild intact", () => {
    expect(() => insertComplianceCheck("pass", { layer: "statute" })).toThrow(/CHECK constraint failed/);
    expect(() => insertComplianceCheck("pass", { project_id: "01NOSUCHPROJECT0003" })).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("a seeded pre-0013 row survives the rebuild byte-identical", () => {
    // The runner cannot do partial migration (fixed migrations dir), so this
    // builds the pre-0013 state honestly: execute the REAL 0001..0012 files
    // in filename order on a scratch WAL DB (client.ts connection — same
    // statement path and schema_migrations bookkeeping as db/migrate.ts),
    // seed one old-shape compliance_check row, then let the REAL runner
    // apply 0013 (and anything newer, in filename order) and read the row
    // back. The `f < "0013"` filter keeps the scratch DB at exactly
    // pre-0013 state regardless of how many migrations ship later.
    resetDb();
    const sdb = getDb(SURVIVAL_DB_PATH);
    sdb.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f < "0013").sort();
    for (const file of files) {
      sdb.run(readFileSync(join(MIGRATIONS_DIR, file), "utf-8"));
      sdb.run("INSERT INTO schema_migrations (id, filename, applied_at) VALUES (?, ?, ?)", [file, file, NOW]);
    }

    const pid = ulid();
    sdb.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [pid, `NP-${pid.slice(-6)}`, NOW]);
    const seedId = ulid();
    const seed = {
      id: seedId,
      project_id: pid,
      gate: "pre_fs",
      rule_key: "bf-12",
      layer: "checklist",
      result: "blocked", // old 4-value enum
      detail: "투자차량 구조화 4축 미검토 — bf-12 위반",
      waiver_id: ulid(),
      detected_at: "2026-08-21T09:00:00Z",
      resolved_at: "2026-08-21T15:30:00Z",
    };
    sdb.run(
      "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, waiver_id, detected_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [seed.id, seed.project_id, seed.gate, seed.rule_key, seed.layer, seed.result, seed.detail, seed.waiver_id, seed.detected_at, seed.resolved_at],
    );
    const before = sdb.query("SELECT * FROM compliance_check WHERE id = ?").get(seedId);

    const { applied } = runMigrations(SURVIVAL_DB_PATH);
    expect(applied[0]).toBe("0013_classification_infra.sql"); // first in filename order; later migrations may follow

    const after = sdb.query("SELECT * FROM compliance_check WHERE id = ?").get(seedId);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // byte-identical serialization, Korean text included
    expect((after as { result: string }).result).toBe("blocked");

    // restore the main test singleton (and the module-level handle) for the
    // describes that follow this one — the old handle was closed by resetDb
    resetDb();
    db = getDb(TEST_DB_PATH);
  });
});

// ---------------------------------------------------------------------------
// md_project.current_stage_gate — Decision 5c
// ---------------------------------------------------------------------------

describe("md_project.current_stage_gate", () => {
  test("NULL is allowed (pre-backfill state) and every named gate inserts", () => {
    const nullGate = insertProject();
    expect((db.query("SELECT current_stage_gate FROM md_project WHERE id = ?").get(nullGate) as { current_stage_gate: string | null }).current_stage_gate).toBeNull();
    for (const gate of ["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic"]) {
      insertProject(gate);
    }
  });

  test("a gate outside the six-value enum is rejected", () => {
    expect(() => insertProject("idea")).toThrow(/CHECK constraint failed/);
    expect(() => insertProject("IC")).toThrow(/CHECK constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// Migration runner idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing and skips every present migration", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped).toContain("0013_classification_infra.sql");
    expect(skipped.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length); // directory-derived — future migrations must not break this pin
  });

  test("0013 is recorded in schema_migrations", () => {
    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0013_classification_infra.sql");
  });
});
