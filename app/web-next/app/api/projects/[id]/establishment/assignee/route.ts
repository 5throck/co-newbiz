// PUT /api/projects/[id]/establishment/assignee — set/clear the responsible
// person of one S11 establishment step (ADR-0165). Human-only: HUMAN_ONLY_ROUTES
// at the MCP port AND 403 human_only here for bearer / OAuth / agent callers
// (assigning a person is an accountability act). analyst+; the assignee must be
// an active member of the project. Allowed on a done step.
import { authenticate, callPathOf, humanOnlyDenied } from "../../../../../../lib/auth.ts";
import { assignEstablishmentStep, establishmentProgress } from "../../../../../../lib/establishment.ts";
import { establishmentErrorResponse } from "../../../../../../lib/establishment-http.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "설립 실행 담당자 지정은 사람만 할 수 있습니다 (boundary #2).");
  if (denied) return denied;
  if (ctx.role === "viewer") return forbidden("role_required", "설립 실행 담당자 지정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { step_no?: number; assignee_user_id?: string | null; origin?: string } | null;
  const stepNo = Number(body?.step_no);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 5) return badRequest("invalid_request", "step_no는 1–5 사이 정수입니다.");
  if (!body || !Object.prototype.hasOwnProperty.call(body, "assignee_user_id")) {
    return badRequest("invalid_request", "assignee_user_id는 필수입니다 (해제하려면 null).");
  }
  const assignee = body.assignee_user_id;
  if (assignee !== null && (typeof assignee !== "string" || assignee.trim() === "")) {
    return badRequest("invalid_request", "assignee_user_id는 문자열 또는 null입니다.");
  }
  if (body.origin != null && typeof body.origin !== "string") return badRequest("invalid_request", "origin은 문자열입니다.");

  const result = assignEstablishmentStep(id, stepNo, assignee === null ? null : assignee.trim(), ctx.userId, body.origin ?? null, callPathOf(ctx));
  if (!result.ok) return establishmentErrorResponse(result.error);
  const progress = establishmentProgress(id);
  return ok(
    {
      id: result.id, step_no: result.step_no, assignee_user_id: result.assignee_user_id,
      changed: result.changed, updated_at: result.updated_at,
      complete: progress.complete, progress: `${progress.done}/5`,
    },
    200,
  );
}
