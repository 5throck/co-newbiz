// Project-level business goals (ADR-0159, design 2026-10-11-s8-project-
// business-goals). GET lists goals plus the resolved view (project > affiliate
// > group, per metric). POST is HUMAN-ONLY (boundary #2): cookie session +
// CSRF, analyst+, project visibility. Bearer / OAuth-delegated / agent callers
// get 403 human_only and the MCP in-process port refuses the route via
// HUMAN_ONLY_ROUTES. Goals are reference evidence only (ADR-0114): they never
// block a gate, change RAG or re-rank scenarios. Every write is append-only
// history with an audit entry (project_goal.create|supersede|retire).
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, migrationPendingResponse, notFound, ok } from "../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../lib/mcp/principal-context.ts";
import { METRIC_PRESETS, countGoalsBySource, presetFor, resolveProjectTargets } from "../../../../../lib/business-targets.ts";
import {
  createProjectGoal,
  listProjectGoals,
  retireProjectGoal,
  supersedeProjectGoal,
  type GoalResult,
} from "../../../../../lib/project-goals.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  // Admin is blocked from deal content (ADR-0146): visibleProject returns null.
  if (!visibleProject(auth.auth, id)) return notFound();
  const history = new URL(request.url).searchParams.get("history") === "1";
  try {
    const goals = listProjectGoals(id, { includeHistory: history }).map((g) => ({ ...g, unit: presetFor(g.metric_key)?.unit ?? "none" }));
    const { scope, resolved } = resolveProjectTargets(id);
    const resolvedView = resolved.map((t) => ({
      metric_key: t.row.metric_key,
      label: t.row.label,
      direction: t.row.direction,
      target_value: t.row.target_value,
      unit: presetFor(t.row.metric_key)?.unit ?? "none",
      source: t.source,
      source_name: t.source_name ?? null,
      shadowed: t.shadowed.map((x) => ({ source: x.source, target_value: x.row.target_value })),
    }));
    return ok(
      {
        goals,
        resolved: resolvedView,
        presets: METRIC_PRESETS,
        standards_resolvable: scope != null,
        scope,
        goal_count_by_source: countGoalsBySource(resolved),
      },
      200,
      { count: goals.length },
    );
  } catch (e) {
    const pending = migrationPendingResponse(e);
    if (pending) return pending;
    throw e;
  }
}

function failure(r: Extract<GoalResult<object>, { ok: false }>) {
  if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
  if (r.code === "not_found") return notFound(r.message);
  return fail(409, r.code, r.message);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  // Human-only: only a cookie session (the person in the web app) may write.
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "Only a human can set business goals (boundary #2) — agents may only propose.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "Setting business goals requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;

  if (action === "create") {
    const r = createProjectGoal({
      projectId: id,
      metricKey: body?.metric_key,
      label: body?.label,
      direction: body?.direction,
      targetValue: body?.target_value,
      rationale: body?.rationale,
      sourceNote: body?.source_note,
      actor: ctx.userId,
    });
    return r.ok ? ok({ goal: r.goal }, 201) : failure(r);
  }
  if (action === "supersede") {
    const r = supersedeProjectGoal({
      projectId: id,
      goalId: body?.goal_id,
      direction: body?.direction,
      targetValue: body?.target_value,
      rationale: body?.rationale,
      sourceNote: body?.source_note,
      actor: ctx.userId,
    });
    return r.ok ? ok({ goal: r.goal, superseded_id: r.superseded_id }, 201) : failure(r);
  }
  if (action === "retire") {
    const r = retireProjectGoal({ projectId: id, goalId: body?.goal_id, reason: body?.reason, actor: ctx.userId });
    return r.ok ? ok({ goal_id: r.goal_id, retired_at: r.retired_at }, 200) : failure(r);
  }
  return badRequest("invalid_request", "action must be one of: create | supersede | retire.");
}
