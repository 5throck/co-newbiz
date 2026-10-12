// Greenfield S9 scope (ADR-0160 + 2026-10-12 addendum, migration 0136).
// GET: the sub-track selection (extra checklists, site scope, excluded steps,
// warnings) — `greenfield_scope: null` for brownfield / unrouted projects.
// POST is HUMAN-ONLY (boundary #2): cookie session + CSRF (authenticate()),
// analyst+, project visibility. Bearer / OAuth-delegated / agent callers get
// 403 human_only and the MCP in-process port refuses the route via
// HUMAN_ONLY_ROUTES. Actions:
//   (default) / confirm_site_required — body {site_required: boolean,
//                           rationale: string}. Single-person confirmation
//                           (user decision 2026-10-12, ADR-0160 addendum (d)):
//                           the asserter's review is recorded in the same
//                           transaction, so the value drives routing at once;
//                           re-confirming supersedes. evidence_ref is not
//                           collected (ignored if sent).
//   opt_in                — recorded pin migration to greenfield-dd 1.1.0
//                           selection for a grandfathered project (migration_note)
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../lib/mcp/principal-context.ts";
import {
  confirmSiteRequired,
  greenfieldSelection,
  optInSubTrackSelection,
  type ScopeResult,
} from "../../../../../lib/greenfield-subtrack.ts";
import { workspaceScopeView } from "../../../../../lib/dd-checklist-tailor.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const sel = greenfieldSelection(id);
  // ADR-0160 addendum (b): workspace scope block only when active (absent otherwise).
  const ws = sel ? workspaceScopeView(id, sel) : null;
  return ok({ greenfield_scope: sel ? { ...sel, ...(ws ? { workspace_scope: ws } : {}) } : null }, 200);
}

function failure(r: Extract<ScopeResult<object>, { ok: false }>) {
  if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
  if (r.code === "not_found") return notFound(r.message);
  return fail(409, r.code, r.message);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "부지 필요 여부 확인과 선택 전환은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 제안만 가능합니다.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action === undefined || action === "confirm_site_required") {
    const r = confirmSiteRequired({ projectId: id, value: body?.site_required, rationale: body?.rationale, actor: ctx.userId });
    return r.ok ? ok({ assertion_id: r.assertion_id, greenfield_scope: greenfieldSelection(id) }, 201) : failure(r);
  }
  if (action === "opt_in") {
    const r = optInSubTrackSelection({ projectId: id, migrationNote: body?.migration_note, actor: ctx.userId });
    return r.ok ? ok({ pin_id: r.pin_id, greenfield_scope: greenfieldSelection(id) }, 201) : failure(r);
  }
  return badRequest("invalid_request", "action은 생략(부지 필요 여부 확인) | confirm_site_required | opt_in 중 하나입니다.");
}
