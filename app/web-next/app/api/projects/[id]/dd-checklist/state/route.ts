// PUT /api/projects/[id]/dd-checklist/state — record one judgment on an
// applied checklist item (ADR-0099 §3 "judgment routes as needed"): a
// standard checklist item (checklist_id chk-*-dd-checklist) or an APPROVED
// custom item (checklist_id 'custom:<domain>'). Proposed-only custom items
// are not applied items and are rejected here — an unapproved proposal cannot
// be judged into coverage. 'waived' requires a waiver_id (0039 discipline).
// Analyst+; deny-by-default visibility; unknown (checklist, item) → 404.
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { upsertChecklistState, STATE_STATUSES, type ChecklistStateStatus } from "../../../../../../lib/dd-checklist-tailor.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { recordHumanFinalForStageArtifacts } from "../../../../../../lib/review/human-final.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "체크리스트 판정 기록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    checklist_id?: string;
    item_id?: string;
    status?: string;
    note?: string;
    evidence_ref?: string;
    waiver_id?: string;
  } | null;
  if (!body?.checklist_id?.trim() || !body.item_id?.trim()) {
    return badRequest("invalid_request", "checklist_id와 item_id는 필수입니다.");
  }
  if (!(STATE_STATUSES as readonly string[]).includes(body.status ?? "")) {
    return badRequest("invalid_request", `status는 ${STATE_STATUSES.join(" | ")} 중 하나입니다.`);
  }
  const result = upsertChecklistState(id, body.checklist_id.trim(), body.item_id.trim(), body.status as ChecklistStateStatus, ctx.userId, {
    note: body.note,
    evidenceRef: body.evidence_ref,
    waiverId: body.waiver_id,
  });
  // ADR-0153: the human's checklist judgment is the human_final review of the S9 artifact.
  recordHumanFinalForStageArtifacts("S9", id, ctx.userId, "dd_checklist_judgment");
  if (!result) return notFound();
  return ok(result, 200);
}
