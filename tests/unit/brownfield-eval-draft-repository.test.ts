// @version 1.0.0
/**
 * brownfield-eval-draft.repository — data-layer semantics of ADR-0199 / spec 2026-11-16-s6-bulk-ai-eval-versioning
 * (§3.3, §5, §6.4, §7, test plan T2/T3/T6/T13/T23 data parts). Scratch SQLite per the house fixture pattern; no LLM,
 * no network — the "producer" stands in for the rubric / LLM step.
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "eval-draft-repo-"));
const DB_PATH = join(TMP, "repo.sqlite");
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(DB_PATH);
const db = getDb(DB_PATH);

const repo = await import("../../db/repositories/brownfield-eval-draft.repository.ts");
type Content = import("../../db/repositories/brownfield-eval-draft.repository.ts").DraftVersionContent;

const T0 = "2026-11-16T01:00:00.000Z";
let n = 0;
let opp = "";
let t1 = "";
let t2 = "";

function seedOpp(): void {
  n += 1;
  opp = `opp${n}`;
  t1 = `t${n}a`;
  t2 = `t${n}b`;
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?, 'o', 's', 'identified', 'u', ?)",
    [opp, T0],
  );
  for (const t of [t1, t2]) {
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, created_at, updated_at) VALUES (?, ?, ?, '00123456', ?, ?)",
      [t, opp, `회사 ${t}`, T0, T0],
    );
  }
}

function payload(category: "financial" | "technical", score: number | null = 70) {
  return {
    schema: 1 as const,
    category,
    criteria_snapshot: [
      {
        criterion_id: "c1",
        label: "매출 성장",
        data_ref: "revenue_5y",
        weight: 10,
        source: "builtin" as const,
        rubric: { cagrPass: 5 },
      },
    ],
    items: [
      {
        criterion_id: "c1",
        proposed_status: "pass" as const,
        reason: null,
        metrics: [{ label: "CAGR", value: "+7.2%" }],
        note: "자동초안",
        citations: [{ kind: "disclosure" as const, ref: "20250314000123", quote: "매출 증가" }],
      },
    ],
    human_items: [],
    provisional_score: { score, scored_weight: 10, total_weight: 10 },
    dart: { corp_code: "00123456", base_years: [2020, 2021, 2022, 2023, 2024], latest_sync_at: T0, sync_warnings: [] },
    evidence: { disclosures: [], business_report: null, profile: { present: false, version_no: null }, web: [] },
    llm: null,
    runner: { user_id: "u1", via: "web" },
    generated_at: T0,
  };
}

const content = (category: "financial" | "technical" = "financial", score = 70): Content => ({
  payload: payload(category, score),
  provisionalScore: score,
  proposedCount: 1,
  unverifiedCount: 0,
  evidenceGrade: category === "financial" ? "A" : "C",
});

function startRun(targets = [t1, t2]) {
  return repo.createRun(db, {
    opportunityId: opp,
    categories: "both",
    targetIds: targets,
    webEvidence: false,
    forceRefresh: true,
    startedBy: "u1",
    startedVia: "web",
    now: T0,
  });
}

const versionCount = (target: string) =>
  (
    db.query("SELECT COUNT(*) AS n FROM brownfield_eval_draft_version WHERE brownfield_target_id = ?").get(target) as {
      n: number;
    }
  ).n;

beforeEach(seedOpp);

describe("pure helpers", () => {
  test("T1 seam: input hash is canonical (key order independent) and sensitive to every input", () => {
    const a = repo.computeDraftInputHash({ facts: [{ y: 2024, v: 1 }], web_evidence: false, rubric: { a: 1, b: 2 } });
    const b = repo.computeDraftInputHash({ rubric: { b: 2, a: 1 }, web_evidence: false, facts: [{ v: 1, y: 2024 }] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(
      repo.computeDraftInputHash({ facts: [{ y: 2024, v: 1 }], web_evidence: true, rubric: { a: 1, b: 2 } }),
    ).not.toBe(a);
  });

  test("heartbeat staleness threshold is 10 minutes", () => {
    expect(repo.isHeartbeatStale(T0, "2026-11-16T01:10:00.000Z")).toBe(false);
    expect(repo.isHeartbeatStale(T0, "2026-11-16T01:10:00.001Z")).toBe(true);
  });

  test("payload schema v1 and the 64 KiB cap reject instead of truncating", () => {
    expect(repo.serializeDraftPayload(payload("financial"), "financial")).toContain('"schema":1');
    expect(() => repo.serializeDraftPayload(payload("financial"), "technical")).toThrow(/category/);
    const longQuote = payload("technical");
    longQuote.items[0].citations[0].quote = "x".repeat(repo.CITATION_QUOTE_MAX_CHARS + 1);
    expect(() => repo.serializeDraftPayload(longQuote, "technical")).toThrow(repo.EvalDraftError);
    const huge = payload("technical");
    huge.items = Array.from({ length: 400 }, (_, i) => ({
      ...huge.items[0],
      criterion_id: `c${i}`,
      note: "가".repeat(200),
    }));
    expect(() => repo.serializeDraftPayload(huge, "technical")).toThrow(/exceeds/);
  });
});

describe("runs and items", () => {
  test("createRun stores options and one pending item per candidate in seq order", () => {
    const { run, reused } = startRun();
    expect(reused).toBe(false);
    expect(run).toMatchObject({
      status: "running",
      total_targets: 2,
      web_evidence: 0,
      force_refresh: 1,
      started_by: "u1",
      started_via: "web",
    });
    const items = repo.listRunItems(db, run.id);
    expect(items.map((i) => [i.brownfield_target_id, i.seq, i.state])).toEqual([
      [t1, 0, "pending"],
      [t2, 1, "pending"],
    ]);
  });

  test("T13: a second start while active returns the same run (reused) and inserts nothing", () => {
    const first = startRun();
    const second = startRun([t2]);
    expect(second.reused).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM brownfield_eval_draft_run WHERE opportunity_id = ?").get(opp) as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  test("createRun rejects foreign or repeated targets", () => {
    expect(() => startRun([t1, t1])).toThrow(/repeat/);
    expect(() => startRun([t1, "nope"])).toThrow(/candidate of this opportunity/);
  });

  test("T6: a stale running heartbeat becomes interrupted; resume keeps options and records who resumed", () => {
    const { run } = startRun();
    expect(repo.markStaleRunInterrupted(db, opp, "2026-11-16T01:05:00.000Z")).toBe(0);
    expect(repo.markStaleRunInterrupted(db, opp, "2026-11-16T01:11:00.000Z")).toBe(1);
    expect(repo.getRun(db, run.id)?.status).toBe("interrupted");
    expect(repo.getActiveRun(db, opp)?.id).toBe(run.id); // still blocks a parallel start
    const resumed = repo.resumeRun(db, run.id, "u2", "2026-11-16T02:00:00.000Z");
    expect(resumed).toMatchObject({
      status: "running",
      resumed_by: "u2",
      force_refresh: 1,
      web_evidence: 0,
      pause_reason: null,
    });
    expect(() => repo.resumeRun(db, run.id, "u2", T0)).toThrow(/cannot move/);
  });

  test("pause → resume → finish; terminal runs no longer block a new start", () => {
    const { run } = startRun();
    expect(repo.pauseRun(db, run.id, "dart_budget_reserve", T0)).toMatchObject({
      status: "paused_budget",
      pause_reason: "dart_budget_reserve",
    });
    repo.resumeRun(db, run.id, "u1", T0);
    const done = repo.finishRun(db, run.id, "completed", "2026-11-16T03:00:00.000Z");
    expect(done).toMatchObject({ status: "completed", finished_at: "2026-11-16T03:00:00.000Z" });
    expect(() => repo.finishRun(db, run.id, "cancelled", T0)).toThrow(/cannot move/);
    expect(startRun().reused).toBe(false);
  });

  test("resume point is the first non-terminal item in seq order; dart_calls accumulate", () => {
    const { run } = startRun();
    const [a, b] = repo.listRunItems(db, run.id);
    repo.updateRunItem(db, a.id, { state: "done", addDartCalls: 3 }, T0);
    repo.updateRunItem(db, b.id, { state: "technical_draft", addDartCalls: 2 }, T0);
    repo.updateRunItem(db, b.id, { addDartCalls: 1 }, T0);
    const next = repo.nextResumableItem(db, run.id);
    expect(next?.id).toBe(b.id);
    expect(next?.state).toBe("technical_draft");
    expect(next?.dart_calls).toBe(3);
    repo.updateRunItem(db, b.id, { state: "skipped_not_dart" }, T0);
    expect(repo.nextResumableItem(db, run.id)).toBeNull();
  });
});

describe("versions: numbering, replace-on-success, unchanged inputs", () => {
  test("version numbers are 1, 2, 3 per (candidate, category), independent across categories", () => {
    const base = { runId: null, createdBy: "u1", now: T0 };
    const v1 = repo.insertDraftVersion(db, {
      ...content(),
      ...base,
      targetId: t1,
      category: "financial",
      inputHash: "h1",
    });
    const v2 = repo.insertDraftVersion(db, {
      ...content(),
      ...base,
      targetId: t1,
      category: "financial",
      inputHash: "h2",
    });
    const tv = repo.insertDraftVersion(db, {
      ...content("technical"),
      ...base,
      targetId: t1,
      category: "technical",
      inputHash: "h3",
    });
    const o1 = repo.insertDraftVersion(db, {
      ...content(),
      ...base,
      targetId: t2,
      category: "financial",
      inputHash: "h1",
    });
    expect([v1.version_no, v2.version_no, tv.version_no, o1.version_no]).toEqual([1, 2, 1, 1]);
    expect(repo.getLatestVersion(db, t1, "financial")?.id).toBe(v2.id);
    const list = repo.listVersions(db, t1, { category: "financial" });
    expect(list.map((v) => v.version_no)).toEqual([2, 1]);
    expect("payload" in list[0]).toBe(false);
    expect("payload" in repo.listVersions(db, t1, { category: "financial", includePayload: true })[0]).toBe(true);
  });

  test("T3: a failing producer writes nothing; the next success is v2 with no gap", async () => {
    const { run } = startRun([t1]);
    const [item] = repo.listRunItems(db, run.id);
    const ok1 = await repo.commitCategoryDraft(db, {
      itemId: item.id,
      category: "technical",
      inputHash: "e1",
      createdBy: "u1",
      now: T0,
      produce: () => content("technical", 50),
    });
    expect(ok1.outcome).toBe("versioned");
    expect(ok1.version.version_no).toBe(1);
    const before = repo.getRunItem(db, item.id);

    let called = 0;
    await expect(
      repo.commitCategoryDraft(db, {
        itemId: item.id,
        category: "technical",
        inputHash: "e2",
        createdBy: "u1",
        now: "2026-11-16T02:00:00.000Z",
        produce: async () => {
          called += 1;
          throw new Error("llm provider error");
        },
      }),
    ).rejects.toThrow("llm provider error");
    expect(called).toBe(1);
    expect(versionCount(t1)).toBe(1);
    expect(repo.getLatestVersion(db, t1, "technical")?.id).toBe(ok1.version.id);
    expect(repo.getRunItem(db, item.id)).toEqual(before); // item untouched; the engine classifies failed vs paused

    // An invalid payload also fails before any write.
    await expect(
      repo.commitCategoryDraft(db, {
        itemId: item.id,
        category: "technical",
        inputHash: "e2",
        createdBy: "u1",
        now: T0,
        produce: () => content("financial"),
      }),
    ).rejects.toThrow(repo.EvalDraftError);
    expect(versionCount(t1)).toBe(1);

    const ok2 = await repo.commitCategoryDraft(db, {
      itemId: item.id,
      category: "technical",
      inputHash: "e3",
      createdBy: "u1",
      now: T0,
      produce: () => content("technical", 60),
    });
    expect(ok2.version.version_no).toBe(2);
    expect(repo.getRunItem(db, item.id)).toMatchObject({
      technical_outcome: "versioned",
      technical_version_id: ok2.version.id,
    });
  });

  test("T23: identical input hash → no version, no producer call, outcome unchanged, checked_at advances", async () => {
    const r1 = startRun([t1]);
    const [i1] = repo.listRunItems(db, r1.run.id);
    const v1 = await repo.commitCategoryDraft(db, {
      itemId: i1.id,
      category: "financial",
      inputHash: "same",
      createdBy: "u1",
      now: T0,
      produce: () => content(),
    });
    repo.finishRun(db, r1.run.id, "completed", T0);
    expect(repo.getLatestVersionWithCheckedAt(db, t1, "financial")?.checked_at).toBe(T0);

    const later = "2026-11-30T05:00:00.000Z";
    const r2 = repo.createRun(db, {
      opportunityId: opp,
      categories: "financial",
      targetIds: [t1],
      webEvidence: false,
      forceRefresh: false,
      startedBy: "u2",
      startedVia: "mcp",
      now: later,
    });
    const [i2] = repo.listRunItems(db, r2.run.id);
    let called = 0;
    const res = await repo.commitCategoryDraft(db, {
      itemId: i2.id,
      category: "financial",
      inputHash: "same",
      createdBy: "u2",
      now: later,
      produce: () => {
        called += 1;
        return content();
      },
    });
    expect(res.outcome).toBe("unchanged");
    expect(res.version.id).toBe(v1.version.id);
    expect(called).toBe(0);
    expect(versionCount(t1)).toBe(1);
    expect(repo.getRunItem(db, i2.id)).toMatchObject({
      financial_outcome: "unchanged",
      financial_version_id: v1.version.id,
    });
    const chip = repo.getLatestVersionWithCheckedAt(db, t1, "financial");
    expect(chip?.version_no).toBe(1);
    expect(chip?.created_at).toBe(T0);
    expect(chip?.checked_at).toBe(later);

    // Any change in inputs mints a new version.
    const r2b = await repo.commitCategoryDraft(db, {
      itemId: i2.id,
      category: "financial",
      inputHash: "changed",
      createdBy: "u2",
      now: later,
      produce: () => content(),
    });
    expect(r2b.outcome).toBe("versioned");
    expect(r2b.version.version_no).toBe(2);
  });

  test("confirmed_count counts verdicts citing a version", () => {
    const v = repo.insertDraftVersion(db, {
      ...content(),
      runId: null,
      createdBy: "u1",
      now: T0,
      targetId: t1,
      category: "financial",
      inputHash: "h",
    });
    db.run(
      "INSERT INTO brownfield_eval_criterion (id, opportunity_id, category, label, source, created_by, created_at) VALUES (?, ?, 'financial', 'x', 'custom', 'u', ?)",
      [`crit-${opp}`, opp, T0],
    );
    db.run(
      "INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, assessed_by, assessed_at, confirmed_from_version_id) VALUES (?, ?, ?, 'pass', 'u1', ?, ?)",
      [`s-${opp}`, t1, `crit-${opp}`, T0, v.id],
    );
    const counts = repo.confirmedCountByVersion(db, [v.id, "other"]);
    expect(counts.get(v.id)).toBe(1);
    expect(counts.get("other")).toBe(0);
  });

  test("T2: versions cannot be updated; a candidate delete cascades versions and run items", async () => {
    const { run } = startRun([t1, t2]);
    const [i1] = repo.listRunItems(db, run.id);
    const v = await repo.commitCategoryDraft(db, {
      itemId: i1.id,
      category: "financial",
      inputHash: "x",
      createdBy: "u1",
      now: T0,
      produce: () => content(),
    });
    expect(() =>
      db.run("UPDATE brownfield_eval_draft_version SET provisional_score = 1 WHERE id = ?", [v.version.id]),
    ).toThrow(/immutable/);
    db.run("DELETE FROM brownfield_target WHERE id = ?", [t1]);
    expect(versionCount(t1)).toBe(0);
    expect(repo.listRunItems(db, run.id).map((i) => i.brownfield_target_id)).toEqual([t2]);
    expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });
});

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));
