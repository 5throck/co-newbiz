// Gate decisions for one opportunity — S1~S7 gates (ADR-0094).
// Gates are HUMAN outputs (boundary #2): this route records the decision a
// reviewer made, it does not compute one. HOLD requires an explicit
// missing-artifacts list so a HOLD never reads as a soft pass. The MCP
// record_gate_decision / get_gate_decisions tools bind to this route — the
// former /api/projects/:id/gate-decisions tree was deleted with the project
// workflow (ADR-0074) and opportunity is the S1~S7 lifecycle carrier.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { latestGateDecisions } from "../../../../../lib/process-flow.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";

// Gate placement (2026-09-12): the opportunity is the S1–S7 carrier, so only
// the S1–S7 gates are recordable here — fs/dd/entity_ic/group_ic belong to the
// project carrier (S8–S12) and are rejected before any write. Existing rows
// are untouched; this validates new recordings only.
const GATES = new Set(["screening", "pre_fs", "target_screening"]);
const DECISIONS = new Set(["go", "hold", "kill"]);

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const history = db
    .query(
      `SELECT id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at
       FROM gate_decision WHERE entity_type = 'opportunity' AND entity_id = ?
       ORDER BY decided_at DESC`,
    )
    .all(id) as Array<{ id: string; gate: string; decision: string; rationale: string; missing_artifacts_json: string | null; decided_by: string; decided_at: string }>;
  // Latest decision per gate — same helper as the process engine (ADR-0094),
  // so the tie-breaking rule cannot drift between surfaces.
  const latestMap = latestGateDecisions("opportunity", id);
  const latest = [...latestMap.entries()].map(([gate, v]) => ({
    gate,
    decision: v.decision,
    rationale: v.rationale,
    missing_artifacts: v.missing,
  }));
  return ok({ latest, history,
  }, 200, { count: history.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "의사결정 기록은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    gate?: string; decision?: string; rationale?: string; missing_artifacts?: string[];
    // ADR-0097 back-compat: optional provenance link to the committee
    // deliberation that proposed this decision (0066 nullable column).
    gate_evaluation_id?: string;
  } | null;
  if (!body?.gate || !GATES.has(body.gate)) {
    return badRequest("invalid_request", `gate must be one of ${[...GATES].join("|")} — fs/dd/entity_ic/group_ic are project-carrier (S8–S12) gates and belong on /api/projects/[id]/gate-decisions.`);
  }
  if (!body.decision || !DECISIONS.has(body.decision)) {
    return badRequest("invalid_request", `decision must be one of ${[...DECISIONS].join("|")}.`);
  }
  const rationale = body.rationale?.trim();
  if (!rationale) return badRequest("invalid_request", "rationale is required — a gate decision without its reasoning is not recordable.");
  // HOLD must carry the list of what is missing; otherwise it reads as a soft pass.
  const missing = (body.missing_artifacts ?? []).map((m) => m.trim()).filter(Boolean);
  if (body.decision === "hold" && missing.length === 0) {
    return badRequest("hold_requires_artifacts", "HOLD 결정에는 missing_artifacts(미완료 산출물 목록)가 필요합니다.");
  }
  const db = getDb();
  const opp = db.query("SELECT id, name FROM opportunity WHERE id = ?").get(id) as { id: string; name: string } | null;
  if (!opp) return notFound();

  const nowTs = new Date().toISOString();
  const gid = ulid();
  // ADR-0097 back-compat: gate_evaluation_id is optional provenance — when
  // present it must reference an existing gate_evaluation. The confirming
  // record itself is still written by THIS human action, never by the
  // committee session.
  const gateEvaluationId = body.gate_evaluation_id?.trim() || null;
  if (gateEvaluationId && !db.query("SELECT id FROM gate_evaluation WHERE id = ?").get(gateEvaluationId)) {
    return badRequest("invalid_request", "gate_evaluation_id가 존재하지 않습니다 — 위원회 세션의 gate_evaluation을 확인하세요.");
  }
  // Provenance binding: the cited evaluation's process_run must address THIS
  // opportunity — another entity's proposal cannot be recorded as this gate's
  // provenance.
  if (gateEvaluationId) {
    const bound = db
      .query(
        `SELECT e.id FROM gate_evaluation e JOIN process_run r ON r.id = e.process_run_id
         WHERE e.id = ? AND r.entity_type = 'opportunity' AND r.entity_id = ?`,
      )
      .get(gateEvaluationId, id);
    if (!bound) {
      return badRequest("provenance_mismatch", "gate_evaluation_id가 이 기회의 위원회 세션 산출물이 아닙니다.");
    }
  }
  db.run(
    `INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at, gate_evaluation_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [gid, "opportunity", id, body.gate, body.decision, rationale,
      body.decision === "hold" ? JSON.stringify(missing) : null, ctx.userId, nowTs, gateEvaluationId],
  );
  appendAudit(db, { actor: ctx.userId, action: "gate_decision.record", target: `${id}:${body.gate}:${body.decision}`, now: nowTs });
  return ok({ id: gid, gate: body.gate, decision: body.decision }, 201);
});
