// /api/projects/[id]/business-case/s5-disconnect - `복사본으로 되돌리기` (ADR-0178 follow-up).
// POST sets bc.s5_source = 0 (S8 computes from the promotion copy again); the pin history and
// bc.investment_basis are kept; audit `s5_plan_pin.disconnected`. Existing cases are not
// recalculated. Human only (boundary #2), analyst+, deny-by-default visibility, Green Field only,
// 409 `not_connected` when the project is not on the pinned path.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { s5PinStatusForProject } from "../../../../../../lib/s5-plan-pin-s8.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { disconnectS5, S5ConnectError } from "../../../../../../../../db/repositories/s5-connect.ts";

function s5ConnectErrorResponse(e: unknown) {
  if (e instanceof S5ConnectError) {
    if (e.code === "not_found") return notFound();
    return fail(409, e.code, e.message);
  }
  throw e;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (currentPrincipal()) return forbidden("human_only", "Only a human can restore from a copy (boundary #2).");
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Restore from copy requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  try {
    const db = getDb();
    const result = disconnectS5(db, id, ctx.userId);
    return ok({ ...result, status: s5PinStatusForProject(db, id) }, 200);
  } catch (e) {
    return s5ConnectErrorResponse(e);
  }
}
