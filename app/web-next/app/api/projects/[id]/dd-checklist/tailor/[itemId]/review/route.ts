// PUT /api/projects/[id]/dd-checklist/tailor/[itemId]/review — approve or
// reject one proposed tailored checklist item (ADR-0099 §3). This is the
// HUMAN decision (design boundary #2, the same principle as ADR-0097):
// approval flips the item to 'approved' and — in the same transaction —
// inserts the project_checklist_item_state row (checklist_id
// 'custom:<domain>'), so from that moment the item is judged like any other
// item; rejection records the reject with no state row. Analyst+;
// deny-by-default visibility; a decided (or absent) item is a 404.
import { authenticate } from "../../../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../../../lib/project-visibility.ts";
import { reviewDdCustomItem } from "../../../../../../../../lib/dd-checklist-tailor.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../../lib/envelope.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "제안 승인/기각은 analyst 역할 이상의 인간 결정입니다.");
  const { id, itemId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== "approved" && body?.decision !== "rejected") {
    return badRequest("invalid_request", "decision은 approved | rejected 중 하나입니다.");
  }
  const result = reviewDdCustomItem(id, itemId, body.decision, ctx.userId);
  if (!result) return notFound();
  return ok(result, 200);
}
