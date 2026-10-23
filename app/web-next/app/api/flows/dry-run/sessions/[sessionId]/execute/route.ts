// 2026-09-15-runtime-pm-agent-orchestration §6.6 (2) / 화면 설계 2026-10-24 §6.2 —
// POST /api/flows/dry-run/sessions/[sessionId]/execute — 실제 드라이런 실행.
// base(카탈로그 원본) vs override 두 호출 모두 운영 진입점 completeOrFallback +
// dryRun 컨텍스트로 수행된다(§6.6 "실제 운영 코드 경로") — 런 장부에는
// is_dry_run=1 + dry_run_group_id(=세션 id)로 기록된다. LLM 미구성이면 두 다리
// 모두 결정론 폴백 텍스트(source=synthesis 플래그 동봉)로 반환한다 — 오류가
// 아니다("LLM 없이도 완전 기능"). 드라이런 결과는 dry_run_session + llm_call_log
// 에만 기록된다(§6.6 경계 — 비즈니스 테이블 무기록).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { executeDryRun } from "../../../../../../../lib/dry-run.ts";
import { badRequest, notFound, ok, unprocessable } from "../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../lib/route.ts";

export const POST = route(async (request: Request, ctx: { params: Promise<{ sessionId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "write", { viewerMessage: "드라이런 실행은 analyst 역할 이상이어야 합니다." });
  if (guard) return guard;

  const { sessionId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { user?: string | null } | null;
  if (body?.user !== undefined && body.user !== null && typeof body.user !== "string") {
    return badRequest("invalid_request", "user 는 문자열이어야 합니다.");
  }
  const r = await executeDryRun(sessionId, { user: body?.user ?? null });
  if (!r.ok) {
    if (r.code === "not_found") return notFound(r.reason);
    if (r.code === "expired") return unprocessable(r.code, r.reason);
    return badRequest(r.code, r.reason);
  }
  appendAudit(getDb(), { actor: auth.auth.userId, action: "dry_run.session.execute", target: sessionId, now: new Date().toISOString() });
  return ok(r.result, 200, {
    note: "드라이런 호출은 런 장부에 is_dry_run 플래그로 기록되며 운영 대시보드 기본 집계에서 제외됩니다.",
  });
});
