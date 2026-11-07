// Cross-domain second review of one assertion (dimension_input.reviewed_by; repository review()). HUMAN-ONLY (boundary #2):
// cookie session + human principal; bearer / OAuth / agent callers get 403 human_only and the MCP in-process port refuses the
// route. The reviewer must differ from the asserter (409 second_person_required), the assertion must be the LIVE one and not
// yet reviewed (409 review_rejected). reviewed_by is ALWAYS the session user. Only a live AND reviewed row feeds the snapshot
// filler, so this is the step that makes e.g. infra.plan_finalized evidence for kill criterion #5.
import { getDb } from "../../../../../../../../../db/client.ts";
import { getAssertionById, review } from "../../../../../../../../../db/repositories/dimension-input.repository.ts";
import { AGENT_KEYS } from "../../../../../../../lib/agent-registry.generated.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { currentPrincipal } from "../../../../../../../lib/mcp/principal-context.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "Only a human can review an assertion (boundary #2) - agents may record assertions, a person reviews them.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "Reviewing an assertion requires the analyst role or higher.");
  const { id, rowId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const row = getAssertionById(db, rowId);
  if (!row || row.project_id !== id) return notFound();
  if (row.asserted_by === ctx.userId) {
    return fail(409, "second_person_required", "The reviewer must differ from the person who recorded the assertion (cross-domain second review).");
  }
  try {
    return ok(review({ input_id: rowId, reviewed_by: ctx.userId }, db), 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/not an active project_member|MNPI project/.test(message)) return notFound();
    if (message.startsWith("dimension_input_write_rejected:")) return fail(409, "review_rejected", message.replace("dimension_input_write_rejected: ", ""));
    throw e;
  }
});
