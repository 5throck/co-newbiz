// @version 1.0.0
/**
 * ADR-0179 slice 1 - the IRR ceiling review guard. Band boundaries
 * (inclusive), default thresholds, person-settable thresholds through the
 * bc.* params store (flag must stay above caution), the distributional
 * run-note fragment (`irr_guard=extreme|caution`, appended ONLY when the
 * band trips - legacy notes byte-identical), and display-only semantics:
 * a tripping threshold never blocks generation. Scratch SQLite +
 * deterministic agents. ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-irr-guard.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const guard = await import("../../app/web-next/lib/irr-guard.ts");

const NOW = new Date().toISOString();
const ACTOR = "guard-analyst";
let projectId = "";

function makeGreenfieldProject(): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "guard opp", "scope", "selected", ACTOR, NOW, JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "r", ACTOR, NOW]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ACTOR, NOW]);
  }
  db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "s", "a", "r", ACTOR, NOW, NOW, null]);
  return promoteOpportunity(oppId, { promotedBy: ACTOR, needToKnowBasis: "t" }).project.id;
}
const p50Row = (pid: string, scenario = "base") =>
  db.query("SELECT irr, note FROM valuation_simulation WHERE project_id = ? AND scenario = ? AND percentile = 'p50' ORDER BY created_at DESC, id DESC").get(pid, scenario) as { irr: number | null; note: string };
const setThresholds = async (pid: string, flag: number, caution: number) =>
  gen.recordBusinessCaseParams(db, { projectId: pid, params: { irr_flag_threshold: flag, irr_caution_threshold: caution }, rationale: "t", actor: ACTOR });

beforeAll(async () => {
  await createUser(db, { userId: ACTOR, role: "analyst", password: "pw-guard-analyst-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ACTOR, approvedBy: "test", now: NOW });
  projectId = makeGreenfieldProject();
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("irrGuardBand", () => {
  test("bands: extreme above the flag line, caution in between, null below both; boundaries inclusive", () => {
    expect(guard.irrGuardBand(1.0)).toBe("extreme"); // exactly 100%/yr, inclusive
    expect(guard.irrGuardBand(5)).toBe("extreme");
    expect(guard.irrGuardBand(0.9999)).toBe("caution"); // just under the flag line
    expect(guard.irrGuardBand(0.5)).toBe("caution"); // exactly 50%/yr, inclusive
    expect(guard.irrGuardBand(0.4999)).toBeNull();
    expect(guard.irrGuardBand(0)).toBeNull();
  });
  test("custom thresholds move the lines together; junk input is null, never a band", () => {
    expect(guard.irrGuardBand(0.3, 0.25, 0.2)).toBe("extreme");
    expect(guard.irrGuardBand(0.22, 0.25, 0.2)).toBe("caution");
    expect(guard.irrGuardBand(0.19, 0.25, 0.2)).toBeNull();
    expect(guard.irrGuardBand(null)).toBeNull();
    expect(guard.irrGuardBand(Number.NaN)).toBeNull();
  });
  test("labels and the diagnostic pointer are the display vocabulary", () => {
    expect(guard.IRR_GUARD_CHIP_LABEL.extreme).toBe("\uadf9\ub2e8\uac12 \u2014 \uac80\ud1a0 \ud544\uc694");
    expect(guard.IRR_GUARD_CHIP_LABEL.caution).toBe("주의");
    expect(guard.IRR_GUARD_DIAGNOSTIC).toContain("시장 범위");
  });
});

describe("person-settable thresholds", () => {
  test("defaults resolve as ratios: flag 1.0 (100%/yr), caution 0.5 (50%/yr)", () => {
    const d = gen.resolveBusinessCaseParamsDefaults();
    expect(d.irrFlagThreshold).toBe(guard.IRR_FLAG_THRESHOLD_DEFAULT);
    expect(d.irrCautionThreshold).toBe(guard.IRR_CAUTION_THRESHOLD_DEFAULT);
    const p = gen.resolveBusinessCaseParams(db, projectId);
    expect(p.irrFlagThreshold).toBe(1.0);
    expect(p.irrCautionThreshold).toBe(0.5);
    expect(p.irrFlagThresholdSource).toContain("기본값");
  });

  test("a person's override persists through resolveBusinessCaseParams with a user source", async () => {
    await setThresholds(projectId, 2.5, 1.25); // 250% / 125%
    const p = gen.resolveBusinessCaseParams(db, projectId);
    expect(p.irrFlagThreshold).toBe(2.5);
    expect(p.irrCautionThreshold).toBe(1.25);
    expect(p.irrFlagThresholdSource).not.toContain("기본값");
  });

  test("validation: non-positive flag, negative caution and flag<=caution are rejected", async () => {
    await expect(setThresholds(projectId, 0, 0)).rejects.toThrow(); // flag must be positive
    await expect(setThresholds(projectId, -1, 0)).rejects.toThrow();
    await expect(setThresholds(projectId, 0.5, 0.5)).rejects.toThrow(); // equal
    await expect(setThresholds(projectId, 0.4, 0.5)).rejects.toThrow(); // inverted
    // the rejected writes left the stored values untouched
    const kept = gen.resolveBusinessCaseParams(db, projectId);
    expect(kept.irrFlagThreshold).toBe(2.5);
    expect(kept.irrCautionThreshold).toBe(1.25);
  });
});

describe("run-note fragment", () => {
  test("a tripping threshold appends `irr_guard=...` to the p50 note; generation still completes", async () => {
    await setThresholds(projectId, 0.0001, 0.00001); // any real IRR trips extreme
    const result = await gen.generateBusinessCases(projectId, { actor: ACTOR, source: "agent" });
    expect(result.status).toBe("done");
    const row = p50Row(projectId);
    expect(row.irr).not.toBeNull();
    expect(row.note).toContain("; irr_guard=extreme");
    // p05/p95 rows carry no irr of their own; the note string is shared across
    // the three percentile rows (it describes the run, not the point)
    const p05 = db.query("SELECT irr, note FROM valuation_simulation WHERE project_id = ? AND scenario = 'base' AND percentile = 'p05' ORDER BY created_at DESC, id DESC").get(projectId) as { irr: number | null; note: string };
    expect(p05.irr).toBeNull();
    expect(p05.note).toBe(row.note);
  });

  test("a non-tripping run appends nothing: fragment iff band (thresholds never touch the numbers)", async () => {
    // thresholds chosen ABOVE the observed p50 IRR so the band is guaranteed null
    const observed = p50Row(projectId).irr ?? 0;
    const flag = Math.max(observed, 0) + 10;
    await setThresholds(projectId, flag, flag / 2);
    const result = await gen.generateBusinessCases(projectId, { actor: ACTOR, source: "agent" });
    expect(result.status).toBe("done");
    const row = p50Row(projectId);
    expect(row.irr).not.toBeNull();
    expect(row.irr!).toBeLessThan(flag / 2); // fixture sanity: below the caution line
    expect(row.note).not.toContain("irr_guard=");
    // and the fragment contract in one place: the note carries it exactly when the band fires
    await setThresholds(projectId, 0.0001, 0.00001);
    await gen.generateBusinessCases(projectId, { actor: ACTOR, source: "agent" });
    const tripped = p50Row(projectId);
    expect(tripped.irr).toBe(row.irr); // thresholds never touch the numbers
    expect(guard.irrGuardBand(tripped.irr, 0.0001, 0.00001)).toBe("extreme");
    expect(tripped.note.endsWith("; irr_guard=extreme")).toBe(true);
  });
});
