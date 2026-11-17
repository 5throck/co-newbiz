// ADR-0202 (owner decision 2026-11-17, N1): unreviewed AI-draft S6 verdicts block the
// brownfield pre_fs and target_screening gates as prerequisite gaps; auto_rule verdicts
// never block; a person's save (verdict_source → human) clears the gap. The gap travels
// as a machine-readable token `ai_draft_review:<n>` (localized ko/en in the UI layer),
// and the gate snapshot carries the same count as a display-only section.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-ai-draft-verdict-gate-gap.sqlite";
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { evaluateProcess, gateGoPrerequisiteGaps, AI_DRAFT_REVIEW_GAP_PREFIX } = await import(
  "../../app/web-next/lib/process-flow.ts"
);
const { previewGateSnapshot, clearSnapshotCache } = await import("../../app/web-next/lib/gate-snapshot.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();
const ACTOR = "test-actor";

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function insertTarget(opportunityId: string, status: "pending" | "shortlisted" | "excluded"): string {
  const id = ulid();
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    [id, opportunityId, `Target ${id.slice(-4)}`, status, NOW, NOW],
  );
  return id;
}

function insertCriterion(opportunityId: string): string {
  const id = ulid();
  db.run(
    "INSERT INTO brownfield_eval_criterion (id, opportunity_id, category, source, label, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [id, opportunityId, "financial", "custom", `criterion ${id.slice(-4)}`, ACTOR, NOW],
  );
  return id;
}

function insertVerdict(
  targetId: string,
  criterionId: string,
  source: "human" | "auto_rule" | "ai_draft",
  status: "pending" | "pass" | "partial" | "fail" | "na" | "waived",
): void {
  db.run(
    `INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, assessed_by, assessed_at, verdict_source)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), targetId, criterionId, status, ACTOR, NOW, source],
  );
}

function aiDraftGap(gaps: string[]): number | null {
  const g = gaps.find((x) => x.startsWith(AI_DRAFT_REVIEW_GAP_PREFIX));
  return g ? Number(g.slice(AI_DRAFT_REVIEW_GAP_PREFIX.length)) : null;
}

describe("ADR-0202 unreviewed ai_draft verdict gate gap", () => {
  let opportunityId = "";

  beforeAll(async () => {
    const seeded = await seedS1ToS12Demo();
    opportunityId = seeded.opportunityId;
    expect(evaluateProcess({ type: "opportunity", id: opportunityId }).track).toBe("brownfield");
  });

  test("no verdicts — no ai_draft_review gap, snapshot count 0", () => {
    for (const gate of ["pre_fs", "target_screening"] as const) {
      expect(aiDraftGap(gateGoPrerequisiteGaps({ type: "opportunity", id: opportunityId }, gate))).toBeNull();
    }
    clearSnapshotCache();
    const { snapshot } = previewGateSnapshot(
      { entityType: "opportunity", entityId: opportunityId, gate: "target_screening", actor: ACTOR },
      { fresh: true },
    );
    expect(snapshot.ai_draft_review).toEqual({ unreviewed: 0 });
  });

  test("one live ai_draft verdict adds a gap with the count at both gates", () => {
    const t = insertTarget(opportunityId, "shortlisted");
    const c = insertCriterion(opportunityId);
    insertVerdict(t, c, "ai_draft", "pass");
    for (const gate of ["pre_fs", "target_screening"] as const) {
      expect(aiDraftGap(gateGoPrerequisiteGaps({ type: "opportunity", id: opportunityId }, gate))).toBe(1);
    }
  });

  test("auto_rule verdicts are deterministic checks and never block", () => {
    const t = insertTarget(opportunityId, "shortlisted");
    const c = insertCriterion(opportunityId);
    insertVerdict(t, c, "auto_rule", "pass");
    for (const gate of ["pre_fs", "target_screening"] as const) {
      expect(aiDraftGap(gateGoPrerequisiteGaps({ type: "opportunity", id: opportunityId }, gate))).toBe(1);
    }
  });

  test("pending rows and excluded targets do not count", () => {
    const t = insertTarget(opportunityId, "shortlisted");
    const c = insertCriterion(opportunityId);
    insertVerdict(t, c, "ai_draft", "pending"); // not a verdict yet
    const ex = insertTarget(opportunityId, "excluded");
    insertVerdict(ex, c, "ai_draft", "fail"); // excluded target cannot block
    for (const gate of ["pre_fs", "target_screening"] as const) {
      expect(aiDraftGap(gateGoPrerequisiteGaps({ type: "opportunity", id: opportunityId }, gate))).toBe(1);
    }
  });

  test("a human save clears the gap (no auto-clear; only review clears it)", () => {
    db.run(
      `UPDATE brownfield_target_eval_state SET verdict_source = 'human' WHERE brownfield_target_id IN (SELECT id FROM brownfield_target WHERE opportunity_id = ?)`,
      [opportunityId],
    );
    for (const gate of ["pre_fs", "target_screening"] as const) {
      expect(aiDraftGap(gateGoPrerequisiteGaps({ type: "opportunity", id: opportunityId }, gate))).toBeNull();
    }
  });

  test("snapshot surface: the display-only section counts live ai_draft verdicts", () => {
    const t = insertTarget(opportunityId, "shortlisted");
    insertVerdict(t, insertCriterion(opportunityId), "ai_draft", "pass");
    insertVerdict(t, insertCriterion(opportunityId), "human", "pass"); // a human verdict never counts
    clearSnapshotCache();
    const { snapshot } = previewGateSnapshot(
      { entityType: "opportunity", entityId: opportunityId, gate: "pre_fs", actor: ACTOR },
      { fresh: true },
    );
    expect(snapshot.ai_draft_review).toEqual({ unreviewed: 1 });
  });

  test("snapshot surface: key absent outside the consuming gates / tracks", () => {
    clearSnapshotCache();
    const { snapshot } = previewGateSnapshot(
      { entityType: "opportunity", entityId: opportunityId, gate: "screening", actor: ACTOR },
      { fresh: true },
    );
    expect("ai_draft_review" in snapshot).toBe(false);
  });
});
