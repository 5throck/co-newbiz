// Greenfield phased capex tranches (capex_tranche, migration 0136;
// deal-structuring v1.1.0 step 6, ADR-0160 addendum). GET lists live tranches
// (?history=1 includes retired). POST is HUMAN-ONLY (boundary #2): cookie
// session + CSRF (authenticate()), analyst+, project visibility; agents and
// bearer callers get 403 human_only and the in-process MCP port refuses the
// route via HUMAN_ONLY_ROUTES. Actions: create | update | set_status | retire.
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../lib/mcp/principal-context.ts";
import {
  createCapexTranche,
  listCapexTranches,
  retireCapexTranche,
  setCapexTrancheStatus,
  updateCapexTranche,
  type TrancheResult,
} from "../../../../../lib/capex-tranches.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const history = new URL(request.url).searchParams.get("history") === "1";
  const tranches = listCapexTranches(id, { includeRetired: history });
  return ok({ tranches }, 200, { count: tranches.length });
}

function failure(r: Extract<TrancheResult<object>, { ok: false }>) {
  if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
  if (r.code === "not_found") return notFound(r.message);
  return fail(409, r.code, r.message);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "capex 트랜치 기록과 집행 판단은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 제안만 가능합니다.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action === "create") {
    const r = createCapexTranche({
      projectId: id,
      trancheNo: body?.tranche_no,
      amount: body?.amount,
      currency: body?.currency,
      releaseCondition: body?.release_condition,
      sourceStage: body?.source_stage,
      actor: ctx.userId,
    });
    return r.ok ? ok({ tranche: r.tranche }, 201) : failure(r);
  }
  if (action === "update") {
    const r = updateCapexTranche({
      projectId: id,
      trancheId: body?.tranche_id,
      amount: body?.amount,
      currency: body?.currency,
      releaseCondition: body?.release_condition,
      actor: ctx.userId,
    });
    return r.ok ? ok({ tranche: r.tranche }, 200) : failure(r);
  }
  if (action === "set_status") {
    const r = setCapexTrancheStatus({ projectId: id, trancheId: body?.tranche_id, status: body?.status, reason: body?.reason, actor: ctx.userId });
    return r.ok ? ok({ tranche: r.tranche, release_pending: r.release_pending }, 200) : failure(r);
  }
  if (action === "retire") {
    const r = retireCapexTranche({ projectId: id, trancheId: body?.tranche_id, reason: body?.reason, actor: ctx.userId });
    return r.ok ? ok({ tranche_id: r.tranche_id, retired_at: r.retired_at }, 200) : failure(r);
  }
  return badRequest("invalid_request", "action은 create | update | set_status | retire 중 하나입니다.");
}
