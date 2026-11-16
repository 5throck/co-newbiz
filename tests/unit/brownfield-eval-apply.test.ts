// @version 1.0.0
/**
 * ADR-0200 data layer (spec 2026-11-17-s6-direct-ai-verdict §3/§4/§5): verdict origin, the guarded verdict write, the
 * idempotent apply primitive, the source split of the score, and the human-only input-hash component. Scratch SQLite per
 * the house fixture pattern; no LLM, no network — the "producer" stands in for the rubric / LLM step.
 *
 * Test-plan mapping (data-layer parts; the route parts of TA2/TA4/TA12/TA15 belong to the API row):
 *   TA2 (engine part)  financial apply writes auto_rule, technical apply writes ai_draft
 *   TA3                every auto_rule row rests on a financial version of the same candidate; writer refuses otherwise
 *   TA4 (data part)    apply never touches a human verdict; non-human write over it → human_verdict_locked (SQL guard)
 *   TA5                re-run replaces non-human verdicts; a null proposal clears an AI verdict to pending
 *   TA6                a null proposal on a pending item writes nothing
 *   TA7                unchanged hash → no version, no producer call, the latest version is applied; idempotent;
 *                      applied AI verdicts do not change the human hash component
 *   TA8                retired / changed criteria are skipped with a reason and recorded in apply_summary
 *   TA9                a throwing apply rolls back the version insert and the run-item update
 *   TA11               score math with mixed sources (score 50, byWeight {10,10,10}, unreviewed 2)
 *   TA12 (data part)   a human save of the same status flips ai_draft to human and keeps source_version_id
 *   TA15 (data part)   non-human na / waived → forbidden_status
 *   TA18 (data part)   evalStateHash ignores the origin (accepting unchanged cannot invalidate a judgement)
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "eval-apply-"));
const DB_PATH = join(TMP, "apply.sqlite");
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(DB_PATH);
const db = getDb(DB_PATH);

const repo = await import("../../db/repositories/brownfield-eval-draft.repository.ts");
const crit = await import("../../app/web-next/lib/brownfield-eval-criteria.ts");
const { applyVersionToEvalState } = await import("../../app/web-next/lib/brownfield-eval-apply.ts");
const { evalStateHash } = await import("../../app/web-next/lib/brownfield-capability-judgement.ts");
type Category = "financial" | "technical";
type Proposal = "pass" | "partial" | "fail" | null;

const T0 = "2026-11-17T01:00:00.000Z";
const RUNNER = "user-runner";
const REVIEWER = "user-reviewer";
let n = 0;
let opp = "";
let target = "";
let otherTarget = "";
let fin: Array<{ id: string; label: string; rubric_json: string | null }> = [];
let tech: Array<{ id: string; label: string; rubric_json: string | null }> = [];

function seed(): void {
  n += 1;
  opp = `opp-apply-${n}`;
  target = `t-apply-${n}a`;
  otherTarget = `t-apply-${n}b`;
  const gap = { rows: [0, 1, 2].map((i) => ({ id: `gap-${n}-${i}`, capability: `역량 ${i}` })), updatedAt: T0 };
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json) VALUES (?, 'o', 's', 'selected', 'u', ?, ?)",
    [opp, T0, JSON.stringify(gap)],
  );
  for (const t of [target, otherTarget]) {
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [t, opp, `회사 ${t}`, T0, T0],
    );
  }
  const all = crit.listOrSeedCriteria(opp, RUNNER, db);
  fin = all.filter((c) => c.category === "financial");
  tech = all.filter((c) => c.category === "technical");
}

function payloadFor(category: Category, proposals: Array<[string, Proposal]>) {
  const cs = category === "financial" ? fin : tech;
  return {
    schema: 1 as const,
    category,
    criteria_snapshot: cs.map((c) => ({
      criterion_id: c.id,
      label: c.label,
      data_ref: null,
      weight: 10,
      source: category === "financial" ? ("builtin" as const) : ("seeded" as const),
      rubric: c.rubric_json ? (JSON.parse(c.rubric_json) as Record<string, unknown>) : null,
    })),
    items: proposals.map(([id, p]) => ({
      criterion_id: id,
      proposed_status: p,
      reason: p === null ? "근거 부족" : null,
      metrics: [],
      note: p === null ? null : `제안 ${p}`,
      citations: [],
    })),
    human_items: [],
    provisional_score: { score: null, scored_weight: 0, total_weight: 0 },
    dart: null,
    evidence: { disclosures: [], business_report: null, profile: { present: false, version_no: null }, web: [] },
    llm: null,
    runner: { user_id: RUNNER, via: "web" },
    generated_at: T0,
  };
}

function content(category: Category, proposals: Array<[string, Proposal]>) {
  return {
    payload: payloadFor(category, proposals),
    provisionalScore: null,
    proposedCount: proposals.filter(([, p]) => p !== null).length,
    unverifiedCount: proposals.filter(([, p]) => p === null).length,
    evidenceGrade: (category === "financial" ? "A" : "C") as "A" | "C",
  };
}

function newVersion(category: Category, proposals: Array<[string, Proposal]>, targetId = target) {
  return repo.insertDraftVersion(db, {
    ...content(category, proposals),
    targetId,
    category,
    runId: null,
    inputHash: `h-${Math.random()}`,
    createdBy: RUNNER,
    now: T0,
  });
}

const row = (criterionId: string, targetId = target) => repo.getEvalVerdict(db, targetId, criterionId);
const apply = (version: ReturnType<typeof newVersion>, now = T0) =>
  applyVersionToEvalState(db, { version, actor: RUNNER, now });
const humanSave = (
  criterionId: string,
  status: "pass" | "partial" | "fail" | "na" | "waived" | "pending",
  extra = {},
) =>
  repo.writeEvalVerdict(db, {
    targetId: target,
    criterionId,
    status,
    note: "사람 판단",
    evidenceRef: null,
    assessedBy: REVIEWER,
    source: "human",
    sourceVersionId: null,
    now: T0,
    ...extra,
  });

beforeEach(() => seed());

describe("writeEvalVerdict — origin and the human lock (TA3, TA4, TA12, TA15)", () => {
  test("TA15: a non-human write cannot set na / waived (typed forbidden_status, nothing written)", () => {
    for (const status of ["na", "waived"] as const) {
      for (const source of ["ai_draft", "auto_rule"] as const) {
        const res = repo.writeEvalVerdict(db, {
          targetId: target,
          criterionId: tech[0].id,
          status,
          note: null,
          evidenceRef: null,
          assessedBy: RUNNER,
          source,
          sourceVersionId: source === "auto_rule" ? newVersion("financial", []).id : null,
          now: T0,
        });
        expect(res).toEqual({ ok: false, reason: "forbidden_status", status });
      }
    }
    expect(row(tech[0].id)).toBeNull();
    expect(humanSave(tech[0].id, "na").ok).toBe(true); // a person may exclude
  });

  test("TA4: a non-human write over a human non-pending verdict is refused and leaves it byte-equal", () => {
    expect(humanSave(tech[0].id, "fail").ok).toBe(true);
    const before = row(tech[0].id);
    const res = repo.writeEvalVerdict(db, {
      targetId: target,
      criterionId: tech[0].id,
      status: "pass",
      note: "agent",
      evidenceRef: null,
      assessedBy: RUNNER,
      source: "ai_draft",
      sourceVersionId: null,
      now: "2026-11-17T02:00:00.000Z",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("human_verdict_locked");
    expect(row(tech[0].id)).toEqual(before);
    // a human pending row is NOT locked (nothing judged yet)
    expect(humanSave(tech[1].id, "pending").ok).toBe(true);
    const onPending = repo.writeEvalVerdict(db, {
      targetId: target,
      criterionId: tech[1].id,
      status: "partial",
      note: null,
      evidenceRef: null,
      assessedBy: RUNNER,
      source: "ai_draft",
      sourceVersionId: null,
      now: T0,
    });
    expect(onPending.ok).toBe(true);
    expect(row(tech[1].id)?.verdict_source).toBe("ai_draft");
  });

  test("TA12: a person's save of the same status flips ai_draft to human, keeps the version, records the reviewer", () => {
    const v = newVersion("technical", [[tech[0].id, "pass"]]);
    apply(v);
    expect(row(tech[0].id)).toMatchObject({ status: "pass", verdict_source: "ai_draft", source_version_id: v.id });
    const res = humanSave(tech[0].id, "pass", { sourceVersionId: v.id, note: "제안 pass", evidenceRef: v.id });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.previous).toMatchObject({ verdict_source: "ai_draft", status: "pass" });
      expect(res.row).toMatchObject({
        status: "pass",
        verdict_source: "human",
        source_version_id: v.id,
        assessed_by: REVIEWER,
      });
    }
    // the human upsert wrapper always writes human and never touches the frozen 0194 column
    const written = crit.recordEvalVerdict(target, tech[1].id, {
      status: "fail",
      note: null,
      evidence_ref: null,
      assessedBy: REVIEWER,
      source: "human",
      sourceVersionId: v.id,
    });
    if (!written.ok) throw new Error("human write refused");
    const s = written.row;
    expect(s).toMatchObject({ verdict_source: "human", source_version_id: v.id });
    const frozen = db
      .query("SELECT confirmed_from_version_id f FROM brownfield_target_eval_state WHERE id = ?")
      .get(s.id) as { f: string | null };
    expect(frozen.f).toBeNull();
  });

  test("TA3: auto_rule requires a version, and every applied auto_rule row rests on a financial version of its candidate", () => {
    expect(() =>
      repo.writeEvalVerdict(db, {
        targetId: target,
        criterionId: fin[0].id,
        status: "pass",
        note: null,
        evidenceRef: null,
        assessedBy: RUNNER,
        source: "auto_rule",
        sourceVersionId: null,
        now: T0,
      }),
    ).toThrow(/source_version_id/);
    apply(
      newVersion(
        "financial",
        fin.map((c) => [c.id, "pass"] as [string, Proposal]),
      ),
    );
    const bad = db
      .query(
        `SELECT COUNT(*) AS n FROM brownfield_target_eval_state s
           LEFT JOIN brownfield_eval_draft_version v ON v.id = s.source_version_id
          WHERE s.verdict_source = 'auto_rule'
            AND (v.id IS NULL OR v.category <> 'financial' OR v.brownfield_target_id <> s.brownfield_target_id)`,
      )
      .get() as { n: number };
    expect(bad.n).toBe(0);
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM brownfield_target_eval_state WHERE verdict_source = 'auto_rule'").get() as {
          n: number;
        }
      ).n,
    ).toBeGreaterThanOrEqual(4);
  });

  test("the verdict_source CHECK rejects an unknown origin at the DB", () => {
    expect(() =>
      db.run(
        "INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, assessed_by, assessed_at, verdict_source) VALUES ('x', ?, ?, 'pass', 'u', ?, 'robot')",
        [target, tech[0].id, T0],
      ),
    ).toThrow(/CHECK/);
  });
});

describe("applyVersionToEvalState (TA2, TA4, TA5, TA6, TA8)", () => {
  test("TA2: financial apply writes auto_rule, technical apply writes ai_draft; run actor is accountable", () => {
    const f = newVersion("financial", [[fin[0].id, "pass"]]);
    const t = newVersion("technical", [[tech[0].id, "partial"]]);
    expect(apply(f)).toEqual({ applied: 1, kept_human: 0, unverified: 0, cleared: 0, skipped: [] });
    apply(t);
    expect(row(fin[0].id)).toMatchObject({
      status: "pass",
      verdict_source: "auto_rule",
      source_version_id: f.id,
      evidence_ref: f.id,
      note: "제안 pass",
      assessed_by: RUNNER,
    });
    expect(row(tech[0].id)).toMatchObject({ status: "partial", verdict_source: "ai_draft", source_version_id: t.id });
    const audit = db
      .query("SELECT target FROM audit_log WHERE action = 'target_eval.ai_verdict.apply' ORDER BY rowid DESC LIMIT 1")
      .get() as { target: string };
    expect(audit.target).toBe(`${opp}:${target}:technical:v1:run=none:applied=1:kept_human=0:cleared=0:skipped=0`);
  });

  test("TA4: a human verdict is never written by an apply (kept_human), other items still apply", () => {
    humanSave(tech[0].id, "fail");
    const before = row(tech[0].id);
    const v = newVersion("technical", [
      [tech[0].id, "pass"],
      [tech[1].id, "pass"],
    ]);
    expect(apply(v)).toMatchObject({ applied: 1, kept_human: 1 });
    expect(row(tech[0].id)).toEqual(before);
    expect(row(tech[1].id)?.verdict_source).toBe("ai_draft");
  });

  test("TA5: re-runs replace non-human verdicts; a null proposal clears an AI verdict to pending", () => {
    apply(newVersion("technical", [[tech[0].id, "pass"]]));
    const v2 = newVersion("technical", [[tech[0].id, "fail"]]);
    apply(v2);
    expect(row(tech[0].id)).toMatchObject({ status: "fail", verdict_source: "ai_draft", source_version_id: v2.id });
    const v3 = newVersion("technical", [[tech[0].id, null]]);
    expect(apply(v3)).toMatchObject({ applied: 0, cleared: 1, unverified: 0 });
    expect(row(tech[0].id)).toMatchObject({
      status: "pending",
      verdict_source: "ai_draft",
      source_version_id: v3.id,
      note: "근거 부족",
    });
  });

  test("TA6: a null proposal on a pending / missing item writes nothing", () => {
    humanSave(tech[1].id, "pending");
    const before = row(tech[1].id);
    expect(
      apply(
        newVersion("technical", [
          [tech[0].id, null],
          [tech[1].id, null],
        ]),
      ),
    ).toMatchObject({ applied: 0, unverified: 2, cleared: 0 });
    expect(row(tech[0].id)).toBeNull();
    expect(row(tech[1].id)).toEqual(before);
  });

  test("TA8: retired / deleted criteria and changed rubric (financial) or label (technical) are skipped with a reason", () => {
    const f = newVersion("financial", [
      [fin[0].id, "pass"],
      [fin[1].id, "pass"],
    ]);
    const t = newVersion("technical", [
      [tech[0].id, "pass"],
      [tech[1].id, "pass"],
      [tech[2].id, "pass"],
    ]);
    db.run("UPDATE brownfield_eval_criterion SET rubric_json = ? WHERE id = ?", ['{"cagrPass":9}', fin[0].id]);
    db.run("UPDATE brownfield_eval_criterion SET retired_at = ?, retired_reason = 's3_row_removed' WHERE id = ?", [
      T0,
      tech[0].id,
    ]);
    db.run("UPDATE brownfield_eval_criterion SET label = '새 이름' WHERE id = ?", [tech[1].id]);
    expect(apply(f)).toEqual({
      applied: 1,
      kept_human: 0,
      unverified: 0,
      cleared: 0,
      skipped: [{ criterion_id: fin[0].id, reason: "criterion_changed" }],
    });
    expect(apply(t)).toEqual({
      applied: 1,
      kept_human: 0,
      unverified: 0,
      cleared: 0,
      skipped: [
        { criterion_id: tech[0].id, reason: "criterion_retired" },
        { criterion_id: tech[1].id, reason: "criterion_changed" },
      ],
    });
    expect(row(fin[0].id)).toBeNull();
    expect(row(tech[0].id)).toBeNull();
    expect(row(tech[1].id)).toBeNull();
  });
});

describe("commitCategoryDraft apply hook (TA7, TA8 summary, TA9)", () => {
  function runItem(): string {
    const { run } = repo.createRun(db, {
      opportunityId: opp,
      categories: "both",
      targetIds: [target],
      webEvidence: false,
      forceRefresh: false,
      startedBy: RUNNER,
      startedVia: "web",
      now: T0,
    });
    return repo.listRunItems(db, run.id)[0].id;
  }
  const hookFor =
    (runId: string, now = T0) =>
    (v: ReturnType<typeof newVersion>) =>
      applyVersionToEvalState(db, { version: v, actor: RUNNER, now, runId });

  test("TA7: unchanged hash → no version, no producer call, the latest (never-applied) version is applied; idempotent", async () => {
    // A pre-0197 version whose proposals were never confirmed.
    const legacy = repo.insertDraftVersion(db, {
      ...content("technical", [
        [tech[0].id, "pass"],
        [tech[1].id, null],
      ]),
      targetId: target,
      category: "technical",
      runId: null,
      inputHash: "same-hash",
      createdBy: RUNNER,
      now: T0,
    });
    const items = () => crit.targetEvalStates(opp, target, RUNNER).filter((c) => c.category === "technical");
    const hashBefore = crit.humanVerdictHashComponent(items());
    const item = runItem();
    const runId = (repo.getRunItem(db, item) as { run_id: string }).run_id;
    let produced = 0;
    const r1 = await repo.commitCategoryDraft(db, {
      itemId: item,
      category: "technical",
      inputHash: "same-hash",
      createdBy: RUNNER,
      now: T0,
      produce: () => {
        produced++;
        return content("technical", []);
      },
      apply: hookFor(runId),
    });
    expect(produced).toBe(0);
    expect(r1.outcome).toBe("unchanged");
    expect(r1.version.id).toBe(legacy.id);
    expect(r1.applySummary).toEqual({ applied: 1, kept_human: 0, unverified: 1, cleared: 0, skipped: [] });
    expect(repo.listVersions(db, target, { category: "technical" })).toHaveLength(1);
    expect(row(tech[0].id)).toMatchObject({ status: "pass", verdict_source: "ai_draft", source_version_id: legacy.id });
    expect(repo.parseApplySummary((repo.getRunItem(db, item) as { apply_summary: string }).apply_summary)).toEqual({
      technical: r1.applySummary,
    });
    // Applied AI verdicts are not part of the human hash component → the next run computes the same hash.
    expect(crit.humanVerdictHashComponent(items())).toEqual(hashBefore);
    const snapshot = row(tech[0].id);
    const item2 = runItem();
    const r2 = await repo.commitCategoryDraft(db, {
      itemId: item2,
      category: "technical",
      inputHash: "same-hash",
      createdBy: RUNNER,
      now: "2026-11-17T03:00:00.000Z",
      produce: () => {
        produced++;
        return content("technical", []);
      },
      apply: hookFor(runId, "2026-11-17T03:00:00.000Z"),
    });
    expect(produced).toBe(0);
    expect(r2.applySummary).toMatchObject({ applied: 1, cleared: 0 });
    const after = row(tech[0].id);
    expect({ ...after, assessed_at: "" }).toEqual({ ...snapshot, assessed_at: "" }); // only assessed_at refreshes
  });

  test("TA7: the human hash component counts human verdicts only and equals the old non-pending set on pre-0197 data", () => {
    humanSave(tech[0].id, "fail");
    humanSave(tech[1].id, "pending");
    const items = crit.targetEvalStates(opp, target, RUNNER).filter((c) => c.category === "technical");
    const legacyNonPending = items
      .filter((c) => c.state && c.state.status !== "pending")
      .map((c) => [c.id, c.state?.status]);
    expect(crit.humanVerdictHashComponent(items)).toEqual(legacyNonPending as Array<[string, "fail"]>);
    apply(newVersion("technical", [[tech[2].id, "pass"]]));
    const after = crit.targetEvalStates(opp, target, RUNNER).filter((c) => c.category === "technical");
    expect(crit.humanVerdictHashComponent(after)).toEqual([[tech[0].id, "fail"]]);
    expect(crit.isEligibleForDraft(after.find((c) => c.id === tech[2].id)?.state)).toBe(true); // AI verdict stays eligible
    expect(crit.isEligibleForDraft(after.find((c) => c.id === tech[0].id)?.state)).toBe(false);
  });

  test("versioned path applies in the same transaction and records apply_summary per category", async () => {
    const item = runItem();
    const runId = (repo.getRunItem(db, item) as { run_id: string }).run_id;
    const r = await repo.commitCategoryDraft(db, {
      itemId: item,
      category: "financial",
      inputHash: "fin-1",
      createdBy: RUNNER,
      now: T0,
      produce: () => content("financial", [[fin[0].id, "partial"]]),
      apply: hookFor(runId),
    });
    expect(r.outcome).toBe("versioned");
    expect(row(fin[0].id)).toMatchObject({ verdict_source: "auto_rule", source_version_id: r.version.id });
    const stored = repo.parseApplySummary((repo.getRunItem(db, item) as { apply_summary: string }).apply_summary);
    expect(stored.financial).toEqual({ applied: 1, kept_human: 0, unverified: 0, cleared: 0, skipped: [] });
    const audit = db
      .query("SELECT target FROM audit_log WHERE action = 'target_eval.ai_verdict.apply' ORDER BY rowid DESC LIMIT 1")
      .get() as { target: string };
    expect(audit.target).toContain(`:financial:v1:run=${runId}:applied=1`);
  });

  test("TA9: a throwing apply rolls back the version insert and the run-item update (and its own writes)", async () => {
    const item = runItem();
    await expect(
      repo.commitCategoryDraft(db, {
        itemId: item,
        category: "technical",
        inputHash: "boom",
        createdBy: RUNNER,
        now: T0,
        produce: () => content("technical", [[tech[0].id, "pass"]]),
        apply: (v) => {
          applyVersionToEvalState(db, { version: v, actor: RUNNER, now: T0 });
          throw new Error("forced apply failure");
        },
      }),
    ).rejects.toThrow("forced apply failure");
    expect(repo.listVersions(db, target, { category: "technical" })).toHaveLength(0);
    expect(row(tech[0].id)).toBeNull();
    const it = repo.getRunItem(db, item);
    expect(it?.technical_outcome).toBeNull();
    expect(it?.technical_version_id).toBeNull();
    expect(it?.apply_summary).toBeNull();
  });
});

describe("score source split and read helpers (TA11, TA18, §5.2, §8 A5)", () => {
  test("TA11: human pass 10, auto_rule partial 10, ai_draft fail 10, pending 10", () => {
    const scores = crit.computeEvalScore([
      { category: "technical", weight: 10, state: { status: "pass", verdict_source: "human" } },
      { category: "technical", weight: 10, state: { status: "partial", verdict_source: "auto_rule" } },
      { category: "technical", weight: 10, state: { status: "fail", verdict_source: "ai_draft" } },
      { category: "technical", weight: 10, state: { status: "pending", verdict_source: "ai_draft" } },
    ]);
    expect(scores.technical).toEqual({
      score: 50,
      scoredWeight: 30,
      totalWeight: 40,
      excludedWeight: 0,
      byWeight: { human: 10, auto_rule: 10, ai_draft: 10 },
      unreviewed: 2,
    });
    const summary = crit.buildEvalSummary(scores);
    expect(summary.technical.judged_by_source).toEqual({ human: 10, auto_rule: 10, ai_draft: 10 });
    expect(summary.unreviewed_total).toBe(2);
    expect(summary.complete).toBe(false);
    expect(summary.combined).toBe(50);
    // a missing origin reads as the column default 'human' (pre-0197 callers)
    expect(
      crit.computeEvalScore([{ category: "financial", weight: 5, state: { status: "pass" } }]).financial,
    ).toMatchObject({ byWeight: { human: 5, auto_rule: 0, ai_draft: 0 }, unreviewed: 0 });
  });

  test("countUnreviewedVerdicts splits by category and origin and ignores pending, human and retired rows", () => {
    apply(
      newVersion("financial", [
        [fin[0].id, "pass"],
        [fin[1].id, "fail"],
      ]),
    );
    apply(
      newVersion("technical", [
        [tech[0].id, "pass"],
        [tech[1].id, "partial"],
      ]),
    );
    humanSave(fin[1].id, "fail"); // reviewed
    db.run("UPDATE brownfield_eval_criterion SET retired_at = ? WHERE id = ?", [T0, tech[1].id]);
    expect(repo.countUnreviewedVerdicts(db, target)).toEqual({
      financial: 1,
      technical: 1,
      total: 2,
      auto_rule: 1,
      ai_draft: 1,
    });
    expect(repo.countUnreviewedVerdicts(db, otherTarget).total).toBe(0);
  });

  test("verdictCountsByVersion: applied = non-human, reviewed = human, pending rows not counted", () => {
    const v = newVersion("technical", [
      [tech[0].id, "pass"],
      [tech[1].id, "pass"],
      [tech[2].id, "pass"],
    ]);
    apply(v);
    humanSave(tech[1].id, "pass", { sourceVersionId: v.id });
    const v2 = newVersion("technical", [[tech[2].id, null]]);
    apply(v2); // tech[2] cleared to pending, now rests on v2
    const counts = repo.verdictCountsByVersion(db, [v.id, v2.id, "none"]);
    expect(counts.get(v.id)).toEqual({ applied: 1, reviewed: 1 });
    expect(counts.get(v2.id)).toEqual({ applied: 0, reviewed: 0 });
    expect(counts.get("none")).toEqual({ applied: 0, reviewed: 0 });
  });

  test("TA18 (data part): evalStateHash ignores the origin, so accepting a verdict unchanged keeps the judgement basis", () => {
    const v = newVersion("technical", [[tech[0].id, "pass"]]);
    apply(v);
    const ai = row(tech[0].id);
    humanSave(tech[0].id, "pass", {
      sourceVersionId: v.id,
      note: ai?.note ?? null,
      evidenceRef: ai?.evidence_ref ?? null,
    });
    const human = row(tech[0].id);
    expect(human?.verdict_source).toBe("human");
    expect(evalStateHash(human)).toBe(evalStateHash(ai));
  });
});
