// POST /api/projects/[id]/business-case/adopt — human-only case adoption
// (ADR-0098 §2, design boundary #2). Generation may flag a case RECOMMENDED;
// which case feeds the fs gate is investment judgment and belongs to a human.
// This endpoint is the ONLY writer of the s8_case_adopt adoption marker —
// the generation engine never writes it (regression:
// tests/unit/business-case.test.ts). Analyst+; deny-by-default visibility.
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { GoalsAckNoteRequiredError, GoalsAckRequiredError, NotFoundError, adoptBusinessCase } from "../../../../../../lib/business-case.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { recordHumanFinalForStageArtifacts } from "../../../../../../lib/review/human-final.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "사업 채택(adopt)은 analyst 역할 이상이어야 합니다 — 채택은 인간의 판단입니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { model_id?: string; goals_ack?: { acknowledged?: unknown; note?: unknown } } | null;
  if (!body?.model_id) return badRequest("invalid_request", "model_id는 필수입니다.");
  // ADR-0159: optional acknowledgement that no business goals apply.
  const goalsAck =
    body.goals_ack && typeof body.goals_ack === "object"
      ? { acknowledged: body.goals_ack.acknowledged === true, note: typeof body.goals_ack.note === "string" ? body.goals_ack.note : undefined }
      : undefined;
  try {
    const adoption = adoptBusinessCase(id, body.model_id, ctx.userId, { goalsAck });
    // ADR-0153: the human's adoption IS the human_final review of the S8 artifacts.
    recordHumanFinalForStageArtifacts("S8", id, ctx.userId, "s8_case_adopt");
    return ok(adoption, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (e instanceof NotFoundError) return notFound();
    // ADR-0159: a confirmation requirement (not a gate block) — the UI turns it into a dialog.
    if (e instanceof GoalsAckRequiredError) return fail(409, "goals_ack_required", e.message);
    if (e instanceof GoalsAckNoteRequiredError) return badRequest("goals_ack_note_required", e.message);
    // ADR-0143 constraint violations (target not selected / wrong target) are
    // client-fixable 400s, not 404s.
    return badRequest("adoption_rejected", msg || "채택할 수 없습니다.");
  }
}
