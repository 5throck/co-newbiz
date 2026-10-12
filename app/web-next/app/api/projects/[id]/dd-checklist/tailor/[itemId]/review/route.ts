// PUT /api/projects/[id]/dd-checklist/tailor/[itemId]/review — approve or
// reject one proposed tailored checklist item (ADR-0099 §3). This is the
// HUMAN decision (design boundary #2, the same principle as ADR-0097):
// approval flips the item to 'approved' and — in the same transaction —
// inserts the project_checklist_item_state row (checklist_id
// 'custom:<domain>'), so from that moment the item is judged like any other
// item; rejection records the reject with no state row. Analyst+;
// deny-by-default visibility; a decided (or absent) item is a 404; a
// financial/hr/market/financing item of a project created before 2026-10-01
// is recorded for reference only (not counted in S9 completion). The reviewer
// must differ from the human proposer (409 second_person_required).
// The route itself enforces the human: cookie session only, no MCP principal,
// not an agent account — otherwise 403 human_only (bearer/OAuth/agent).
import { authenticate } from "../../../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../../../lib/project-visibility.ts";
import { DdCustomReviewError, reviewDdCustomItem } from "../../../../../../../../lib/dd-checklist-tailor.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../../../lib/envelope.ts";
import { DdTargetError } from "../../../../../../../../lib/dd-target.ts";
import { ddTargetErrorResponse } from "../../../../../../../../lib/dd-target-http.ts";
import { AGENT_KEYS } from "../../../../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../../../../lib/mcp/principal-context.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "제안 승인/기각은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 제안만 가능합니다.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "제안 승인/기각은 analyst 역할 이상의 인간 결정입니다.");
  const { id, itemId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== "approved" && body?.decision !== "rejected") {
    return badRequest("invalid_request", "decision은 approved | rejected 중 하나입니다.");
  }
  let result: ReturnType<typeof reviewDdCustomItem>;
  try {
    result = reviewDdCustomItem(id, itemId, body.decision, ctx.userId);
  } catch (err) {
    if (err instanceof DdTargetError) return ddTargetErrorResponse(err);
    if (err instanceof DdCustomReviewError) return fail(409, err.code, err.message);
    throw err;
  }
  if (!result) return notFound();
  return ok(result, 200);
}
