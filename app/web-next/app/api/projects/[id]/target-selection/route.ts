// POST /api/projects/[id]/target-selection — the human target-selection
// record for brownfield S8 (ADR-0143, design
// 2026-09-22-s8-multi-target-feasibility). The comparison engine may flag a
// RECOMMENDED target; which target the project proceeds with is investment
// judgment and belongs to a human (boundary #2, ADR-0053). This endpoint is
// the ONLY writer of the s8_target_select process_run stage and finalizes
// md_project.company_id (the rank-1 binding at promotion was provisional).
// Analyst+; deny-by-default visibility. GET returns the latest record.
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { NotFoundError, latestTargetSelection, selectTarget } from "../../../../../lib/business-case.ts";
import { recordHumanFinalForStageArtifacts } from "../../../../../lib/review/human-final.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok({ target_selection: latestTargetSelection(id) }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Target selection requires the analyst role or higher — selection is a human judgement.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { target_id?: string; rationale?: string } | null;
  if (!body?.target_id) return badRequest("invalid_request", "target_id is required.");
  if (!body.rationale?.trim()) return badRequest("invalid_request", "Selection rationale is required (ADR-0053 decision record).");
  if (body.rationale.length > 4000) return badRequest("invalid_request", "The selection rationale must be at most 4,000 characters.");
  try {
    const selection = selectTarget(id, body.target_id, body.rationale, ctx.userId);
    // ADR-0153: the human's target selection is the human_final review of the S8 artifacts.
    recordHumanFinalForStageArtifacts("S8", id, ctx.userId, "target_selection");
    return ok(selection, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (e instanceof NotFoundError) return notFound();
    // Not-brownfield / not-on-shortlist / empty rationale are client-fixable.
    return badRequest("selection_rejected", msg || "The target cannot be selected.");
  }
}
