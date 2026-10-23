// 2026-09-15-runtime-pm-agent-orchestration §6.6 / 화면 설계 2026-10-24 §6.1 —
// GET /api/flows/dry-run/sessions/[sessionId] — 세션 상세(오버라이드 편집기·
// A/B 비교·실행 기록의 데이터 소스). 읽기는 analyst+(ADR-0146).
// TTL 소거를 먼저 수행한다(§6.8 — v1은 읽기 경로 정리).
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { getDryRunSessionDetail, purgeExpiredDryRunSessions } from "../../../../../../lib/dry-run.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";

export const GET = route(async (request: Request, ctx: { params: Promise<{ sessionId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "read");
  if (guard) return guard;

  const { sessionId } = await ctx.params;
  purgeExpiredDryRunSessions();
  const session = getDryRunSessionDetail(sessionId);
  if (!session) return notFound("드라이런 세션을 찾을 수 없습니다.");
  return ok(session);
});
