// 2026-09-15-runtime-pm-agent-orchestration §6.6 (3) / 화면 설계 2026-10-24 §13-5 —
// POST /api/flows/dry-run/sessions/[sessionId]/preference — A/B 비교 결과에 대한
// 사용자 선호 기록(골든셋 시드). 3상(base|override|tie) + 자유 텍스트 비고 1줄.
// 실행(base_output 존재) 전에는 기록할 수 없다 — 판정 대상이 없는 선호는 데이터가
// 아니라 소음이다.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { recordPreference } from "../../../../../../../lib/dry-run.ts";
import { badRequest, notFound, ok, unprocessable } from "../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../lib/route.ts";

export const POST = route(async (request: Request, ctx: { params: Promise<{ sessionId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "write", { viewerMessage: "Recording preferences requires the analyst role or higher." });
  if (guard) return guard;

  const { sessionId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { preference?: string; note?: string | null } | null;
  if (!body?.preference) return badRequest("invalid_request", "preference is required (base|override|tie).");
  const r = recordPreference(sessionId, body.preference, body.note ?? null);
  if (!r.ok) {
    if (r.code === "not_found") return notFound(r.reason);
    if (r.code === "not_executed") return unprocessable(r.code, r.reason);
    return badRequest(r.code, r.reason);
  }
  appendAudit(getDb(), { actor: auth.auth.userId, action: "dry_run.session.preference", target: sessionId, now: new Date().toISOString() });
  return ok({ session: r.session });
});
