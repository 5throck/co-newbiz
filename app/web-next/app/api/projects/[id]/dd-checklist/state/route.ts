// PUT /api/projects/[id]/dd-checklist/state — record one judgment on an
// applied checklist item (ADR-0099 §3 "judgment routes as needed"): a
// standard checklist item (checklist_id chk-*-dd-checklist) or an APPROVED
// custom item (checklist_id 'custom:<domain>'). Proposed-only custom items
// are not applied items and are rejected here — an unapproved proposal cannot
// be judged into coverage. 'waived' requires a waiver_id (0039 discipline).
// Analyst+; deny-by-default visibility; unknown (checklist, item) → 404.
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { BF_FEASIBILITY_CHECKLIST_ID, BF_VALIDATORS_ITEM_ID, upsertChecklistState, isMandatoryChecklistItem, isKnownChecklistItem, STATE_STATUSES, type ChecklistStateStatus } from "../../../../../../lib/dd-checklist-tailor.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { applyFamily } from "../../../../../../lib/gate-integrity.ts";
import { validateRationale } from "../../../../../../lib/rationale-check.ts";
import { DdTargetError } from "../../../../../../lib/dd-target.ts";
import { ddTargetErrorResponse, scopeOrResponse } from "../../../../../../lib/dd-target-http.ts";
import { recordHumanFinalForStageArtifacts } from "../../../../../../lib/review/human-final.ts";
import { naRequiresReason } from "../../../../../../lib/greenfield-subtrack.ts";
import { brownfieldNaRequiresReason } from "../../../../../../lib/brownfield-subtrack.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Recording checklist judgements requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    checklist_id?: string;
    item_id?: string;
    status?: string;
    note?: string;
    evidence_ref?: string;
    waiver_id?: string;
    target_id?: string;
  } | null;
  if (!body?.checklist_id?.trim() || !body.item_id?.trim()) {
    return badRequest("invalid_request", "Both checklist_id and item_id are required.");
  }
  if (!(STATE_STATUSES as readonly string[]).includes(body.status ?? "")) {
    return badRequest("invalid_request", `status must be one of: ${STATE_STATUSES.join(" | ")}.`);
  }
  // ADR-0160 §4.4: an `na` on a checklist whose applicability the greenfield
  // sub-track rule decided needs a reason (no silent drops). ADR-0162 §10: the same for
  // an in-scope brownfield project (non-baseline sub-track); m_and_a / grandfathered: never.
  if (
    body.status === "na" &&
    !body.note?.trim() &&
    (naRequiresReason(id, body.checklist_id.trim(), body.item_id.trim()) || brownfieldNaRequiresReason(id, body.checklist_id.trim()))
  ) {
    return badRequest("na_reason_required", "Marking a sub-track-ruled item as 'na' requires a reason in note.");
  }
  // ADR-0157: a non-NULL target_id must be an opened comparison target (409 otherwise).
  const scope = scopeOrResponse(id, body.target_id);
  if ("response" in scope) return scope.response;
  // ADR-0186: resolve the item (404) before any integrity logic so unknown ids never reach the audit trail.
  if (!isKnownChecklistItem(id, body.checklist_id.trim(), body.item_id.trim(), scope.targetId)) return notFound();
  // ADR-0186 D4 (family `validators`): bf-01 is derived from the validator completeness engine and is read-only; a
  // hand-written state is refused under enforce (and audited as a would-block under shadow). Gate scope only.
  if (scope.targetId === null && body.checklist_id.trim() === BF_FEASIBILITY_CHECKLIST_ID && body.item_id.trim() === BF_VALIDATORS_ITEM_ID) {
    const derivedDenied = applyFamily("validators", { entityType: "project", entityId: id, gate: "dd", actor: ctx.userId }, () => ({
      status: 409,
      code: "derived_item",
      message: "bf-01 is derived from the validator completeness engine and cannot be set by hand; record the missing validators instead.",
    }));
    if (derivedDenied) return derivedDenied;
  }
  // ADR-0186 D5 + D2: `na` on a MANDATORY item needs a reason (family `waiver`) that meets the
  // ack substance profile (family `rationale`); the second-person confirmation is a separate act
  // (POST .../state/confirm-na) and an unconfirmed mandatory `na` counts as pending under enforce.
  if (body.status === "na" && isMandatoryChecklistItem(body.checklist_id.trim(), body.item_id.trim())) {
    const naCtx = { entityType: "project" as const, entityId: id, gate: `na:${body.checklist_id.trim()}:${body.item_id.trim()}`, actor: ctx.userId };
    const note = body.note?.trim() ?? "";
    const missing = applyFamily("waiver", naCtx, () => (note ? null : { status: 400, code: "na_reason_required", message: "Marking a mandatory item as 'na' requires a reason in note." }));
    if (missing) return missing;
    if (note) {
      const weak = applyFamily("rationale", naCtx, () => {
        const r = validateRationale(note, "ack");
        return r.ok ? null : {
          status: 422,
          code: "rationale_insufficient",
          message: `The na reason does not meet the minimum substance profile (${r.reason}); state why the item does not apply.`,
          details: { field: "note", reason: r.reason, profile: "ack" },
        };
      });
      if (weak) return weak;
    }
  }
  let result: { id: string } | null;
  try {
    result = upsertChecklistState(id, body.checklist_id.trim(), body.item_id.trim(), body.status as ChecklistStateStatus, ctx.userId, {
      note: body.note,
      evidenceRef: body.evidence_ref,
      waiverId: body.waiver_id,
      targetId: scope.targetId,
    });
  } catch (err) {
    if (err instanceof DdTargetError) return ddTargetErrorResponse(err);
    throw err;
  }
  // ADR-0153: the human's checklist judgment is the human_final review of the S9 artifact.
  recordHumanFinalForStageArtifacts("S9", id, ctx.userId, "dd_checklist_judgment");
  if (!result) return notFound();
  return ok(result, 200);
}
