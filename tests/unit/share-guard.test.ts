// @version 1.0.0
/**
 * ADR-0179 slice 3 - sourced-market-share labelling and the Y1-revenue vs
 * plan-investment ratio plausibility guard (design 2026-10-16 §6.1, §7.1).
 * Covers: the unsourced-share display label and the display-side provenance
 * rewrite (default -> label, person-confirmed passes through), the run-note
 * fragment (`; share_unsourced=1`, appended ONLY for a market-anchored run on
 * the bare-default capture rate), the ratio band check (strictly above 20x;
 * zero/negative/junk never trips), the live read-model flag resolved from the
 * latest valuation model's stored snapshot, an end-to-end generation where
 * the fragments fire AND one where they do not (bit-identity surface), and
 * the never-block contract: a tripping guard leaves result.status "done".
 * Scratch SQLite + deterministic agents. ASCII-only source (Korean via \u).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-share-guard.sqlite";
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
const sg = await import("../../app/web-next/lib/share-guard.ts");

const NOW = new Date().toISOString();
const ACTOR = "share-analyst";
let projectId = "";

function makeGreenfieldProject(): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "share opp", "scope", "selected", ACTOR, NOW, JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "r", ACTOR, NOW]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ACTOR, NOW]);
  }
  db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "s", "a", "r", ACTOR, NOW, NOW, null]);
  return promoteOpportunity(oppId, { promotedBy: ACTOR, needToKnowBasis: "t" }).project.id;
}
const p50Row = (pid: string, scenario = "base") =>
  db.query("SELECT note FROM valuation_simulation WHERE project_id = ? AND scenario = ? AND percentile = 'p50' ORDER BY created_at DESC, id DESC").get(pid, scenario) as { note: string };
const params = (pid: string, p: Record<string, number>, rationale: string) =>
  gen.recordBusinessCaseParams(db, { projectId: pid, params: p as never, rationale, actor: ACTOR });

beforeAll(async () => {
  await createUser(db, { userId: ACTOR, role: "analyst", password: "pw-share-analyst-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ACTOR, approvedBy: "test", now: NOW });
  projectId = makeGreenfieldProject();
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("share label vocabulary", () => {
  test("the unsourced label spells the rate out; the provenance rewrite only touches the bare default", () => {
    expect(sg.SHARE_UN_SOURCED_LABEL).toBe("근거 없는 기본 점유율");
    expect(sg.shareUnsourcedLabel(0.005)).toBe("근거 없는 기본 점유율 (0.5%)");
    expect(sg.isShareUnsourced("기본값")).toBe(true);
    expect(sg.isShareUnsourced("user confirmed")).toBe(false);
    expect(sg.isShareUnsourced(null)).toBe(false);
    expect(sg.captureSourceLabel("기본값", 0.005)).toBe("근거 없는 기본 점유율 (0.5%)");
    expect(sg.captureSourceLabel("user confirmed (bc.capture_rate)", 0.005)).toBe("user confirmed (bc.capture_rate)");
    expect(sg.captureSourceLabel(null, 0.005)).toBe("");
  });

  test("the note fragment fires ONLY for a market-anchored run on the bare default", () => {
    expect(sg.shareUnsourcedNoteFragment(false, "기본값")).toBe("; share_unsourced=1");
    expect(sg.shareUnsourcedNoteFragment(false, "person set")).toBe("");
    expect(sg.shareUnsourcedNoteFragment(true, "기본값")).toBe(""); // anchored cases have no share
    expect(sg.shareUnsourcedNoteFragment(true, null)).toBe("");
  });
});

describe("ratioGuardTripped", () => {
  test("strictly above the threshold; boundaries and junk input never trip", () => {
    expect(sg.ratioGuardTripped(300, 10)).toBe(true); // 30x
    expect(sg.ratioGuardTripped(200, 10)).toBe(false); // exactly 20x: not over
    expect(sg.ratioGuardTripped(201, 10)).toBe(true); // 20.1x: just over
    expect(sg.ratioGuardTripped(300, 10, 25)).toBe(true); // custom threshold
    expect(sg.ratioGuardTripped(300, 10, 30)).toBe(false); // inclusive threshold line
    expect(sg.ratioGuardTripped(0, 10)).toBe(false);
    expect(sg.ratioGuardTripped(-5, 10)).toBe(false);
    expect(sg.ratioGuardTripped(300, 0)).toBe(false); // zero investment: no trip
    expect(sg.ratioGuardTripped(300, -1)).toBe(false);
    expect(sg.ratioGuardTripped(null, 10)).toBe(false);
    expect(sg.ratioGuardTripped(Number.NaN, 10)).toBe(false);
    expect(sg.ratioGuardTripped(300, Number.NaN)).toBe(false);
    expect(sg.ratioGuardTripped(undefined, undefined)).toBe(false);
  });
});

describe("resolveRatioGuardFlag (read model over the stored snapshot)", () => {
  test("null without a model, null on unparsable JSON, tripped flag on a real snapshot", () => {
    expect(sg.resolveRatioGuardFlag(db, "no-such-project")).toBeNull();
    const modelId = ulid();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
      [modelId, projectId, "valuation", "junk", 5, ACTOR, NOW, "{not json"]);
    expect(sg.resolveRatioGuardFlag(db, projectId)).toBeNull();
    // a snapshot the guard trips on: y1 3000 / inv 100 = 30x
    const snapId = ulid();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
      [snapId, projectId, "valuation", "tripper", 5, ACTOR, NOW, JSON.stringify({ cases: [{ drivers: { revenue_y1: { value: 3000 }, initial_investment: { value: 100, source: "ratio" } } }] })]);
    const flag = sg.resolveRatioGuardFlag(db, projectId)!;
    expect(flag.tripped).toBe(true);
    expect(flag.ratio).toBeCloseTo(30, 5);
    expect(flag.threshold).toBe(sg.Y1_INVESTMENT_RATIO_THRESHOLD);
    expect(flag.y1_revenue_krw_m).toBe(3000);
    expect(flag.investment_krw_m).toBe(100);
    expect(flag.investment_source).toBe("ratio");
    expect(flag.label).toContain("점검"); // check-the-anchor wording
    // below the line: recorded but not tripped
    const calmId = ulid();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
      [calmId, projectId, "valuation", "calm", 5, ACTOR, NOW, JSON.stringify({ cases: [{ drivers: { revenue_y1: { value: 3000 }, initial_investment: { value: 200 } } }] })]);
    const calm = sg.resolveRatioGuardFlag(db, projectId)!; // latest created wins
    expect(calm.tripped).toBe(false);
    expect(calm.ratio).toBeCloseTo(15, 5);
  });
});

describe("end-to-end generation", () => {
  test("default capture rate: the note stamps share_unsourced=1 and generation completes (never blocks)", async () => {
    const result = await gen.generateBusinessCases(projectId, { actor: ACTOR, source: "agent" });
    expect(result.status).toBe("done");
    const row = p50Row(projectId);
    expect(row.note).toContain("; share_unsourced=1");
    expect(row.note).not.toContain("ratio_guard="); // 1/0.5 = 2x: far below the line
    // the year-1 revenue driver labels the share as unsourced too
    expect(row.note).toContain("capture_source=기본값");
    // p05/p95 share the note string (it describes the run, not the point)
    const p05 = db.query("SELECT note FROM valuation_simulation WHERE project_id = ? AND scenario = 'base' AND percentile = 'p05' ORDER BY created_at DESC, id DESC").get(projectId) as { note: string };
    expect(p05.note).toBe(row.note);
  });

  test("person-set capture rate: the fragment disappears (bit-identity surface) and the source is recorded", async () => {
    await params(projectId, { capture_rate: 0.05 }, "analyst-sourced share");
    const result = await gen.generateBusinessCases(projectId, { actor: ACTOR, source: "agent" });
    expect(result.status).toBe("done");
    const row = p50Row(projectId);
    expect(row.note).not.toContain("share_unsourced");
    expect(row.note).toContain("capture_rate=0.05; capture_source=");
    expect(row.note).not.toContain("근거 없는");
  });

  test("ratio guard: 1/0.04 = 25x trips the note fragment while generation still completes", async () => {
    await params(projectId, { initial_investment_ratio: 0.04 }, "stress ratio");
    const result = await gen.generateBusinessCases(projectId, { actor: ACTOR, source: "agent" });
    expect(result.status).toBe("done"); // never blocks
    const row = p50Row(projectId);
    expect(row.note).toContain("; ratio_guard=25");
    const flag = sg.resolveRatioGuardFlag(db, projectId)!;
    expect(flag.tripped).toBe(true);
    expect(flag.ratio).toBeCloseTo(25, 3);
  });
});
