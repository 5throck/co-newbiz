// @version 1.0.0
/**
 * Unit tests for the Wave 5.3 governance engines — db/lib/rag-engine.ts,
 * db/lib/approval-chain.ts, db/lib/compliance.ts — against a real scratch
 * SQLite file (same pattern as observation.repository.test.ts), so the
 * migration 0006 constraints and engine SQL are exercised, not mocked.
 *
 * Figures below were verified against live engine runs before being encoded
 * (verify-then-encode): every grade/band/hold-day number asserted here was
 * produced by an actual run, not derived by hand.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  evaluateRag,
  financialBand,
  applyHysteresis,
  assessRun,
  type RagGrade,
} from "../../db/lib/rag-engine.ts";
import {
  ensureApprovalChain,
  recordDecision,
  enterGroupReview,
  submitToGroupAgenda,
  rankGroupAgenda,
} from "../../db/lib/approval-chain.ts";
import {
  checkGate,
  issueWaiver,
  waiverConcentration,
  recordInterpretation,
  searchInterpretations,
} from "../../db/lib/compliance.ts";

const TEST_DB_PATH = "db/data/test-governance-engines.sqlite";
const NOW = "2026-08-20T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let docId: string;
let entityId: string;

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [
    id,
    `NP-${id.slice(-6)}`,
    NOW,
  ]);
  return id;
}

function insertRun(project: string): string {
  const id = ulid();
  db.run(
    "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [id, project, "test", `hash-${id}`, "test", NOW],
  );
  return id;
}

/** All-six-green input; vary one axis at a time to test cap rules. */
const ALL_GREEN_INPUT = {
  stageGate: "fs" as const,
  chainGrade: "A" as const,
  financial: { irr: 0.15, hurdle: 0.1, dscrDownside: 1.5 },
  marketGrade: "green" as const,
  regulatory: { remedyType: "none" as const },
  technicalGrade: "green" as const,
  riskGrade: "green" as const,
};

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = insertProject();
  entityId = ulid();
  db.run("INSERT INTO md_entity (id, entity_code, name_ko, created_at) VALUES (?,?,?,?)", [
    entityId,
    "TEST-ENT",
    "테스트계열사",
    NOW,
  ]);
  docId = ulid();
  db.run(
    "INSERT INTO governance_doc (id, layer, key, title, version, enforceability, owner_agent, doc_path, effective_from) VALUES (?,?,?,?,?,?,?,?,?)",
    [docId, "policy", "neb-policy", "Group New-Business Review Policy", "v1.0", "mandatory", "process-governance-manager", "policies/group/neb-policy.md", NOW],
  );
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// RAG — priority-ordered overall + data-confidence cap (FR-RAG-01..03)
// ---------------------------------------------------------------------------

describe("RAG overall grading", () => {
  test("chain A with all six dimensions green grades GREEN", () => {
    const r = evaluateRag(ALL_GREEN_INPUT);
    expect(r.overall.grade).toBe("green");
  });

  test("chain B caps an otherwise all-green assessment at AMBER (D-M3-3 structural cap)", () => {
    const r = evaluateRag({ ...ALL_GREEN_INPUT, chainGrade: "B" });
    expect(r.overall.grade).toBe("amber");
    const dc = r.dimensions.find((d) => d.dimension === "data_confidence");
    expect(dc?.grade).toBe("amber");
  });

  test("chain C is judgment-withheld: data_confidence RED sinks the overall to RED even with green financials", () => {
    const r = evaluateRag({ ...ALL_GREEN_INPUT, chainGrade: "C" });
    expect(r.dimensions.find((d) => d.dimension === "financial")?.grade).toBe("green");
    expect(r.dimensions.find((d) => d.dimension === "data_confidence")?.grade).toBe("red");
    expect(r.overall.grade).toBe("red");
  });

  test("staleness violation is RED regardless of chain grade", () => {
    const r = evaluateRag({ ...ALL_GREEN_INPUT, stalenessViolated: true });
    expect(r.dimensions.find((d) => d.dimension === "data_confidence")?.grade).toBe("red");
    expect(r.overall.grade).toBe("red");
  });

  test("kill criteria forces RED despite all six dimensions green", () => {
    const r = evaluateRag({ ...ALL_GREEN_INPUT, killCriteriaTriggered: true });
    expect(r.overall.grade).toBe("red");
  });

  test("an unassessed dimension displays AMBER but is not marked assessed, and produces NO overall grade (Wave 5.10 fix)", () => {
    const r = evaluateRag({ stageGate: "fs", chainGrade: "A", financial: ALL_GREEN_INPUT.financial });
    const market = r.dimensions.find((d) => d.dimension === "market");
    expect(market?.grade).toBe("amber");
    expect(market?.assessed).toBe(false);
    expect(r.complete).toBe(false);
    // The two dimensions that WERE provided are marked assessed.
    expect(r.dimensions.find((d) => d.dimension === "financial")?.assessed).toBe(true);
    expect(r.dimensions.find((d) => d.dimension === "data_confidence")?.assessed).toBe(true);
    // No overall grade — an incomplete assessment never defaults to a color
    // (pilot-001's own manual conclusion; docs/pilots/pilot-001-system-rerun.md).
    expect(r.overall).toBeNull();
  });

  test("a Red finding on an assessed dimension still forces overall RED even when the assessment is otherwise incomplete", () => {
    const r = evaluateRag({ stageGate: "fs", chainGrade: "A", financial: { irr: 0.05, hurdle: 0.1, dscrDownside: 1.5 } });
    expect(r.dimensions.find((d) => d.dimension === "financial")?.grade).toBe("red");
    expect(r.complete).toBe(false);
    expect(r.overall?.grade).toBe("red");
  });

  test("screening/pre_fs amber-cap the financial dimension pending a completed model (rag-framework §5)", () => {
    const r = evaluateRag({ ...ALL_GREEN_INPUT, stageGate: "screening" });
    expect(r.dimensions.find((d) => d.dimension === "financial")?.grade).toBe("amber");
    expect(r.overall.grade).toBe("amber");
  });
});

// ---------------------------------------------------------------------------
// RAG — financial bands (FR-RAG-02 / D-M3-1) and remedy shapes (FR-RAG-05)
// ---------------------------------------------------------------------------

describe("financial bands", () => {
  test("IRR below hurdle in the base case is RED", () => {
    expect(financialBand({ irr: 0.09, hurdle: 0.1, dscrDownside: 1.5 }).grade).toBe("red");
  });

  test("IRR >= hurdle+2.0pp AND downside DSCR >= 1.3x is GREEN", () => {
    expect(financialBand({ irr: 0.12, hurdle: 0.1, dscrDownside: 1.3 }).grade).toBe("green");
  });

  test("between the bands is AMBER — either condition unmet", () => {
    expect(financialBand({ irr: 0.115, hurdle: 0.1, dscrDownside: 1.5 }).grade).toBe("amber"); // margin 1.5pp
    expect(financialBand({ irr: 0.13, hurdle: 0.1, dscrDownside: 1.2 }).grade).toBe("amber"); // DSCR miss
  });
});

describe("regulatory remedy shapes", () => {
  test("behavioral remedy is AMBER for the obligation duration — no discharge event", () => {
    const r = evaluateRag({ ...ALL_GREEN_INPUT, regulatory: { remedyType: "behavioral", obligationActive: true } });
    const dim = r.dimensions.find((d) => d.dimension === "regulatory_permit");
    expect(dim?.grade).toBe("amber");
    expect(dim?.remedyShape).toBe("behavioral");
    expect(r.overall.grade).toBe("amber");
  });

  test("structural remedy is AMBER while open and GREEN once discharge is confirmed", () => {
    const open = evaluateRag({ ...ALL_GREEN_INPUT, regulatory: { remedyType: "structural" } });
    expect(open.dimensions.find((d) => d.dimension === "regulatory_permit")?.grade).toBe("amber");
    const discharged = evaluateRag({
      ...ALL_GREEN_INPUT,
      regulatory: { remedyType: "structural", dischargeConfirmedAt: "2026-08-01" },
    });
    expect(discharged.dimensions.find((d) => d.dimension === "regulatory_permit")?.grade).toBe("green");
  });

  test("prohibited combination is RED (pilot 010 shape)", () => {
    const r = evaluateRag({ ...ALL_GREEN_INPUT, regulatory: { remedyType: "prohibited" } });
    expect(r.dimensions.find((d) => d.dimension === "regulatory_permit")?.grade).toBe("red");
    expect(r.overall.grade).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// RAG — hysteresis (FR-RAG-04 / D-M3-4)
// ---------------------------------------------------------------------------

describe("hysteresis", () => {
  const held8d = "2026-08-12T00:00:00Z";
  const held3d = "2026-08-17T00:00:00Z";

  test("amber->green promotion needs bar + sustain + 7-day hold (8 days, sustained 2.2pp -> green)", () => {
    const r = applyHysteresis({
      candidateGrade: "green",
      currentGrade: "amber",
      currentGradeAt: held8d,
      irrOverHurdlePp: 2.5,
      previousIrrOverHurdlePp: 2.2,
      now: NOW,
    });
    expect(r.grade).toBe("green");
  });

  test("promotion withheld at 3 days, or when the previous cycle missed the bar", () => {
    const tooSoon = applyHysteresis({
      candidateGrade: "green", currentGrade: "amber", currentGradeAt: held3d,
      irrOverHurdlePp: 2.5, previousIrrOverHurdlePp: 2.2, now: NOW,
    });
    expect(tooSoon.grade).toBe("amber");
    const notSustained = applyHysteresis({
      candidateGrade: "green", currentGrade: "amber", currentGradeAt: held8d,
      irrOverHurdlePp: 2.5, previousIrrOverHurdlePp: 1.0, now: NOW,
    });
    expect(notSustained.grade).toBe("amber");
  });

  test("green->amber demotion only below +0.5pp with hold; 0.5-2.0pp band holds Green", () => {
    const demote = applyHysteresis({
      candidateGrade: "amber", currentGrade: "green", currentGradeAt: held8d,
      irrOverHurdlePp: 0.3, previousIrrOverHurdlePp: 2.2, now: NOW,
    });
    expect(demote.grade).toBe("amber");
    const holdBand = applyHysteresis({
      candidateGrade: "amber", currentGrade: "green", currentGradeAt: held8d,
      irrOverHurdlePp: 1.0, previousIrrOverHurdlePp: 2.2, now: NOW,
    });
    expect(holdBand.grade).toBe("green");
  });

  test("a Red candidate takes effect immediately — hysteresis never delays danger", () => {
    const r = applyHysteresis({
      candidateGrade: "red", currentGrade: "green", currentGradeAt: "2026-08-19T00:00:00Z",
      irrOverHurdlePp: 5, previousIrrOverHurdlePp: 5, now: NOW,
    });
    expect(r.grade).toBe("red");
  });

  test("recovery out of Red is staged: same-day flip withheld; red->green records Amber, never one-step Green", () => {
    const sameDay = applyHysteresis({
      candidateGrade: "amber", currentGrade: "red", currentGradeAt: "2026-08-19T00:00:00Z",
      irrOverHurdlePp: 5, previousIrrOverHurdlePp: 5, now: NOW,
    });
    expect(sameDay.grade).toBe("red");
    const staged = applyHysteresis({
      candidateGrade: "green", currentGrade: "red", currentGradeAt: held8d,
      irrOverHurdlePp: 5, previousIrrOverHurdlePp: 5, now: NOW,
    });
    expect(staged.grade).toBe("amber");
  });
});

// ---------------------------------------------------------------------------
// RAG — persisted assessment (assessRun)
// ---------------------------------------------------------------------------

describe("assessRun persistence", () => {
  test("writes one row per dimension + post-hysteresis overall, and transition rows on change", () => {
    const p = insertProject();
    const run1 = insertRun(p);
    // First assessment: chain C -> red overall, initial transition from NULL.
    const first = assessRun(db, {
      projectId: p, runId: run1, input: { ...ALL_GREEN_INPUT, chainGrade: "C" },
      irrOverHurdlePp: 5, previousIrrOverHurdlePp: null, now: NOW,
    });
    expect(first.recordedOverall).toBe("red");
    expect(first.transition).toEqual({ from: null, to: "red" });

    const rowCount = (dim: string) =>
      (db.query("SELECT COUNT(*) AS c FROM rag_assessment WHERE project_id = ? AND dimension = ?").get(p, dim) as { c: number }).c;
    expect(rowCount("financial")).toBe(1);
    expect(rowCount("overall")).toBe(1);

    // Second assessment 10 days later, chain fixed to B (amber candidate):
    // red->amber recovery allowed after the 7-day hold.
    const later = "2026-08-30T10:00:00Z";
    const run2 = insertRun(p);
    const second = assessRun(db, {
      projectId: p, runId: run2, input: { ...ALL_GREEN_INPUT, chainGrade: "B" },
      irrOverHurdlePp: 5, previousIrrOverHurdlePp: 5, now: later,
    });
    expect(second.recordedOverall).toBe("amber");
    expect(second.transition).toEqual({ from: "red", to: "amber" });

    const transitions = db
      .query("SELECT from_grade, to_grade, reason FROM rag_transition WHERE project_id = ? ORDER BY at")
      .all(p) as { from_grade: string | null; to_grade: string; reason: string }[];
    expect(transitions.length).toBe(2);
    expect(transitions[0].from_grade).toBeNull();
    expect(transitions[1]).toMatchObject({ from_grade: "red", to_grade: "amber" });
  });

  test("an incomplete assessment (pilot-001 shape) writes only the assessed dimension's row, no overall row, no transition (Wave 5.10 fix)", () => {
    const p = insertProject();
    const run1 = insertRun(p);
    // Exactly pilot-001's real shape: only Regulatory/Permit has real data
    // (a behavioral remedy) — every other dimension is genuinely unknown.
    const result = assessRun(db, {
      projectId: p,
      runId: run1,
      input: { stageGate: "dd", regulatory: { remedyType: "behavioral", obligationActive: true } },
      irrOverHurdlePp: 0,
      now: NOW,
    });

    expect(result.complete).toBe(false);
    expect(result.overall).toBeNull();
    expect(result.recordedOverall).toBeNull();
    expect(result.transition).toBeNull();

    const rowCount = (dim: string) =>
      (db.query("SELECT COUNT(*) AS c FROM rag_assessment WHERE project_id = ? AND dimension = ?").get(p, dim) as { c: number }).c;
    expect(rowCount("regulatory_permit")).toBe(1); // the one real assessment
    expect(rowCount("financial")).toBe(0); // never assessed — no placeholder row
    expect(rowCount("market")).toBe(0);
    expect(rowCount("overall")).toBe(0); // no overall row at all when incomplete

    const transitionCount = (db.query("SELECT COUNT(*) AS c FROM rag_transition WHERE project_id = ?").get(p) as { c: number }).c;
    expect(transitionCount).toBe(0);
  });

  test("a Red dimension still writes an overall row and transition even when the assessment is incomplete", () => {
    const p = insertProject();
    const run1 = insertRun(p);
    const result = assessRun(db, {
      projectId: p,
      runId: run1,
      input: { stageGate: "fs", financial: { irr: 0.02, hurdle: 0.1, dscrDownside: 1.0 } }, // financial RED
      irrOverHurdlePp: -8,
      now: NOW,
    });
    expect(result.complete).toBe(false);
    expect(result.recordedOverall).toBe("red");
    expect(result.transition).toEqual({ from: null, to: "red" });

    const overallRow = db
      .query("SELECT grade FROM rag_assessment WHERE project_id = ? AND dimension = 'overall'")
      .get(p) as { grade: string } | null;
    expect(overallRow?.grade).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// Approval chain (ADR-0028, ADR-0029, FR-GOV-04..06)
// ---------------------------------------------------------------------------

describe("approval chain", () => {
  test("group entry is blocked with a recorded reason until the entity IC decides (ADR-0028)", () => {
    const p = insertProject();
    ensureApprovalChain(db, { projectId: p, now: NOW });
    const e = enterGroupReview(db, { projectId: p, now: NOW });
    expect(e.entered).toBe(false);
    expect(e.status).toBe("not_ready");
    expect(e.blockedReason).toContain("Entity IC");
    const row = db
      .query("SELECT status, blocked_reason FROM approval_chain WHERE project_id = ? AND level = 'group'")
      .get(p) as { status: string; blocked_reason: string | null };
    expect(row.status).toBe("not_ready");
    expect(row.blocked_reason).not.toBeNull();
  });

  test("withdrawn_pending_resubmission is NOT approval — the block stays (FR-GOV-06, pilot 003 F-2)", () => {
    const p = insertProject();
    ensureApprovalChain(db, { projectId: p, now: NOW });
    recordDecision(db, { projectId: p, level: "entity", decision: "withdrawn_pending_resubmission", decidedAt: NOW, now: NOW });
    const e = enterGroupReview(db, { projectId: p, now: NOW });
    expect(e.entered).toBe(false);
    expect(e.blockedReason).toContain("withdrawn");
  });

  test("entity approval opens the group gate; rejected keeps it blocked", () => {
    const pApproved = insertProject();
    ensureApprovalChain(db, { projectId: pApproved, now: NOW });
    recordDecision(db, { projectId: pApproved, level: "entity", decision: "approved", decidedAt: NOW, now: NOW });
    expect(enterGroupReview(db, { projectId: pApproved, now: NOW })).toMatchObject({ entered: true, status: "pending" });

    const pRejected = insertProject();
    ensureApprovalChain(db, { projectId: pRejected, now: NOW });
    recordDecision(db, { projectId: pRejected, level: "entity", decision: "rejected", decidedAt: NOW, now: NOW });
    expect(enterGroupReview(db, { projectId: pRejected, now: NOW }).entered).toBe(false);
  });

  test("agenda submission is gated on the entity precondition, and ranking orders red last then IRR then capital", () => {
    const pBlocked = insertProject();
    ensureApprovalChain(db, { projectId: pBlocked, now: NOW });
    expect(() =>
      submitToGroupAgenda(db, { projectId: pBlocked, cycle: "2026-09", entityId, capitalRequest: 100, irrOverHurdlePp: 3, ragGrade: "green", submittedAt: NOW }),
    ).toThrow(/ADR-0028/);

    const mk = (grade: RagGrade, irr: number, capital: number) => {
      const p = insertProject();
      ensureApprovalChain(db, { projectId: p, now: NOW });
      recordDecision(db, { projectId: p, level: "entity", decision: "conditional", decidedAt: NOW, now: NOW });
      submitToGroupAgenda(db, { projectId: p, cycle: "2026-09", entityId, capitalRequest: capital, irrOverHurdlePp: irr, ragGrade: grade, submittedAt: NOW });
      return p;
    };
    mk("green", 4.0, 200);
    mk("amber", 2.5, 100);
    mk("red", 1.0, 300); // biggest capital ask but Red — must rank last
    mk("amber", 2.5, 500); // ties the amber above on IRR, larger capital wins

    const ranked = rankGroupAgenda(db, "2026-09");
    const grades = ranked.map((r) => r.rag_grade);
    expect(grades[grades.length - 1]).toBe("red");
    expect(ranked.map((r) => [r.rag_grade, r.irr_over_hurdle_pp, r.capital_request, r.priority_rank])).toEqual([
      ["green", 4.0, 200, 1],
      ["amber", 2.5, 500, 2],
      ["amber", 2.5, 100, 3],
      ["red", 1.0, 300, 4],
    ]);
    const dbRanks = db
      .query("SELECT priority_rank FROM group_agenda WHERE cycle = ? ORDER BY priority_rank")
      .all("2026-09") as { priority_rank: number }[];
    expect(dbRanks.map((r) => r.priority_rank)).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Compliance / waiver / interpretation (ADR-0036, ADR-0037, FR-GOV-09..12)
// ---------------------------------------------------------------------------

describe("gate compliance", () => {
  test("mandatory-unsatisfied blocks, recommended-unsatisfied requires a reason instead, satisfied passes (§2-0 layers)", () => {
    const p = insertProject();
    const r = checkGate(db, {
      projectId: p, gate: "dd", now: NOW,
      requirements: [
        { ruleKey: "bf-six-validator", layer: "policy", mandatory: true, waiverEligible: false, satisfied: false },
        { ruleKey: "expert-interviews", layer: "guideline", mandatory: false, satisfied: false },
        { ruleKey: "tam-model", layer: "procedure", mandatory: true, satisfied: true },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.rows.map((x) => [x.ruleKey, x.result])).toEqual([
      ["bf-six-validator", "blocked"],
      ["expert-interviews", "reason_required"],
      ["tam-model", "pass"],
    ]);
    const persisted = db
      .query("SELECT rule_key, result FROM compliance_check WHERE project_id = ? AND gate = ? ORDER BY detected_at")
      .all(p, "dd") as { rule_key: string; result: string }[];
    expect(persisted.length).toBe(3);
  });

  test("a waiver without an expiry date is refused outright (ADR-0036)", () => {
    expect(() =>
      issueWaiver(db, { projectId: insertProject(), governanceDocId: docId, clauseRef: "sec-5.2", reason: "r", requestedBy: "a", approverRole: "pgm", expiresAt: "", now: NOW }),
    ).toThrow(/indefinite waiver/);
  });

  test("an active waiver turns blocked into waived and passes the gate; an EXPIRED waiver does not — date is authoritative", () => {
    const p = insertProject();
    const req = [
      { ruleKey: "sec-5.2-doc", layer: "policy" as const, mandatory: true, satisfied: false, governanceDocId: docId, clauseRef: "sec-5.2" },
    ];

    // Expired waiver on file (approved in July, expired Aug 1) — still blocked.
    issueWaiver(db, {
      projectId: p, governanceDocId: docId, clauseRef: "sec-5.2", reason: "legacy",
      requestedBy: "a", approverRole: "pgm", expiresAt: "2026-08-01", approvedBy: "pgm", approvedAt: "2026-07-01", now: "2026-07-01",
    });
    const before = checkGate(db, { projectId: p, gate: "dd", now: NOW, requirements: req });
    expect(before.pass).toBe(false);
    expect(before.rows[0].result).toBe("blocked");

    // Active waiver (expires end of year) — waived, gate passes.
    issueWaiver(db, {
      projectId: p, governanceDocId: docId, clauseRef: "sec-5.2", reason: "valid",
      requestedBy: "a", approverRole: "pgm", expiresAt: "2026-12-31", approvedBy: "pgm", approvedAt: NOW, now: NOW,
    });
    const after = checkGate(db, { projectId: p, gate: "dd", now: NOW, requirements: req });
    expect(after.pass).toBe(true);
    expect(after.rows[0].result).toBe("waived");
    expect(after.rows[0].waiverId).not.toBeNull();
  });

  test("the non-waivable rule (BF six-validator) stays blocked even though waivers exist elsewhere", () => {
    const p = insertProject();
    const r = checkGate(db, {
      projectId: p, gate: "dd", now: NOW,
      requirements: [
        { ruleKey: "bf-six-validator", layer: "policy", mandatory: true, waiverEligible: false, satisfied: false, governanceDocId: docId, clauseRef: "sec-9.1" },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.rows[0].result).toBe("blocked");
  });

  test(">=3 waivers on one clause is an amendment trigger, not a compliance failure (FR-GOV-11)", () => {
    const p = insertProject();
    for (const reason of ["one", "two", "three"]) {
      issueWaiver(db, { projectId: p, governanceDocId: docId, clauseRef: "sec-7.3", reason, requestedBy: "a", approverRole: "pgm", expiresAt: "2026-12-31", approvedBy: "pgm", approvedAt: NOW, now: NOW });
    }
    const conc = waiverConcentration(db);
    const hit = conc.find((c) => c.clauseRef === "sec-7.3");
    expect(hit?.count).toBe(3);
  });
});

describe("interpretation registry", () => {
  test("records, searches (published first, newest first), and refuses cross-clause supersession (FR-GOV-12)", () => {
    const i1 = recordInterpretation(db, {
      governanceDocId: docId, clauseRef: "sec-3.1",
      question: "Does sec 3.1 apply to R&BD proposals?", answer: "Yes — R&BD is a BF subtype.",
      askedBy: "analyst", answeredBy: "legal", answeredAt: "2026-08-01", published: true,
    });
    expect(() =>
      recordInterpretation(db, {
        governanceDocId: docId, clauseRef: "sec-4.2", question: "q", answer: "a",
        askedBy: "x", answeredBy: "y", answeredAt: NOW, supersedes: i1,
      }),
    ).toThrow(/never silently contradicts/);

    recordInterpretation(db, {
      governanceDocId: docId, clauseRef: "sec-3.1",
      question: "Clarify the R&BD scope under sec 3.1", answer: "Platform R&BD only; internal tooling excluded.",
      askedBy: "analyst", answeredBy: "legal", answeredAt: "2026-08-15", supersedes: i1, published: true,
    });

    const found = searchInterpretations(db, { governanceDocId: docId, clauseRef: "sec-3.1" });
    expect(found.length).toBe(2);
    expect(found[0].answered_at).toBe("2026-08-15"); // newest first
    expect(found[0].supersedes).toBe(i1);            // supersede link sits on the newer answer
    expect(searchInterpretations(db, { text: "tooling excluded" }).length).toBe(1);
  });
});
