/**
 * Unit tests for the S7 financial/technical evaluation catalog (ADR-0139).
 * Real scratch SQLite so migration 0103's schema and the lazy-seed logic are
 * exercised by SQLite itself, not mocked.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  listOrSeedCriteria, addCustomCriterion, deleteCriterion, upsertEvalState, targetEvalStates, summarizeEvalStates,
  computeEvalScore, updateCriterionWeight, combinedEvalScore,
} from "../../app/web-next/lib/brownfield-eval-criteria.ts";

const TEST_DB_PATH = "db/data/test-brownfield-eval-criteria.sqlite";
const NOW = "2026-09-15T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
const U1 = "user-analyst";

function insertOpportunity(gapRows: Array<{ capability: string }> | null = null): string {
  const id = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json) VALUES (?,?,?,?,?,?,?)",
    [id, `opp-${id.slice(-6)}`, "테스트 산업", "selected", U1, NOW, gapRows ? JSON.stringify({ rows: gapRows.map((g, i) => ({ id: `gap-${i}`, capability: g.capability })), updatedAt: NOW }) : null],
  );
  return id;
}

function insertTarget(opportunityId: string): string {
  const id = ulid();
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    [id, opportunityId, "테스트 대상", "pending", NOW, NOW],
  );
  return id;
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

describe("listOrSeedCriteria", () => {
  test("seeds 5 builtin financial items and one technical item per S3 gap row", () => {
    const oppId = insertOpportunity([{ capability: "관절 감속기 설계" }, { capability: "돌봄 규제 컴플라이언스" }]);
    const criteria = listOrSeedCriteria(oppId, U1, db);
    const financial = criteria.filter((c) => c.category === "financial");
    const technical = criteria.filter((c) => c.category === "technical");
    expect(financial).toHaveLength(3);
    expect(financial.every((c) => c.source === "builtin" && c.is_deletable === 0)).toBe(true);
    expect(technical).toHaveLength(2);
    expect(technical.map((c) => c.label).sort()).toEqual(["관절 감속기 설계", "돌봄 규제 컴플라이언스"].sort());
    expect(technical.every((c) => c.source === "seeded" && c.is_mandatory === 1 && c.is_deletable === 0)).toBe(true);
  });

  test("empty S3 register seeds no technical items (never fabricates content)", () => {
    const oppId = insertOpportunity(null);
    const criteria = listOrSeedCriteria(oppId, U1, db);
    expect(criteria.filter((c) => c.category === "technical")).toHaveLength(0);
    expect(criteria.filter((c) => c.category === "financial")).toHaveLength(3);
  });

  test("second call does not duplicate seeded rows", () => {
    const oppId = insertOpportunity([{ capability: "A" }]);
    listOrSeedCriteria(oppId, U1, db);
    const second = listOrSeedCriteria(oppId, U1, db);
    expect(second.filter((c) => c.category === "financial")).toHaveLength(3);
    expect(second.filter((c) => c.category === "technical")).toHaveLength(1);
  });
});

describe("addCustomCriterion / deleteCriterion", () => {
  test("custom criteria are deletable until assessed", () => {
    const oppId = insertOpportunity();
    const custom = addCustomCriterion(oppId, "financial", "환율 민감도", null, U1);
    expect(custom.source).toBe("custom");
    expect(custom.is_deletable).toBe(1);

    const result = deleteCriterion(custom.id);
    expect(result.ok).toBe(true);
    const remaining = listOrSeedCriteria(oppId, U1, db).filter((c) => c.id === custom.id);
    expect(remaining).toHaveLength(0);
  });

  test("builtin/seeded criteria cannot be deleted", () => {
    const oppId = insertOpportunity([{ capability: "A" }]);
    const criteria = listOrSeedCriteria(oppId, U1, db);
    const builtin = criteria.find((c) => c.source === "builtin")!;
    const seeded = criteria.find((c) => c.source === "seeded")!;
    expect(deleteCriterion(builtin.id)).toEqual({ ok: false, reason: "not_deletable" });
    expect(deleteCriterion(seeded.id)).toEqual({ ok: false, reason: "not_deletable" });
  });

  test("a custom criterion with a recorded (non-pending) verdict cannot be deleted", () => {
    const oppId = insertOpportunity();
    const targetId = insertTarget(oppId);
    const custom = addCustomCriterion(oppId, "financial", "커스텀 항목", null, U1);
    upsertEvalState(targetId, custom.id, { status: "pass", note: null, evidence_ref: null, assessedBy: U1 });
    expect(deleteCriterion(custom.id)).toEqual({ ok: false, reason: "has_assessment" });
  });

  test("deleting an unknown criterion id reports not_found", () => {
    expect(deleteCriterion("does-not-exist")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("summarizeEvalStates", () => {
  test("counts total/assessed/passed per category, na/waived count as assessed but not passed", () => {
    const oppId = insertOpportunity([{ capability: "A" }]);
    const targetId = insertTarget(oppId);
    const items = targetEvalStates(oppId, targetId, U1);
    const financial = items.filter((i) => i.category === "financial");
    upsertEvalState(targetId, financial[0].id, { status: "pass", note: null, evidence_ref: null, assessedBy: U1 });
    upsertEvalState(targetId, financial[1].id, { status: "na", note: null, evidence_ref: null, assessedBy: U1 });
    const after = targetEvalStates(oppId, targetId, U1);
    const summary = summarizeEvalStates(after);
    expect(summary.financial).toEqual({ total: 3, assessed: 2, passed: 1 });
    expect(summary.technical).toEqual({ total: 1, assessed: 0, passed: 0 });
  });
});

describe("updateCriterionWeight", () => {
  test("updates weight for builtin/seeded/custom criteria alike", () => {
    const oppId = insertOpportunity([{ capability: "A" }]);
    const criteria = listOrSeedCriteria(oppId, U1, db);
    const builtin = criteria.find((c) => c.source === "builtin")!;
    expect(updateCriterionWeight(builtin.id, 25)).toEqual({ ok: true });
    const after = listOrSeedCriteria(oppId, U1, db).find((c) => c.id === builtin.id)!;
    expect(after.weight).toBe(25);
  });

  test("rejects non-positive weight and unknown criterion id", () => {
    const oppId = insertOpportunity();
    const custom = addCustomCriterion(oppId, "financial", "커스텀", null, U1);
    expect(updateCriterionWeight(custom.id, 0)).toEqual({ ok: false, reason: "invalid_weight" });
    expect(updateCriterionWeight("does-not-exist", 10)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("computeEvalScore", () => {
  test("weighted 0-100 score per category; na/waived excluded from both num and denom", () => {
    const items = [
      { category: "financial" as const, weight: 20, state: { status: "pass" as const } },
      { category: "financial" as const, weight: 10, state: { status: "partial" as const } },
      { category: "financial" as const, weight: 5, state: { status: "na" as const } },
      { category: "technical" as const, weight: 10, state: { status: "fail" as const } },
      { category: "technical" as const, weight: 10, state: { status: "pending" as const } },
    ];
    const score = computeEvalScore(items);
    // financial: (20*1 + 10*0.5) / (20+10) = 25/30 = 83.33 -> 83
    expect(score.financial.score).toBe(83);
    expect(score.financial.scoredWeight).toBe(30);
    expect(score.financial.excludedWeight).toBe(5);
    // technical: only the failed item counts (pending excluded from scoring) -> 0/10 = 0
    expect(score.technical.score).toBe(0);
    expect(score.technical.scoredWeight).toBe(10);
    expect(score.technical.totalWeight).toBe(20); // fail(10) + pending(10), pending still counted toward totalWeight
  });

  test("no judged items yields a null score, not zero", () => {
    const items = [
      { category: "financial" as const, weight: 10, state: null },
      { category: "financial" as const, weight: 10, state: { status: "waived" as const } },
    ];
    const score = computeEvalScore(items);
    expect(score.financial.score).toBeNull();
    expect(score.financial.excludedWeight).toBe(10);
  });
});

describe("combinedEvalScore", () => {
  test("averages financial and technical when both scored", () => {
    expect(combinedEvalScore({
      financial: { score: 80, scoredWeight: 10, totalWeight: 10, excludedWeight: 0 },
      technical: { score: 40, scoredWeight: 10, totalWeight: 10, excludedWeight: 0 },
    })).toBe(60);
  });

  test("falls back to whichever category is scored when the other is null", () => {
    expect(combinedEvalScore({
      financial: { score: 70, scoredWeight: 10, totalWeight: 10, excludedWeight: 0 },
      technical: { score: null, scoredWeight: 0, totalWeight: 0, excludedWeight: 0 },
    })).toBe(70);
  });

  test("returns null when neither category has a score yet", () => {
    expect(combinedEvalScore({
      financial: { score: null, scoredWeight: 0, totalWeight: 0, excludedWeight: 0 },
      technical: { score: null, scoredWeight: 0, totalWeight: 0, excludedWeight: 0 },
    })).toBeNull();
  });
});

describe("targetEvalStates / upsertEvalState", () => {
  test("missing states default to pending, and upsert updates in place", () => {
    const oppId = insertOpportunity([{ capability: "A" }]);
    const targetId = insertTarget(oppId);
    const before = targetEvalStates(oppId, targetId, U1);
    expect(before.every((c) => c.state === null)).toBe(true);

    const financial = before.find((c) => c.category === "financial")!;
    upsertEvalState(targetId, financial.id, { status: "pass", note: "근거", evidence_ref: null, assessedBy: U1 });
    const after = targetEvalStates(oppId, targetId, U1);
    const updated = after.find((c) => c.id === financial.id)!;
    expect(updated.state?.status).toBe("pass");
    expect(updated.state?.note).toBe("근거");

    // Re-upsert on the same (target, criterion) pair updates, not duplicates.
    upsertEvalState(targetId, financial.id, { status: "fail", note: null, evidence_ref: null, assessedBy: U1 });
    const row = db.query("SELECT COUNT(*) c FROM brownfield_target_eval_state WHERE brownfield_target_id = ? AND criterion_id = ?").get(targetId, financial.id) as { c: number };
    expect(row.c).toBe(1);
  });
});
