// @version 1.0.0
/**
 * ADR-0205 — brownfield S6 completes only when a human has recorded a Pre-FS GO (blocker `s6.pre_fs_go`).
 *
 *  - S6 incomplete without a GO; the blocker is LAST and blockers[]/missing[] stay index-aligned,
 *    including the no-Universe early-return case;
 *  - complete with a GO; a later HOLD regresses S6 and relocks S7 (S7 work is retained, not deleted);
 *    a KILL terminates;
 *  - opportunities created before PRE_FS_S6_GATE_DATE are exempt (stages[].exempt true on S6 only);
 *  - circularity: the pre_fs GO prerequisite is the S6 DATA blockers only, so a GO is accepted while S6
 *    itself is still incomplete for want of that GO; greenfield's prerequisite is unchanged;
 *  - the ADR-0202 AI-draft review gap still applies at pre_fs.
 *
 * Fixture: the S1-S12 demo seed with humanDecisions:false (no gate rows), created "now" (>= the cut-off).
 */
import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s6-pre-fs-gate.sqlite";
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const {
  evaluateProcess,
  gateGoPrerequisiteGaps,
  opportunityPreFsS6Grandfathered,
  PRE_FS_S6_GATE_DATE,
  AI_DRAFT_REVIEW_GAP_PREFIX,
} = await import("../../app/web-next/lib/process-flow.ts");
const { blocker } = await import("../../app/web-next/lib/process-blocker-keys.ts");
const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const bf = seedS1ToS12Demo(TEST_DB_PATH, { humanDecisions: false });
const gf = await seedGreenfieldS1ToS12Demo(TEST_DB_PATH, { humanDecisions: false });
const UNIVERSE = (
  db.query("SELECT target_universe_json AS j FROM opportunity WHERE id = ?").get(bf.opportunityId) as { j: string }
).j;
const OPP = { type: "opportunity", id: bf.opportunityId } as const;
const NOW = new Date().toISOString();
let tick = 0;
/** Strictly increasing decided_at so "latest wins" is deterministic. */
function at(): string {
  tick += 1;
  return new Date(Date.now() + tick * 1000).toISOString();
}

function recordGate(entityId: string, gate: string, decision: "go" | "hold" | "kill"): void {
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), "opportunity", entityId, gate, decision, "s6-pre-fs-gate fixture", "test-actor", at()],
  );
}

const stage = (id: string) => {
  const s = evaluateProcess(OPP).stages.find((x) => x.id === id);
  if (!s) throw new Error(`stage ${id} missing`);
  return s;
};

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

beforeEach(() => {
  // gate_decision is append-only (ADR-0186): neutralise earlier rows with the stale marker the engine already skips.
  db.run(
    `INSERT OR IGNORE INTO gate_decision_stale (decision_id, stale_at, stale_reason)
     SELECT id, ?, 'test reset' FROM gate_decision WHERE entity_id = ?`,
    [NOW, bf.opportunityId],
  );
  db.run("DELETE FROM brownfield_target_eval_state");
  db.run("UPDATE opportunity SET created_at = ?, target_universe_json = ? WHERE id = ?", [
    NOW,
    UNIVERSE,
    bf.opportunityId,
  ]);
});

describe("cut-off constant", () => {
  test("PRE_FS_S6_GATE_DATE is the ADR-0205 release date and the helper compares created_at against it", () => {
    expect(PRE_FS_S6_GATE_DATE).toBe("2026-11-21");
    expect(opportunityPreFsS6Grandfathered({ created_at: "2026-11-20T23:59:59Z" })).toBe(true);
    expect(opportunityPreFsS6Grandfathered({ created_at: "2026-11-21T00:00:00Z" })).toBe(false);
    expect(opportunityPreFsS6Grandfathered({ created_at: null })).toBe(true);
  });
});

describe("S6 requires a Pre-FS GO", () => {
  test("without a GO: S6 is current, s6.pre_fs_go is the only (last) blocker, S7 is locked", () => {
    const s6 = stage("S6");
    expect(s6.status).toBe("current");
    expect(s6.missing).toEqual(["s6.pre_fs_go"]);
    expect(s6.blockers).toHaveLength(1);
    expect(s6.exempt).toBe(false);
    expect(stage("S7").status).toBe("locked");
    expect(evaluateProcess(OPP).currentStage).toBe("S6");
  });

  test("a data blocker precedes it; blockers[] and missing[] stay index-aligned", () => {
    db.run("DELETE FROM brownfield_target_evidence WHERE target_id = 'demo-s1-s12-target-2'");
    try {
      const s6 = stage("S6");
      expect(s6.missing.at(-1)).toBe("s6.pre_fs_go");
      expect(s6.missing.length).toBeGreaterThan(1);
      expect(s6.blockers).toHaveLength(s6.missing.length);
      expect(s6.missing).not.toContain(undefined);
    } finally {
      db.run(
        `INSERT OR IGNORE INTO brownfield_target_evidence (id, target_id, kind, title, detail, source_kind, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [ulid(), "demo-s1-s12-target-2", "discovery", "restored", "restored", "manual", "test-actor", NOW],
      );
    }
  });

  test("no-Universe early return still appends the pre_fs blocker last, index-aligned", () => {
    const before = db.query("SELECT target_universe_json AS j FROM opportunity WHERE id = ?").get(bf.opportunityId) as {
      j: string | null;
    };
    db.run("UPDATE opportunity SET target_universe_json = NULL WHERE id = ?", [bf.opportunityId]);
    try {
      const s6 = stage("S6");
      expect(s6.missing).toEqual(["s6.target_universe", "s6.pre_fs_go"]);
      expect(s6.blockers).toHaveLength(2);
    } finally {
      db.run("UPDATE opportunity SET target_universe_json = ? WHERE id = ?", [before.j, bf.opportunityId]);
    }
  });

  test("with a GO: S6 is complete and the process moves on to S7", () => {
    recordGate(bf.opportunityId, "pre_fs", "go");
    expect(evaluateProcess(OPP).completedStages).toContain("S6");
    expect(stage("S6").status).toBe("complete");
    expect(stage("S6").missing).toEqual([]);
    expect(stage("S7").status).not.toBe("locked");
  });

  test("a later HOLD regresses S6 and relocks S7; S7 work is retained; a new GO recovers", () => {
    recordGate(bf.opportunityId, "pre_fs", "go");
    const targetsBefore = db
      .query("SELECT id, status FROM brownfield_target WHERE opportunity_id = ? ORDER BY id")
      .all(bf.opportunityId);
    expect(targetsBefore.length).toBeGreaterThan(0);

    recordGate(bf.opportunityId, "pre_fs", "hold");
    expect(stage("S6").status).toBe("current");
    expect(stage("S6").missing).toEqual(["s6.pre_fs_go"]);
    expect(stage("S6").blockers[0]).toContain("HOLD");
    expect(stage("S7").status).toBe("locked");
    expect(evaluateProcess(OPP).completedStages).not.toContain("S6");
    // S7 work (shortlist/exclusions) is untouched by the regression
    expect(
      db.query("SELECT id, status FROM brownfield_target WHERE opportunity_id = ? ORDER BY id").all(bf.opportunityId),
    ).toEqual(targetsBefore);

    recordGate(bf.opportunityId, "pre_fs", "go");
    expect(stage("S6").status).toBe("complete");
  });

  test("a KILL terminates the process", () => {
    recordGate(bf.opportunityId, "pre_fs", "kill");
    const ev = evaluateProcess(OPP);
    expect(ev.terminated).toBe(true);
    expect(stage("S6").status).toBe("terminated");
  });
});

describe("grandfathering (created before the cut-off)", () => {
  test("no pre_fs blocker, S6 complete without a GO; exempt is true on S6 only", () => {
    db.run("UPDATE opportunity SET created_at = '2026-11-20T10:00:00Z' WHERE id = ?", [bf.opportunityId]);
    const ev = evaluateProcess(OPP);
    const s6 = ev.stages.find((s) => s.id === "S6");
    expect(s6?.status).toBe("complete");
    expect(s6?.missing).not.toContain("s6.pre_fs_go");
    expect(s6?.exempt).toBe(true);
    for (const s of ev.stages) if (s.id !== "S6") expect(s.exempt).toBe(false);
    expect(stage("S7").status).not.toBe("locked");
  });

  test("a fresh (non-exempt) opportunity reports exempt false everywhere", () => {
    for (const s of evaluateProcess(OPP).stages) expect(s.exempt).toBe(false);
  });
});

describe("circularity: pre_fs GO prerequisite is the S6 DATA blockers only", () => {
  test("accepted while S6 is incomplete solely for want of the GO", () => {
    expect(stage("S6").status).toBe("current");
    expect(gateGoPrerequisiteGaps(OPP, "pre_fs")).toEqual([]);
  });

  test("a data blocker still blocks the GO and is named", () => {
    db.run("UPDATE opportunity SET target_universe_json = NULL WHERE id = ?", [bf.opportunityId]);
    const gaps = gateGoPrerequisiteGaps(OPP, "pre_fs");
    expect(gaps).toEqual([`S6 대상 후보 발굴 데이터 미완료 — ${blocker("s6.target_universe")}`]);
    expect(gaps.join()).not.toContain(blocker("s6.pre_fs_go"));
  });

  test("target_screening still needs S7 complete (and so S6 with its GO)", () => {
    expect(gateGoPrerequisiteGaps(OPP, "target_screening").length).toBeGreaterThan(0);
  });

  test("ADR-0202: a live unreviewed AI-draft verdict still blocks the pre_fs GO", () => {
    const targetId = "demo-s1-s12-target-1";
    const criterionId = ulid();
    db.run(
      "INSERT INTO brownfield_eval_criterion (id, opportunity_id, category, source, label, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [criterionId, bf.opportunityId, "financial", "custom", "pre-fs gate criterion", "test-actor", NOW],
    );
    db.run(
      `INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, assessed_by, assessed_at, verdict_source)
       VALUES (?,?,?,?,?,?,?)`,
      [ulid(), targetId, criterionId, "pass", "test-actor", NOW, "ai_draft"],
    );
    expect(gateGoPrerequisiteGaps(OPP, "pre_fs")).toEqual([`${AI_DRAFT_REVIEW_GAP_PREFIX}1`]);
  });
});

describe("greenfield pre_fs prerequisite is unchanged", () => {
  const GF = { type: "opportunity", id: gf.opportunityId } as const;

  test("S1-S5 complete: no gap, and no S6 gap or exempt flag on the greenfield track", () => {
    const ev = evaluateProcess(GF);
    expect(ev.track).toBe("greenfield");
    expect(gateGoPrerequisiteGaps(GF, "pre_fs")).toEqual([]);
    expect(ev.stages.find((s) => s.id === "S6")?.exempt).toBe(false);
  });

  test("an incomplete S5 is the gap, as before", () => {
    const row = db
      .query("SELECT * FROM greenfield_assessment WHERE opportunity_id = ?")
      .get(gf.opportunityId) as Record<string, unknown> | null;
    expect(row).toBeTruthy();
    db.run("DELETE FROM greenfield_assessment WHERE opportunity_id = ?", [gf.opportunityId]);
    try {
      const gaps = gateGoPrerequisiteGaps(GF, "pre_fs");
      expect(gaps.some((g) => g.startsWith("S5") && g.endsWith("미완료"))).toBe(true);
      expect(gaps.some((g) => g.includes("S6"))).toBe(false);
    } finally {
      const cols = Object.keys(row as object);
      db.run(
        `INSERT INTO greenfield_assessment (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        cols.map((c) => (row as Record<string, never>)[c]),
      );
    }
  });
});
