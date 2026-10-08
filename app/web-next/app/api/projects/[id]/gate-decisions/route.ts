// Gate decisions for one project — S8~S12 gates (ADR-0094/0095/0098).
// Same contract as the opportunity route: gates are HUMAN outputs (boundary
// #2); this route records the decision a reviewer made, it does not compute
// one. HOLD requires an explicit missing-artifacts list. The v1
// /api/projects/:id/gate-decisions tree was removed with the project
// workflow (ADR-0074); this is the S8+ project-entity carrier's surface.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { gateGoPrerequisiteGaps, latestGateDecisions, type GateId } from "../../../../../lib/process-flow.ts";
import { badRequest, fail, forbidden, notFound, ok, unprocessable } from "../../../../../lib/envelope.ts";
import { captureReviewSnapshot, recordHumanFinalReview } from "../../../../../lib/review/human-final.ts";

const GATES = new Set(["fs", "dd", "entity_ic", "group_ic"]);
const DECISIONS = new Set(["go", "hold", "kill"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const history = db
    .query(
      `SELECT id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at
       FROM gate_decision WHERE entity_type = 'project' AND entity_id = ?
       ORDER BY decided_at DESC`,
    )
    .all(id) as Array<{ id: string; gate: string; decision: string; rationale: string; missing_artifacts_json: string | null; decided_by: string; decided_at: string }>;
  // Latest decision per gate — same helper as the process engine, so the
  // tie-breaking rule cannot drift between surfaces.
  const latestMap = latestGateDecisions("project", id);
  const latest = [...latestMap.entries()].map(([gate, v]) => ({
    gate,
    decision: v.decision,
    rationale: v.rationale,
    missing_artifacts: v.missing,
  }));
  return ok({ latest, history }, 200, { count: history.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "의사결정 기록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    gate?: string; decision?: string; rationale?: string; missing_artifacts?: string[];
    gate_evaluation_id?: string; learning_capture?: string;
  } | null;
  if (!body?.gate || !GATES.has(body.gate)) {
    return badRequest("invalid_request", `gate must be one of ${[...GATES].join("|")}.`);
  }
  if (!body.decision || !DECISIONS.has(body.decision)) {
    return badRequest("invalid_request", `decision must be one of ${[...DECISIONS].join("|")}.`);
  }
  const rationale = body.rationale?.trim();
  if (!rationale) return badRequest("invalid_request", "rationale is required — a gate decision without its reasoning is not recordable.");
  const missing = (body.missing_artifacts ?? []).map((m) => m.trim()).filter(Boolean);
  if (body.decision === "hold" && missing.length === 0) {
    return badRequest("hold_requires_artifacts", "HOLD 결정에는 missing_artifacts(미완료 산출물 목록)가 필요합니다.");
  }
  // ADR-0152 — every KILL carries learning capture (422 when absent).
  const learningCapture = body.learning_capture?.trim() || null;
  if (body.decision === "kill" && !learningCapture) {
    return unprocessable("learning_capture_required", "KILL 결정에는 learning_capture(학습 포착)가 필요합니다 — 중단 사유에서 얻은 교훈이 회수되어야 합니다 (ADR-0152).");
  }
  const db = getDb();
  // Wave C-3 (pilot-009 D-4): GO needs the gate's stage prerequisites complete.
  // HOLD/KILL stay allowed anytime. New writes only — existing rows are untouched.
  if (body.decision === "go") {
    const gaps = gateGoPrerequisiteGaps({ type: "project", id }, body.gate as GateId);
    if (gaps.length > 0) {
      return fail(409, "gate_prerequisites_incomplete", `GO 불가 — ${body.gate} 진행의 선행 단계가 완료되지 않았습니다: ${gaps.join("; ")}. HOLD 또는 KILL은 언제든 기록할 수 있습니다.`);
    }
  }
  const gateEvaluationId = body.gate_evaluation_id?.trim() || null;
  if (gateEvaluationId && !db.query("SELECT id FROM gate_evaluation WHERE id = ?").get(gateEvaluationId)) {
    return badRequest("invalid_request", "gate_evaluation_id가 존재하지 않습니다 — 위원회 세션의 gate_evaluation을 확인하세요.");
  }
  // Provenance binding: the cited evaluation's process_run must address THIS
  // project — another entity's proposal cannot be recorded as this gate's
  // provenance.
  if (gateEvaluationId) {
    const bound = db
      .query(
        `SELECT e.id FROM gate_evaluation e JOIN process_run r ON r.id = e.process_run_id
         WHERE e.id = ? AND r.entity_type = 'project' AND r.entity_id = ?`,
      )
      .get(gateEvaluationId, id);
    if (!bound) {
      return badRequest("provenance_mismatch", "gate_evaluation_id가 이 프로젝트의 위원회 세션 산출물이 아닙니다.");
    }
  }
  const nowTs = new Date().toISOString();
  const gid = ulid();
  // ADR-0153 — snapshot the artifact as the human saw it, BEFORE the decision lands.
  const reviewSnapshot = captureReviewSnapshot(body.gate, id);
  db.run(
    `INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at, gate_evaluation_id, learning_capture)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [gid, "project", id, body.gate, body.decision, rationale,
      body.decision === "hold" ? JSON.stringify(missing) : null, ctx.userId, nowTs, gateEvaluationId, body.decision === "kill" ? learningCapture : null],
  );
  appendAudit(db, { actor: ctx.userId, action: "gate_decision.record", target: `${id}:${body.gate}:${body.decision}`, now: nowTs });
  // ADR-0153 — human_final review row: a side effect of THIS human POST only.
  recordHumanFinalReview(reviewSnapshot, ctx.userId, body.decision);
  return ok({ id: gid, gate: body.gate, decision: body.decision }, 201);
}
