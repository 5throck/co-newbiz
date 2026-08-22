// @version 1.0.0
/**
 * Unit tests for db/lib/applies-when.ts (PR-5a — fact-based antitrust gating
 * + applies_when evaluation) — design of record
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decision 5e / reversal #6 and Decision 7.
 *
 * The 12-row acceptance matrix from the PR-5a spec §7 is THE contract: each
 * row is a named test, rows 1-9 evaluate the REAL predicates loaded from the
 * procedure schema.yaml files (not restatements), against a real scratch
 * SQLite DB so the two resolver families and the 0013/0014 constraints
 * (partial live indexes, reviewed_by gate, FKs) are exercised by SQLite
 * itself — same pattern as migration-0013.test.ts.
 *
 * Row 1 is the reversal-#6 regression guard: origin=internal PLUS an
 * asserted, reviewed external-market-presence fact MUST still run the HHI
 * pre-screen. The permissive direction (origin label suppresses the screen)
 * is the exact bug class this work stream exists to kill.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { parsePredicate, type Predicate, type VarLookup, type VarSnapshot } from "../../db/lib/predicate.ts";
import {
  evaluateAppliesWhen,
  resolveRoutingVars,
  renderEn,
  collectPredicateVars,
  ROUTING_VAR_KEYS,
  type ApplicabilityDecision,
} from "../../db/lib/applies-when.ts";
import { checkAppliesWhen, seededVarKeys } from "../../procedures/_validate.ts";

const TEST_DB_PATH = "db/data/test-applies-when.sqlite";
const PROJECT_ROOT = join(import.meta.dirname, "../..");
const NOW = "2026-08-23T00:00:00.000Z"; // millis included: Date.toISOString() form, so evaluated_at round-trips exactly
const FIXED_NOW = new Date(NOW);

type Db = ReturnType<typeof GetDb>;
let db: Db;

// ---------------------------------------------------------------------------
// The REAL predicates, loaded from the procedure files that declare them
// ---------------------------------------------------------------------------

function loadDoc(rel: string): Record<string, unknown> {
  return yaml.load(readFileSync(join(PROJECT_ROOT, rel), "utf-8"), { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
}

function stepPredicate(procDir: string, stepId: number): Predicate {
  const doc = loadDoc(`procedures/_shared/${procDir}/schema.yaml`);
  const step = (doc.steps as { id: number; applies_when: unknown }[]).find((s) => s.id === stepId);
  if (!step || step.applies_when === undefined) throw new Error(`${procDir} step ${stepId} has no applies_when`);
  return parsePredicate(step.applies_when);
}

function procedurePredicate(procDir: string): Predicate {
  const doc = loadDoc(`procedures/_shared/${procDir}/schema.yaml`);
  if (doc.applies_when === undefined) throw new Error(`${procDir} has no procedure-level applies_when`);
  return parsePredicate(doc.applies_when);
}

/** brownfield-screening step 3 — the fact-gated HHI pre-screen (Decision 5e). */
const HHI_PRED = stepPredicate("brownfield-screening", 3);
/** brownfield-screening step 1 — origin-gated target longlist. */
const LONGLIST_PRED = stepPredicate("brownfield-screening", 1);
/** greenfield-pre-fs step 1 — the classification-cell 9/10 pre-feasibility gate. */
const PRE_FS_PRED = stepPredicate("greenfield-pre-fs", 1);
/** entity-establishment-execution — procedure-level, the deliberate exception direction. */
const ESTABLISHMENT_PRED = procedurePredicate("entity-establishment-execution");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

function insertRun(pid: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, pid, `hash-${id.slice(-6)}`, "user-001", NOW]);
  return id;
}

function classify(pid: string, origin: string): void {
  db.run(
    "INSERT INTO project_case_classification (id, project_id, case_type, origin, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?)",
    [ulid(), pid, "brownfield", origin, "user-001", NOW, `test classification — origin ${origin}`]
  );
}

/**
 * Assert the external-market-presence fact. `reviewed` false leaves
 * reviewed_by NULL (the Decision 3 cross-domain review boundary); `retire`
 * leaves NO live row (asserted, then superseded with no live successor).
 */
function assertFact(pid: string, value: boolean, opts: { reviewed?: boolean; retire?: boolean } = {}): void {
  const runId = insertRun(pid);
  const id = ulid();
  db.run(
    "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, value_num, evidence_ref, asserted_by, reviewed_by, rationale, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, runId, pid, "target.has_external_market_presence", "bool", String(value), null, "source.pdf#p3", "user-001", opts.reviewed === false ? null : "user-002", "carve-out sells to external customers", NOW]
  );
  if (opts.retire) {
    // successor born non-live (points at the predecessor), then the
    // predecessor retires — end state: history only, no live row
    const successor = ulid();
    db.run(
      "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, value_num, evidence_ref, asserted_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [successor, runId, pid, "target.has_external_market_presence", "bool", String(!value), null, "source.pdf#p9", "user-003", "re-assertion pending review", NOW, id]
    );
    db.run("UPDATE dimension_input SET superseded_by = ? WHERE id = ?", [successor, id]);
  }
}

/** Evaluate one predicate against the routing resolver for a project. */
function decide(pred: Predicate, procedure: string, step: number | string | null, pid: string): ApplicabilityDecision {
  return evaluateAppliesWhen({ procedure, step }, pred, resolveRoutingVars(pid, db), { now: FIXED_NOW });
}

const hhi = (pid: string) => decide(HHI_PRED, "shared-brownfield-screening", 3, pid);
const longlist = (pid: string) => decide(LONGLIST_PRED, "shared-brownfield-screening", 1, pid);
const preFs = (pid: string) => decide(PRE_FS_PRED, "shared-greenfield-pre-fs", 1, pid);
const establishment = (pid: string) => decide(ESTABLISHMENT_PRED, "shared-entity-establishment-execution", null, pid);

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
// Acceptance matrix rows 1-9 — the routing decisions, on the real predicates
// ---------------------------------------------------------------------------

describe("PR-5a acceptance matrix (spec §7)", () => {
  test("row 1 — origin=internal + market_presence=true (reviewed, live): HHI step APPLIES (reversal #6 regression guard)", () => {
    const pid = insertProject();
    classify(pid, "internal");
    assertFact(pid, true, { reviewed: true });
    const d = hhi(pid);
    expect(d.applies).toBe(true);
    expect(d.basis).toBe("predicate-true");
  });

  test("row 2 — origin=internal + market_presence=false: HHI SKIPS with rendered reason", () => {
    const pid = insertProject();
    classify(pid, "internal");
    assertFact(pid, false, { reviewed: true });
    const d = hhi(pid);
    expect(d.applies).toBe(false);
    expect(d.basis).toBe("predicate-false");
    expect(d.rendered_reason_ko.length).toBeGreaterThan(0);
    expect(d.rendered_reason_en).toContain("target.has_external_market_presence");
  });

  test("row 3 — origin=external: HHI applies regardless of the fact var (the predicate reads NO origin — the label cannot suppress the screen)", () => {
    // Structural guard first: the HHI predicate's only var is the FACT.
    expect([...collectPredicateVars(HHI_PRED)]).toEqual(["target.has_external_market_presence"]);
    // unassessed fact -> fail-closed applies
    const unassessed = insertProject();
    classify(unassessed, "external");
    expect(hhi(unassessed)).toMatchObject({ applies: true, basis: "unassessed-fail-closed" });
    // fact true -> applies
    const present = insertProject();
    classify(present, "external");
    assertFact(present, true, { reviewed: true });
    expect(hhi(present)).toMatchObject({ applies: true, basis: "predicate-true" });
    // the ONLY skip path is the asserted-reviewed fact being false — origin
    // plays no role in it (row 2 asserts the internal side of this)
    const denied = insertProject();
    classify(denied, "external");
    assertFact(denied, false, { reviewed: true });
    expect(hhi(denied).applies).toBe(false);
  });

  test("row 4 — market_presence asserted but reviewed_by NULL: UNASSESSED -> HHI applies with the applied-by-default note", () => {
    const pid = insertProject();
    classify(pid, "internal");
    assertFact(pid, false, { reviewed: false }); // even a FALSE unreviewed assertion must not produce a skip
    const d = hhi(pid);
    expect(d.applies).toBe(true);
    expect(d.basis).toBe("unassessed-fail-closed");
    expect(d.rendered_reason_ko).toContain("기본 적용");
    expect(d.rendered_reason_en).toContain("applied-by-default");
  });

  test("row 5 — market_presence superseded (no live row): same as row 4", () => {
    const pid = insertProject();
    classify(pid, "internal");
    assertFact(pid, true, { reviewed: true, retire: true });
    const d = hhi(pid);
    expect(d.applies).toBe(true);
    expect(d.basis).toBe("unassessed-fail-closed");
    expect(d.rendered_reason_en).toContain("applied-by-default");
  });

  test("row 6 — no live classification row: longlist applies (fail-closed), pre-FS gate applies (fail-closed), establishment does NOT apply (predicate-FALSE via the is_null guard)", () => {
    const pid = insertProject(); // no classify() call — unclassified project
    expect(longlist(pid)).toMatchObject({ applies: true, basis: "unassessed-fail-closed" });
    expect(preFs(pid)).toMatchObject({ applies: true, basis: "unassessed-fail-closed" });
    // THE deliberate exception direction (spec §7 row 6): establishment must
    // NOT fire for an unclassified project — and the skip is predicate-false
    // (the is_null guard forces FALSE through all_of's FALSE domination),
    // NOT the fail-closed apply every other gate takes.
    const est = establishment(pid);
    expect(est.applies).toBe(false);
    expect(est.basis).toBe("predicate-false");
    // the companion control is the kill criterion, asserted where declared:
    const doc = loadDoc("procedures/_shared/entity-establishment-execution/schema.yaml");
    const kc = (doc.kill_criteria as { condition: string; action: string }[]).find((k) => k.condition === "origin_classification_missing_at_entity_ic_exit");
    expect(kc?.action).toBe("halt");
  });

  test("row 7 — origin=internal: longlist SKIPS w/ reason; pre-FS gate applies; establishment applies", () => {
    const pid = insertProject();
    classify(pid, "internal");
    const l = longlist(pid);
    expect(l.applies).toBe(false);
    expect(l.basis).toBe("predicate-false");
    expect(l.rendered_reason_en).toContain("project.origin");
    expect(preFs(pid)).toMatchObject({ applies: true, basis: "predicate-true" });
    expect(establishment(pid)).toMatchObject({ applies: true, basis: "predicate-true" });
  });

  test("row 8 — origin=external: longlist applies; pre-FS gate skips; establishment skips", () => {
    const pid = insertProject();
    classify(pid, "external");
    expect(longlist(pid)).toMatchObject({ applies: true, basis: "predicate-true" });
    expect(preFs(pid)).toMatchObject({ applies: false, basis: "predicate-false" });
    expect(establishment(pid)).toMatchObject({ applies: false, basis: "predicate-false" });
  });

  test("row 9 — origin=joint: establishment applies", () => {
    const pid = insertProject();
    classify(pid, "joint");
    expect(establishment(pid)).toMatchObject({ applies: true, basis: "predicate-true" });
  });

  test("rows 1-9 companion — hybrid origin: longlist applies, pre-FS gate skips, establishment skips (in-list FALSE)", () => {
    const pid = insertProject();
    classify(pid, "hybrid");
    expect(longlist(pid).applies).toBe(true);
    expect(preFs(pid).applies).toBe(false);
    expect(establishment(pid)).toMatchObject({ applies: false, basis: "predicate-false" });
  });

  test("Decision 7 marking — internal-origin origin-driven skips read needs-judgement; fact-driven and external skips do not", () => {
    // positive: the longlist skip for an internal-origin project is the
    // design's "내부기원 프로젝트의 skip" case — until PR-9 lands the
    // internal-pathway content, the record must say "not yet judged"
    const internalPid = insertProject();
    classify(internalPid, "internal");
    const l = longlist(internalPid);
    expect(l.applies).toBe(false);
    expect(l.basis).toBe("predicate-false");
    expect(l.rendered_reason_ko).toContain("needs-judgement");
    expect(l.rendered_reason_ko).toContain("아직 판단 안 됨");
    expect(l.rendered_reason_en).toContain("needs-judgement");
    expect(l.rendered_reason_en).toContain("not yet judged");
    // negative 1: a FACT-driven skip on the same internal project takes no
    // marker — a reviewed false assertion is an honest "not applicable"
    assertFact(internalPid, false, { reviewed: true });
    const h = hhi(internalPid);
    expect(h.applies).toBe(false);
    expect(h.rendered_reason_en).not.toContain("needs-judgement");
    // negative 2: origin-driven but EXTERNAL — establishment / pre-FS skips
    // rest on a classified external label, no marker
    const externalPid = insertProject();
    classify(externalPid, "external");
    expect(establishment(externalPid).applies).toBe(false);
    expect(establishment(externalPid).rendered_reason_en).not.toContain("needs-judgement");
    expect(preFs(externalPid).applies).toBe(false);
    expect(preFs(externalPid).rendered_reason_en).not.toContain("needs-judgement");
  });

  test("decision shape: procedure/step identity and injectable evaluated_at", () => {
    const pid = insertProject();
    const d = establishment(pid);
    expect(d.procedure).toBe("shared-entity-establishment-execution");
    expect(d.step).toBeNull();
    expect(d.evaluated_at).toBe(NOW);
    expect(hhi(pid).step).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Row 10-11 — validator pass + Kleene edge (pure)
// ---------------------------------------------------------------------------

describe("PR-5a acceptance matrix rows 10-11 (pure)", () => {
  const SEEDED = seededVarKeys(readFileSync(join(PROJECT_ROOT, "db/migrations/0014_routing_vars.sql"), "utf-8"));

  test("row 10 — free-text applies_when is an ERROR in the validator pass", () => {
    const issues = checkAppliesWhen("x.yaml", "procedure-level", "origin = 'internal' (cell 9/10)", SEEDED);
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("free text");
  });

  test("row 10 — unknown var_key is an ERROR", () => {
    const issues = checkAppliesWhen("x.yaml", "steps[0] (id 1)", { op: "in", var: "target.not_seeded", values: [true] }, SEEDED);
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("target.not_seeded");
  });

  test("row 10 — a valid AST over seeded vars produces no issues (and the three real files all pass)", () => {
    expect(checkAppliesWhen("x.yaml", "procedure-level", { op: "cmp", var: "project.origin", cmp: "eq", value: "internal" }, SEEDED)).toEqual([]);
    expect(checkAppliesWhen("x.yaml", "p", HHI_PRED, SEEDED)).toEqual([]);
    expect(checkAppliesWhen("x.yaml", "p", LONGLIST_PRED, SEEDED)).toEqual([]);
    expect(checkAppliesWhen("x.yaml", "p", PRE_FS_PRED, SEEDED)).toEqual([]);
    expect(checkAppliesWhen("x.yaml", "p", ESTABLISHMENT_PRED, SEEDED)).toEqual([]);
  });

  test("row 10 — the seed reader: real migration yields the four routing keys; INSERT-less SQL yields nothing", () => {
    expect([...SEEDED].sort()).toEqual([
      "project.case_type",
      "project.origin",
      "project.technology_track",
      "target.has_external_market_presence",
    ]);
    expect(seededVarKeys("-- no seeds here\nCREATE TABLE x (id TEXT);\n").size).toBe(0);
  });

  test("row 11 — Kleene edge: any_of [FALSE, UNASSESSED] = UNASSESSED -> APPLIES (fail-closed)", () => {
    const snapshots: Record<string, VarSnapshot> = {
      f: { status: "present", value: 0 },
      u: { status: "missing" },
    };
    const lookup: VarLookup = (k) => snapshots[k];
    const pred: Predicate = { op: "any_of", of: [
      { op: "cmp", var: "f", cmp: "eq", value: 1 }, // FALSE
      { op: "cmp", var: "u", cmp: "eq", value: 1 }, // UNASSESSED
    ] };
    const d = evaluateAppliesWhen({ procedure: "p", step: 1 }, pred, lookup, { now: FIXED_NOW });
    expect(d.applies).toBe(true);
    expect(d.basis).toBe("unassessed-fail-closed");
    expect(d.rendered_reason_en).toContain("applied-by-default");
    expect(d.rendered_reason_ko).toContain("기본 적용");
  });

  test("renderEn mirrors the AST in English identifier vocabulary (in / cmp / nested composites)", () => {
    expect(renderEn(LONGLIST_PRED)).toContain("project.origin in ['external', 'hybrid', 'joint']");
    expect(renderEn(PRE_FS_PRED)).toContain("project.origin = 'internal'");
    const en = renderEn(ESTABLISHMENT_PRED);
    expect(en).toContain("all of:");
    expect(en).toContain("project.origin is null");
  });
});

// ---------------------------------------------------------------------------
// Row 12 — resolver families + the no-dynamic-SQL audit
// ---------------------------------------------------------------------------

describe("PR-5a acceptance matrix row 12 — resolver: two families only, no dynamic SQL", () => {
  test("family (a) is the SOLE source for project.* — a dimension_input row on project.origin cannot hijack routing", () => {
    const pid = insertProject();
    classify(pid, "internal");
    // a live, reviewed assertion on the classification var's key — legal at
    // the DB level (0014 seeds project.origin) but invisible to routing
    const runId = insertRun(pid);
    db.run(
      "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, value_num, evidence_ref, asserted_by, reviewed_by, rationale, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [ulid(), runId, pid, "project.origin", "text", "external", null, "source.pdf#p1", "user-001", "user-002", "attempted hijack", NOW]
    );
    const lookup = resolveRoutingVars(pid, db);
    expect(lookup("project.origin")).toEqual({ status: "present", value: "internal" });
  });

  test("family (b) serves ONLY the asserted fact key; every other key resolves undefined (= missing)", () => {
    const pid = insertProject();
    assertFact(pid, true, { reviewed: true });
    const lookup = resolveRoutingVars(pid, db);
    expect(lookup(ROUTING_VAR_KEYS.externalMarketPresence)).toEqual({ status: "present", value: true });
    expect(lookup("project.origin")).toBeUndefined();
    expect(lookup("something.else.entirely")).toBeUndefined();
  });

  test("static string audit — the module contains no template-literal SQL with interpolation", () => {
    const source = readFileSync(join(PROJECT_ROOT, "db/lib/applies-when.ts"), "utf-8");
    const templateLiterals = source.match(/`[^`]*`/g) ?? [];
    expect(templateLiterals.length).toBeGreaterThan(0); // the audit itself must be looking at real content
    for (const lit of templateLiterals) {
      const isSql = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(lit);
      expect({ sql: isSql, interpolated: lit.includes("${") }).not.toEqual({ sql: true, interpolated: true });
    }
    // binding discipline: both family queries parameterize the project id
    expect(source).toContain("project_id = ?");
  });
});
