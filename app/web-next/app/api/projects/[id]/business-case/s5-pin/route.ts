// /api/projects/[id]/business-case/s5-pin - the S5 plan pin of a Green Field project (ADR-0178
// slice 0). GET returns the pin/stale status and the re-pin preview (pinned vs current S5 totals,
// confirmed run); POST pins: the INITIAL pin when none exists, otherwise `최신 S5로 갱신` (supersede
// the current pin, insert the next, refresh the compat copy through the PR #590 (design-token-exempt: PR number in prose, not a color) re-import, audit
// `s5_plan_pin.repinned` - one transaction). Existing cases/simulations/adopted results are never
// touched and bc.s5_source / bc.investment_basis are never changed. Human only (agent principals are
// rejected, boundary #2), analyst+, deny-by-default visibility, Green Field only.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { s5PinStatusForProject, getCurrentS5PlanPin } from "../../../../../../lib/s5-plan-pin-s8.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { createS5PlanPin, previewS5Repin, repinS5Plan, S5PinError } from "../../../../../../../../db/repositories/s5-plan-pin.ts";
import { S5ReimportError } from "../../../../../../../../db/repositories/s5-cost-import.ts";

async function guard(request: Request, params: Promise<{ id: string }>) {
  const auth = authenticate(request);
  if (!auth.ok) return { response: auth.response };
  const ctx = auth.auth;
  if (currentPrincipal()) return { response: forbidden("human_only", "Only a human can refresh the pinned S5 reference (boundary #2).") };
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Pinned S5 reference refresh requires the analyst role or higher." });
  if (denied) return { response: denied };
  const { id } = await params;
  if (!visibleProject(ctx, id)) return { response: notFound() };
  return { ctx, id };
}

function errorResponse(e: unknown) {
  if (e instanceof S5PinError) {
    if (e.code === "not_found") return notFound();
    return fail(409, e.code, e.message);
  }
  if (e instanceof S5ReimportError) {
    if (e.code === "not_found") return notFound();
    return fail(409, e.code, e.message);
  }
  throw e;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(request, params);
  if ("response" in g) return g.response;
  try {
    const preview = previewS5Repin(getDb(), g.id);
    return ok({ status: s5PinStatusForProject(getDb(), g.id), preview });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(request, params);
  if ("response" in g) return g.response;
  try {
    const db = getDb();
    const hadPin = !!getCurrentS5PlanPin(db, g.id);
    const result = hadPin
      ? repinS5Plan(db, g.id, g.ctx!.userId)
      : { ...createS5PlanPin(db, { projectId: g.id, actor: g.ctx!.userId }), copy_refreshed: false, copy_model_id: null, archived_model_ids: [] as string[] };
    return ok(
      {
        pin_id: result.pin.id,
        written: result.written,
        superseded_pin_id: result.superseded_pin_id,
        action: result.action,
        copy_refreshed: result.copy_refreshed,
        copy_model_id: result.copy_model_id,
        archived_model_ids: result.archived_model_ids,
        status: s5PinStatusForProject(db, g.id),
      },
      200,
      { written: String(result.written) },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
