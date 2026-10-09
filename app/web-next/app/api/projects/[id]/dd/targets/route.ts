// POST /api/projects/[id]/dd/targets — open DD on a shortlisted, NON-selected
// brownfield target as comparison evidence (ADR-0157, design
// 2026-10-09-optional-per-target-dd). The selected target stays the only gate
// subject; an opened target gets its own judgements, custom items, findings
// and waivers, and nothing recorded there can move the S9 predicate or the dd
// gate. Opening is the cost-control point and a HUMAN act (boundary #2): the
// route accepts a logged-in human web session only — bearer tokens (personal,
// agent or MCP-delegated) and agent identities are refused; an agent may only
// propose it (propose_approval). A rationale is required, the target must be
// shortlisted on the source opportunity, the call is idempotent on
// (project, target) and writes an audit entry on first open.
import { AGENT_KEYS } from "../../../../../../lib/agent-registry.generated.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { DdTargetError, openDdTarget } from "../../../../../../lib/dd-target.ts";
import { ddTargetErrorResponse } from "../../../../../../lib/dd-target-http.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie") {
    return forbidden("session_required", "대상별 DD는 로그인한 사람의 웹 세션에서만 열 수 있습니다 — 에이전트·토큰은 propose_approval로 제안만 할 수 있습니다.");
  }
  if (AGENT_KEYS.has(ctx.userId)) {
    return forbidden("agent_forbidden", "에이전트 신원은 대상별 DD를 열 수 없습니다 (경계 #1/#2).");
  }
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "대상별 DD 열기는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { target_id?: string; rationale?: string } | null;
  if (!body?.target_id?.trim()) return badRequest("invalid_request", "target_id는 필수입니다.");
  if (!body.rationale?.trim()) return badRequest("invalid_request", "DD를 여는 근거(rationale)는 필수입니다.");
  try {
    const record = openDdTarget(id, body.target_id.trim(), body.rationale, ctx.userId);
    return ok(
      {
        id: record.id,
        project_id: record.projectId,
        target_id: record.targetId,
        opened_by: record.openedBy,
        opened_at: record.openedAt,
        rationale: record.rationale,
        source: record.source,
        already_open: !record.created,
      },
      record.created ? 201 : 200,
    );
  } catch (err) {
    if (err instanceof DdTargetError) return ddTargetErrorResponse(err);
    throw err;
  }
});
