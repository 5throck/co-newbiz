// POST /api/projects/[id]/transition-decision — the S11 human-only recorder
// surface (ADR-0101 §2, ADR-0053 recorder pattern). The venture-portfolio-IC
// makes the transition decision in the IC sitting; the session user (the
// procedure's recorder, operated per the ADR-0100 pattern) RECORDS it here —
// the route records, it never decides. That is why decided_by is pinned to
// the fixed human-role string 'venture-portfolio-ic' by the 0071 CHECK, while
// the recorder's identity travels the run/actor lineage (ADR-0005): the row's
// run_id (created here as a recorder run when the caller supplies none, or
// reused when the caller passes one belonging to this project) carries
// created_by = session user, echoed back as recorded_by. No separate
// recorded_by column exists — the ADR-0101 §1 schema is followed verbatim.
//
// Route-level rules: the 5-vocabulary is validated server-side (mirroring the
// 0071 CHECK and PORTFOLIO_TRANSITIONS), rationale is mandatory non-empty,
// and kill_with_learning_captured additionally requires a non-empty
// learning_capture (a kill must feed the playbook, ADR-0101 §2). The table is
// append-only — repeated POSTs for the same review_cycle are NEW ledger rows,
// never updates; readers surface the latest by (decided_at, id).
// Deny-by-default: non-members 404 (FR-SEC-01); viewer 403; admins excluded
// by role separation.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit, logDataAccess } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { PORTFOLIO_TRANSITIONS } from "../../../../../lib/process-flow.ts";
import { currentReviewCycle, isValidReviewCycle } from "../../../../../lib/portfolio.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

/** The decider of record is ALWAYS the human role (design boundary #2). */
const DECIDED_BY = "venture-portfolio-ic";
const KILL_DECISION = "kill_with_learning_captured";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "포트폴리오 전환 결정 기록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();

  const body = (await request.json().catch(() => null)) as {
    decision?: string; rationale?: string; learning_capture?: string;
    review_cycle?: string; run_id?: string;
  } | null;

  // 5-vocabulary — the TypeScript mirror of the 0071 CHECK.
  const decision = body?.decision;
  if (!decision || !PORTFOLIO_TRANSITIONS.includes(decision as (typeof PORTFOLIO_TRANSITIONS)[number])) {
    return badRequest("invalid_request", `decision는 ${PORTFOLIO_TRANSITIONS.join(" | ")} 중 하나입니다 (S11 어휘 5종, flow.spec v2.0.0).`);
  }
  // A kill is a governed decision, not a silent starve — rationale AND, for
  // kills, the learning capture are both mandatory.
  const rationale = (body?.rationale ?? "").trim();
  if (!rationale) return badRequest("invalid_request", "rationale은 필수입니다 — 전환 결정은 근거 없이 기록될 수 없습니다.");
  const learningCapture = (body?.learning_capture ?? "").trim();
  if (decision === KILL_DECISION && !learningCapture) {
    return badRequest("invalid_request", "kill_with_learning_captured 결정은 learning_capture가 필요합니다 — 학습 내용이 플레이북으로 회수되어야 합니다 (ADR-0101 §2).");
  }

  const now = new Date().toISOString();
  const db = getDb();

  // Review cycle: explicit, else the quarter containing now. Shape-checked
  // server-side (the 0024/0071 GLOB CHECK backs this up at the table).
  const cycle = body?.review_cycle ?? currentReviewCycle(new Date(now));
  if (!isValidReviewCycle(cycle)) {
    return badRequest("invalid_request", "review_cycle는 YYYY-Q[1-4] 형식이어야 합니다 (예: 2026-Q3).");
  }

  // Recorder lineage (ADR-0005): reuse the caller's run when it belongs to
  // this project, else open a recorder run owned by the session user. The
  // run — not a second column — is how the recorder's identity is tracked
  // alongside the pinned decided_by human role (ADR-0101 §1).
  let runId = (body?.run_id ?? "").trim();
  if (runId) {
    const run = db.query("SELECT id, project_id FROM run WHERE id = ?").get(runId) as { id: string; project_id: string } | undefined;
    if (!run) return badRequest("invalid_request", "지정한 run_id가 존재하지 않습니다.");
    if (run.project_id !== id) return badRequest("invalid_request", "지정한 run_id가 이 프로젝트의 run이 아닙니다.");
  } else {
    runId = ulid();
    db.run(
      "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [runId, id, "venture-portfolio-ic 전환 결정 기록", "recorder", ctx.userId, now],
    );
  }

  const rowId = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO venture_transition_decision
         (id, run_id, project_id, review_cycle, decision, decided_by, decided_at, rationale, learning_capture, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [rowId, runId, id, cycle, decision, DECIDED_BY, now, rationale, learningCapture || null, now],
    );
    logDataAccess(db, {
      userId: ctx.userId,
      tableKey: "venture_transition_decision",
      recordRef: `${id}:${cycle}:${decision}`,
      projectId: id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: ctx.userId,
      action: "venture_transition_decision.recorded",
      target: `${id}:${cycle} decision=${decision} decided_by=${DECIDED_BY}`,
      now,
    });
  })();

  return ok(
    {
      id: rowId,
      project_id: id,
      review_cycle: cycle,
      decision,
      decided_by: DECIDED_BY,
      recorded_by: ctx.userId, // the recorder — run.created_by lineage, NOT the decider
      decided_at: now,
      rationale,
      learning_capture: learningCapture || null,
      run_id: runId,
    },
    201,
  );
}
