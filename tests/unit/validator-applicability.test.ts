// @version 1.1.0
/**
 * Unit tests for db/lib/validator-applicability.ts (PR-5c §2.1) — the
 * 12-cell × 6-validator applicability matrix (spec §3.1: 84 assertions).
 *
 * STAGE 2 EXPECTATIONS (PR-5c spec §5): the ACTIVE registry — the ADR-0048
 * seed vectors. All ten non-skip cells are all-six (the ADR-0037 default
 * survives); the greenfield+internal family is the only skip family: cell 11
 * (track none) keeps only certification, cell 12 (track rbd) regains
 * contingent-liability (in-bound license / Partner-IP exposure).
 *
 * The typical M&A cell is asserted TWICE (spec §3.1): once at the registry
 * level (synthesized routing snapshots), once through the ENGINE with a real
 * classification row on a real scratch SQLite DB (migration-0013 test
 * pattern) so resolveRoutingVars + the 0013 live index are exercised.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import type { VarLookup, VarSnapshot } from "../../db/lib/predicate.ts";
import {
  MA_VALIDATOR_APPLICABILITY,
  maValidatorRuleKey,
  resolveValidatorApplicability,
  type MaValidatorKey,
} from "../../db/lib/validator-applicability.ts";
import { evaluateValidatorCompleteness } from "../../db/lib/validator-completeness.ts";
import { getLiveClassification } from "../../db/repositories/classification.repository.ts";

const TEST_DB_PATH = "db/data/test-validator-applicability.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const FIXED_NOW = new Date(NOW);

type Db = ReturnType<typeof GetDb>;
let db: Db;

// ---------------------------------------------------------------------------
// The 12-cell matrix — every distinct (case_type, origin, technology_track)
// combination the ADR-0048 seed set distinguishes, brownfield dominance
// included. Expected value = the applicable set under the ACTIVE registry.
// ---------------------------------------------------------------------------

type Cell = { case_type: "greenfield" | "brownfield"; origin: "internal" | "external" | "hybrid" | "joint"; technology_track: "none" | "rbd" };

const CELLS: Cell[] = [
  { case_type: "brownfield", origin: "external", technology_track: "none" }, // 1 — the typical M&A cell
  { case_type: "brownfield", origin: "external", technology_track: "rbd" }, // 2
  { case_type: "brownfield", origin: "internal", technology_track: "none" }, // 3 — brownfield dominates every skip condition
  { case_type: "brownfield", origin: "internal", technology_track: "rbd" }, // 4
  { case_type: "brownfield", origin: "hybrid", technology_track: "none" }, // 5
  { case_type: "brownfield", origin: "joint", technology_track: "rbd" }, // 6
  { case_type: "greenfield", origin: "external", technology_track: "none" }, // 7
  { case_type: "greenfield", origin: "external", technology_track: "rbd" }, // 8
  { case_type: "greenfield", origin: "hybrid", technology_track: "none" }, // 9
  { case_type: "greenfield", origin: "joint", technology_track: "none" }, // 10
  { case_type: "greenfield", origin: "internal", technology_track: "none" }, // 11 — the only big-skip cell
  { case_type: "greenfield", origin: "internal", technology_track: "rbd" }, // 12 — contingent-liability returns on the R&BD track
];

/** Registry order: six core rows + the non-core contingent-liability row (ADR-0185); certification LAST. */
const ALL_SIX: MaValidatorKey[] = ["antitrust", "region-labor", "hr-comp", "customer", "incentive", "contingent-liability", "certification"];
const CORE_SIX: MaValidatorKey[] = ["antitrust", "region-labor", "hr-comp", "customer", "incentive", "certification"];

/** STAGE 2 EXPECTED TABLE — the active ADR-0048 seed vectors, index-aligned with CELLS. */
const EXPECTED_APPLICABLE: MaValidatorKey[][] = [
  [...ALL_SIX], // 1  brownfield/external/none — the typical M&A cell
  [...ALL_SIX], // 2  brownfield/external/rbd
  [...ALL_SIX], // 3  brownfield/internal/none — brownfield dominates every skip condition
  [...ALL_SIX], // 4  brownfield/internal/rbd
  [...ALL_SIX], // 5  brownfield/hybrid/none
  [...ALL_SIX], // 6  brownfield/joint/rbd
  [...ALL_SIX], // 7  greenfield/external/none
  [...ALL_SIX], // 8  greenfield/external/rbd
  [...ALL_SIX], // 9  greenfield/hybrid/none
  [...ALL_SIX], // 10 greenfield/joint/none
  ["certification"], // 11 greenfield/internal/none — the only big-skip cell
  ["contingent-liability", "certification"], // 12 rbd track regains contingent-liability
];

/** A routing snapshot lookup for one cell — the registry input (pure). */
function cellLookup(cell: Cell): VarLookup {
  const snapshots: Record<string, VarSnapshot> = {
    "project.case_type": { status: "present", value: cell.case_type },
    "project.origin": { status: "present", value: cell.origin },
    "project.technology_track": { status: "present", value: cell.technology_track },
  };
  return (varKey: string) => snapshots[varKey];
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
// The 72-cell matrix — registry level (assertion 1 of the typical-cell pair)
// ---------------------------------------------------------------------------

describe("12-cell × 6-validator applicability matrix (registry level)", () => {
  test("each cell asserts all six registry verdicts — 84 assertions, stage-2 form (active ADR-0048 vectors)", () => {
    let assertions = 0;
    CELLS.forEach((cell, i) => {
      const decisions = resolveValidatorApplicability(cellLookup(cell), { now: FIXED_NOW });
      for (const row of MA_VALIDATOR_APPLICABILITY) {
        const decision = decisions.get(row.key)!;
        const expectedApplies = EXPECTED_APPLICABLE[i].includes(row.key);
        expect(
          { cell: `${cell.case_type}/${cell.origin}/${cell.technology_track}`, key: row.key, applies: decision.applies },
        ).toEqual({
          cell: `${cell.case_type}/${cell.origin}/${cell.technology_track}`,
          key: row.key,
          applies: expectedApplies,
        });
        assertions++;
      }
    });
    expect(assertions).toBe(84);
  });

  test("registry has seven rows, exactly six core; contingent-liability is the only non-core row; region-labor is step 6.5", () => {
    expect(MA_VALIDATOR_APPLICABILITY.filter((r) => r.in_core).map((r) => r.key)).toEqual(CORE_SIX);
    expect(MA_VALIDATOR_APPLICABILITY.filter((r) => !r.in_core).map((r) => r.key)).toEqual(["contingent-liability"]);
    expect(MA_VALIDATOR_APPLICABILITY.find((r) => r.key === "region-labor")!.step).toBe(6.5);
  });

  test("region-labor is skipped ONLY for greenfield+internal (both technology tracks)", () => {
    CELLS.forEach((cell) => {
      const decisions = resolveValidatorApplicability(cellLookup(cell), { now: FIXED_NOW });
      const skipped = cell.case_type === "greenfield" && cell.origin === "internal";
      expect(decisions.get("region-labor")!.applies).toBe(!skipped);
      if (skipped) expect(decisions.get("region-labor")!.rendered_reason_ko!.length).toBeGreaterThan(0);
    });
  });

  test("the typical M&A cell (brownfield/external/any track) = ALL SIX — the ADR-0037 default that must survive every edge case", () => {
    for (const track of ["none", "rbd"] as const) {
      const decisions = resolveValidatorApplicability(cellLookup({ case_type: "brownfield", origin: "external", technology_track: track }), { now: FIXED_NOW });
      expect([...MA_VALIDATOR_APPLICABILITY].filter((r) => decisions.get(r.key)!.applies).map((r) => r.key)).toEqual([...ALL_SIX]);
    }
  });
});

// ---------------------------------------------------------------------------
// The typical M&A cell through the ENGINE with a real classification row
// (assertion 2 of the pair) + fail-closed corruption scenarios at the
// registry boundary
// ---------------------------------------------------------------------------

describe("engine-level matrix checks (real classification rows)", () => {
  function insertProject(): string {
    const id = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
    return id;
  }

  function classifyRaw(pid: string, cell: Partial<Cell>): void {
    db.run(
      "INSERT INTO project_case_classification (id, project_id, case_type, origin, technology_track, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), pid, cell.case_type ?? "brownfield", cell.origin ?? "external", cell.technology_track ?? "none", "user-001", NOW, "matrix classification"],
    );
  }

  test("typical M&A cell: a REAL brownfield/external classification row → engine reports applicable_count = 6", () => {
    const pid = insertProject();
    classifyRaw(pid, { case_type: "brownfield", origin: "external", technology_track: "none" });
    expect(getLiveClassification(pid)?.origin).toBe("external"); // the row is genuinely live
    const evaluation = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(evaluation.applicable_count).toBe(6);
    expect(evaluation.validators.filter((v) => v.applies).map((v) => v.key)).toEqual([...ALL_SIX]);
    expect(evaluation.completed_count).toBe(0); // no coverage rows yet — not asserted here, but keeps the record honest
  });

  test("skip cell 11 through the engine: a REAL greenfield/internal/none row → applicable_count = 1 (certification only)", () => {
    const pid = insertProject();
    classifyRaw(pid, { case_type: "greenfield", origin: "internal", technology_track: "none" });
    const evaluation = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(evaluation.applicable_count).toBe(1);
    expect(evaluation.validators.filter((v) => v.applies).map((v) => v.key)).toEqual(["certification"]);
    // the five skipped validators carry rendered skip sentences (registry + Decision-7 note)
    for (const v of evaluation.validators.filter((x) => !x.applies)) {
      expect(v.rendered_reason_ko!.length).toBeGreaterThan(0);
      expect(v.rendered_reason_en!.length).toBeGreaterThan(0);
    }
  });

  test("unclassified project: routing vars missing → fail-closed, all six applicable (no throw)", () => {
    const pid = insertProject();
    const decisions = resolveValidatorApplicability((varKey) => (varKey === "project.origin" ? { status: "missing" } : undefined), { now: FIXED_NOW });
    expect([...MA_VALIDATOR_APPLICABILITY].every((r) => decisions.get(r.key)!.applies)).toBe(true);
    const evaluation = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(evaluation.classification).toBeNull();
    expect(evaluation.applicable_count).toBe(6);
  });

  test("registry is data, not branches: seven rows (six core), fixed order, steps 6-11, rule keys stable", () => {
    expect(MA_VALIDATOR_APPLICABILITY.map((r) => r.key)).toEqual([...ALL_SIX]);
    expect(MA_VALIDATOR_APPLICABILITY.map((r) => r.step)).toEqual([6, 6.5, 7, 8, 9, 10, 11]);
    expect(MA_VALIDATOR_APPLICABILITY.every((r) => r.procedure === "shared-brownfield-dd")).toBe(true);
    expect(MA_VALIDATOR_APPLICABILITY.every((r) => r.rationale.trim().length > 0)).toBe(true); // constraint: every seed row carries rationale text
    for (const key of ALL_SIX) expect(maValidatorRuleKey(key)).toBe(`ma-validator-${key}`);
  });
});
