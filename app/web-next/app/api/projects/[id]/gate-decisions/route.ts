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
import { IC_GAP_GATES, composeRationale, icGoGapItems, parseRationale } from "../../../../../lib/ic-gap-override.ts";
import { IC_SEQUENCE, IC_STEP_LABEL, gateSequenceBlocker } from "../../../../../lib/gate-sequence-view.ts";
import { goLadderCheck, goRationaleCheck } from "../../../../../lib/gate-write-checks.ts";
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
      `SELECT g.id, g.gate, g.decision, g.rationale, g.missing_artifacts_json, g.judgement_confirmations_json, g.decided_by, g.decided_at, s.stale_at, s.stale_reason
       FROM gate_decision g LEFT JOIN gate_decision_stale s ON s.decision_id = g.id
       WHERE g.entity_type = 'project' AND g.entity_id = ?
       ORDER BY g.decided_at DESC`,
    )
    .all(id) as Array<{ id: string; gate: string; decision: string; rationale: string; missing_artifacts_json: string | null; judgement_confirmations_json: string | null; decided_by: string; decided_at: string; stale_at: string | null; stale_reason: string | null }>;
  // Latest decision per gate — same helper as the process engine, so the
  // tie-breaking rule cannot drift between surfaces.
  const latestMap = latestGateDecisions("project", id);
  const latest = [...latestMap.entries()].map(([gate, v]) => ({
    gate,
    decision: v.decision,
    ...parseRationale(v.rationale),
    missing_artifacts: v.missing,
  }));
  return ok({ latest, history: history.map((h) => ({ ...h, ...parseRationale(h.rationale), judgement_confirmations: parseConfirmations(h.judgement_confirmations_json) })) }, 200, { count: history.length });
}

/** ADR-0182 §5 — the decision's confirmation snapshot, parsed leniently. */
function parseConfirmations(raw: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Recording gate decisions requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    gate?: string; decision?: string; rationale?: string; missing_artifacts?: string[];
    gate_evaluation_id?: string; learning_capture?: string; gap_rationale?: string;
    // ADR-0182 §5 — checked 판단 필요 claims ride with the decision (the project
    // route dropped them until 2026-10-21 — fixed to match the opportunity route).
    judgement_confirmations?: string[];
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
    return badRequest("hold_requires_artifacts", "A HOLD decision requires missing_artifacts (the list of incomplete deliverables).");
  }
  // ADR-0152 — every KILL carries learning capture (422 when absent).
  const learningCapture = body.learning_capture?.trim() || null;
  if (body.decision === "kill" && !learningCapture) {
    return unprocessable("learning_capture_required", "A KILL decision requires learning_capture — lessons from the kill reason must be captured (ADR-0152).");
  }
  const db = getDb();
  // Wave C-3 (pilot-009 D-4): GO needs the gate's stage prerequisites complete.
  // HOLD/KILL stay allowed anytime. New writes only — existing rows are untouched.
  if (body.decision === "go") {
    // T-20261022-011 (flow.spec.yaml group_ic): the entity committee GO precedes the
    // group committee GO. Same rule the panel locks on (gate-sequence-view), now
    // enforced on the write path — a GO recorded out of order is 409 with the
    // file's GO-prerequisite code. Same latest-decision source as the process
    // engine (GET), so the tie-breaking cannot drift between surfaces.
    const latest = [...latestGateDecisions("project", id)].map(([gate, v]) => ({ gate, decision: v.decision as string | null }));
    const blocker = gateSequenceBlocker(IC_SEQUENCE, body.gate, latest);
    if (blocker) {
      const label = IC_STEP_LABEL[blocker as keyof typeof IC_STEP_LABEL] ?? blocker;
      return fail(409, "gate_prerequisites_incomplete", `GO is not allowed — the ${label} (${blocker}) GO must precede the ${body.gate} decision. HOLD or KILL can be recorded at any time.`);
    }
    // ADR-0186 D7 (family `ladder`): the full track ladder, incl. the source opportunity for fs.
    const ladderDenied = goLadderCheck({ entityType: "project", entityId: id, gate: body.gate, actor: ctx.userId });
    if (ladderDenied) return ladderDenied;
    const gaps = gateGoPrerequisiteGaps({ type: "project", id }, body.gate as GateId);
    if (gaps.length > 0) {
      return fail(409, "gate_prerequisites_incomplete", `GO is not allowed — prerequisite steps of the ${body.gate} stage are incomplete: ${gaps.join("; ")}. HOLD or KILL can be recorded at any time.`);
    }
  }
  const gateEvaluationId = body.gate_evaluation_id?.trim() || null;
  if (gateEvaluationId && !db.query("SELECT id FROM gate_evaluation WHERE id = ?").get(gateEvaluationId)) {
    return badRequest("invalid_request", "gate_evaluation_id does not exist — check the gate_evaluation of the committee session.");
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
      return badRequest("provenance_mismatch", "gate_evaluation_id is not an output of this project's committee session.");
    }
  }
  // R2-B item 3 - an IC GO with missing artifacts is never blocked (boundary #2: the human decides).
  // When the screen collected an override rationale, the gaps are re-derived here (never trusted from the
  // client) and stored with the decision text so the IC package can show them.
  // R2-E (2026-10-09) - the API now enforces what the screen already required: an IC GO recorded
  // while gaps are open carries a non-empty gap_rationale. The rationale IS the human's
  // acknowledgement, not a blocker; a GO with no open gaps needs none. Existing rows are
  // grandfathered (write-time check only, nothing re-read or rewritten).
  const gapRationale = body.gap_rationale?.trim();
  const icGo = body.decision === "go" && (IC_GAP_GATES as readonly string[]).includes(body.gate);
  const openGaps = icGo ? icGoGapItems(id, ctx.userId) : [];
  if (icGo && openGaps.length > 0 && !gapRationale) {
    return unprocessable(
      "ic_gap_rationale_required",
      `A ${body.gate} GO with missing deliverables requires a gap rationale (gap_rationale) — missing: ${openGaps.join("; ")}. The rationale is stored with the decision record for the investment committee.`,
    );
  }
  // ADR-0186 D2 (family `rationale`): GO only - HOLD and KILL are never blocked by the integrity families.
  if (body.decision === "go") {
    const rationaleDenied = goRationaleCheck({ entityType: "project", entityId: id, gate: body.gate, actor: ctx.userId }, rationale, gapRationale);
    if (rationaleDenied) return rationaleDenied;
  }
  const gapOverride = icGo && gapRationale && openGaps.length > 0
    ? { items: openGaps, rationale: gapRationale }
    : null;
  const storedRationale = composeRationale(rationale, gapOverride);
  const nowTs = new Date().toISOString();
  const gid = ulid();
  // ADR-0182 §5 — the checked "판단 필요" claims ride with the decision as a
  // sidecar snapshot. Optional and never blocking.
  const judgementConfirmations = Array.isArray(body.judgement_confirmations)
    ? [...new Set(body.judgement_confirmations.map((c) => String(c).trim().slice(0, 300)).filter(Boolean))].slice(0, 30)
    : [];
  // ADR-0153 — snapshot the artifact as the human saw it, BEFORE the decision lands.
  const reviewSnapshot = captureReviewSnapshot(body.gate, id);
  db.run(
    `INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at, gate_evaluation_id, learning_capture, judgement_confirmations_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [gid, "project", id, body.gate, body.decision, storedRationale,
      body.decision === "hold" ? JSON.stringify(missing) : null, ctx.userId, nowTs, gateEvaluationId, body.decision === "kill" ? learningCapture : null,
      judgementConfirmations.length > 0 ? JSON.stringify(judgementConfirmations) : null],
  );
  appendAudit(db, { actor: ctx.userId, action: "gate_decision.record", target: `${id}:${body.gate}:${body.decision}`, now: nowTs });
  // ADR-0153 — human_final review row: a side effect of THIS human POST only.
  recordHumanFinalReview(reviewSnapshot, ctx.userId, body.decision);
  return ok({ id: gid, gate: body.gate, decision: body.decision, gap_override: gapOverride }, 201);
}
