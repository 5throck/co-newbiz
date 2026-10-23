// 2026-09-15-runtime-pm-agent-orchestration §6.7 (D6 AI 개선 제안) —
// POST /api/flows/dry-run/suggest — 프롬프트 개선 초안 또는 에이전트 재배정
// 후보를 제안한다. 제안 호출 자체가 pm.flow_suggest 카탈로그 활동으로 PM 관문 +
// 런 장부를 통과한다(§6.7, dry-run 플래그 없음 — 실제 콘솔 호출이다).
// 산출물은 제안 전용: 수락은 드라이런 세션 오버라이드에만 적용되고 저장소
// 반영은 제안 패키지 경로(D5 export)로만 가능하다. LLM 미구성·검증 실패 시
// 가짜 제안 대신 available=false + 사유("제안 생성 불가")를 반환한다.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { suggestDryRunImprovement } from "../../../../../lib/dry-run.ts";
import { badRequest, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";

export const POST = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "write", { viewerMessage: "개선 제안 생성은 analyst 역할 이상이어야 합니다." });
  if (guard) return guard;

  const body = (await request.json().catch(() => null)) as {
    promptKey?: string;
    evidence?: { recentFailures?: number; note?: string | null };
  } | null;
  if (!body?.promptKey || typeof body.promptKey !== "string") {
    return badRequest("invalid_request", "promptKey 는 필수입니다.");
  }
  const evidence = body.evidence && typeof body.evidence === "object"
    ? { recentFailures: body.evidence.recentFailures, note: body.evidence.note ?? null }
    : undefined;
  const r = await suggestDryRunImprovement(body.promptKey, evidence);
  if (!r.ok) return badRequest(r.code, r.reason);
  appendAudit(getDb(), { actor: auth.auth.userId, action: "dry_run.suggest", target: body.promptKey, now: new Date().toISOString() });
  return ok(r.suggestion, 200, { proposalOnly: true, note: "제안은 수락 시 드라이런 세션 오버라이드에만 적용됩니다 — 저장소 반영은 제안 패키지 경로 뿐입니다." });
});
