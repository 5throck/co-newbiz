// POST /api/projects/[id]/establishment/reopen — done -> in_progress with a
// mandatory reason (ADR-0165). Human-only: HUMAN_ONLY_ROUTES at the MCP port
// AND 403 human_only here for bearer / OAuth / agent callers. analyst+ member.
// Reopening steps 1–4 while step 5 is done is refused (409 dependent_step_done)
// unless cascade_step5 is true. Gate decisions are never revoked here.
import { authenticate, callPathOf, humanOnlyDenied } from "../../../../../../lib/auth.ts";
import { establishmentProgress, reopenEstablishmentStep } from "../../../../../../lib/establishment.ts";
import { establishmentErrorResponse } from "../../../../../../lib/establishment-http.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "설립 실행 재개는 사람만 할 수 있습니다 (boundary #2).");
  if (denied) return denied;
  if (ctx.role === "viewer") return forbidden("role_required", "설립 실행 재개는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { step_no?: number; reason?: string; cascade_step5?: boolean } | null;
  const stepNo = Number(body?.step_no);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 5) return badRequest("invalid_request", "step_no는 1–5 사이 정수입니다.");
  if (typeof body?.reason !== "string") return badRequest("invalid_request", "reason은 필수 문자열입니다.");
  if (body.cascade_step5 != null && typeof body.cascade_step5 !== "boolean") return badRequest("invalid_request", "cascade_step5는 boolean입니다.");

  const result = reopenEstablishmentStep(id, stepNo, body.reason, ctx.userId, { cascadeStep5: body.cascade_step5 === true, via: callPathOf(ctx) });
  if (!result.ok) return establishmentErrorResponse(result.error, { dependent_steps: result.dependent_steps });
  const progress = establishmentProgress(id);
  return ok(
    {
      reopened: result.reopened, status: "in_progress", updated_at: result.updated_at,
      complete: progress.complete, progress: `${progress.done}/5`,
    },
    200,
  );
}
