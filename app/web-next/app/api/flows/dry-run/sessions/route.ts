// 2026-09-15-runtime-pm-agent-orchestration §6.6 / 화면 설계 2026-10-24 §6.3 —
// /api/flows/dry-run/sessions — 드라이런 세션 목록(GET)과 생성(POST).
// 생성은 검증 + 비용 추정까지만 하고 실행하지 않는다(§6.2: 실행은 별도
// 확인 단계를 통과한다). GET은 analyst+ 읽기, POST는 analyst+ 쓰기
// (requireBusinessActor, ADR-0146 — admin은 role_forbidden).
// 가시성: 세션은 엔터티(딜)에 묶이지 않는 실험 아티팩트라 프로젝트 멤버십
// 스코프가 없다 — /api/flows/runs 의 공개 축(opportunity 행 전체 공개)과
// 동일하게 비즈니스 액터 전체가 목록을 본다(created_by 노출, mine=1 필터 제공).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { createDryRunSession, listDryRunSessions, purgeExpiredDryRunSessions } from "../../../../../lib/dry-run.ts";
import { badRequest, ok, unprocessable } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "read");
  if (guard) return guard;

  const mine = new URL(request.url).searchParams.get("mine")?.trim() === "1";
  const purged = purgeExpiredDryRunSessions();
  const sessions = listDryRunSessions({ createdBy: mine ? auth.auth.userId : null });
  return ok(sessions, 200, { count: sessions.length, purgedExpired: purged });
});

export const POST = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "write", { viewerMessage: "드라이런 세션 생성은 analyst 역할 이상이어야 합니다." });
  if (guard) return guard;

  const body = (await request.json().catch(() => null)) as {
    promptKey?: string; overrideSystem?: string | null; overrideAgentKey?: string | null;
  } | null;
  if (!body?.promptKey || typeof body.promptKey !== "string") {
    return badRequest("invalid_request", "promptKey 는 필수입니다.");
  }
  const r = createDryRunSession({
    promptKey: body.promptKey,
    overrideSystem: typeof body.overrideSystem === "string" ? body.overrideSystem : null,
    overrideAgentKey: typeof body.overrideAgentKey === "string" ? body.overrideAgentKey : null,
    createdBy: auth.auth.userId,
  });
  if (!r.ok) {
    const status = r.code === "unknown_prompt" || r.code === "unknown_agent" ? 400 : 422;
    return (status === 400 ? badRequest : unprocessable)(r.code, r.reason);
  }
  appendAudit(getDb(), { actor: auth.auth.userId, action: "dry_run.session.create", target: r.session.id, now: new Date().toISOString() });
  return ok({ session: r.session, estimate: r.estimate }, 201, {
    note: "세션이 생성되었습니다 — SSOT에는 반영되지 않으며, 실행은 별도 확인(비용 확인) 후 /execute 로 수행합니다.",
  });
});
