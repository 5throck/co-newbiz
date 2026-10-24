// 2026-09-15-runtime-pm-agent-orchestration §6.6 (4) — POST /api/flows/dry-run/
// sessions/[sessionId]/export — 제안 패키지(프롬프트 원문·diff 요약·선호·
// 드라이런 증거·카탈로그 버전)를 markdown으로 내보낸다. 이것이 드라이런 결과의
// 유일한 영구 착지 차량이다 — 패키지는 Design Gate를 통과한 저장소 PR로만
// 반영되며, 이 API는 아티팩트를 생산할 뿐 SSOT을 쓰지 않는다.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { buildExportPackage, renderExportMarkdown } from "../../../../../../../lib/dry-run.ts";
import { notFound, ok, unprocessable } from "../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../lib/route.ts";

export const POST = route(async (request: Request, ctx: { params: Promise<{ sessionId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "write", { viewerMessage: "Proposal-package export requires the analyst role or higher." });
  if (guard) return guard;

  const { sessionId } = await ctx.params;
  const r = buildExportPackage(sessionId);
  if (!r.ok) {
    if (r.code === "not_found") return notFound(r.reason);
    return unprocessable(r.code, r.reason);
  }
  const markdown = renderExportMarkdown(r.pkg);
  appendAudit(getDb(), { actor: auth.auth.userId, action: "dry_run.session.export", target: sessionId, now: new Date().toISOString() });
  return ok(
    {
      filename: `dry-run-proposal-${sessionId}.md`,
      contentType: "text/markdown; charset=utf-8",
      markdown,
      pkg: r.pkg,
    },
    200,
    { proposalOnly: true, note: "패키지는 제안 전용입니다 — 착지 경로는 Design Gate를 통과한 저장소 PR 뿐입니다." },
  );
});
