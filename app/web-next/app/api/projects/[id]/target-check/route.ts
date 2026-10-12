// fs-gate evidence read model — the resolved business-target standards for a
// project compared against its adopted business case (ADR-0114). Read-only and
// non-blocking: a miss is decision support for the human fs gate record, never
// an automatic blocker. Visibility is deny-by-default, same as the other
// project routes (FR-SEC-01).
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { listBusinessCases } from "../../../../../lib/business-case.ts";
import {
  countGoalsBySource,
  evaluateTargets,
  resolveProjectTargets,
} from "../../../../../lib/business-targets.ts";
import { migrationPendingResponse, notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();

  try {
    // Project goals (ADR-0159) apply even when the group/affiliate standards
    // scope is unresolved; `resolvable` keeps its meaning (standards scope).
    const { scope, resolved } = resolveProjectTargets(id);
    const { cases, recommendedScenario } = listBusinessCases(id);
    const adoptedCase = cases.find((c) => c.adopted) ?? null;
    const entries = evaluateTargets(resolved, scope, adoptedCase, recommendedScenario);
    const goal_count_by_source = countGoalsBySource(entries);
    if (!scope && entries.length === 0) {
      // No resolvable scope and no project goal: the UI shows an actionable state.
      return ok({ resolvable: false, reason: "scope_unresolved", scope: null, goal_count_by_source, entries }, 200, { count: 0 });
    }
    return ok(
      { resolvable: scope != null, ...(scope ? {} : { reason: "scope_unresolved" }), scope, adopted_case_id: adoptedCase?.id ?? null, goal_count_by_source, entries },
      200,
      { count: entries.length },
    );
  } catch (e) {
    const pending = migrationPendingResponse(e);
    if (pending) return pending;
    throw e;
  }
}
