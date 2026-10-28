// fs-gate evidence read model — the resolved business-target standards for a
// project compared against its adopted business case (ADR-0114). Read-only and
// non-blocking: a miss is decision support for the human fs gate record, never
// an automatic blocker. Visibility is deny-by-default, same as the other
// project routes (FR-SEC-01).
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { goalJudgedCase, listBusinessCases } from "../../../../../lib/business-case.ts";
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
    // D4 (2026-10-28): judge on the ADOPTED case's own scenario (base before adoption),
    // not the engine-recommended scenario - same basis as /s8-lens-summary.
    const list = listBusinessCases(id);
    const adoptedCase = list.cases.find((c) => c.adopted) ?? null;
    const judged = goalJudgedCase(list);
    const entries = evaluateTargets(resolved, scope, judged.caseView, judged.basis);
    const goal_count_by_source = countGoalsBySource(entries);
    if (!scope && entries.length === 0) {
      // No resolvable scope and no project goal: the UI shows an actionable state.
      return ok({ resolvable: false, reason: "scope_unresolved", scope: null, goal_count_by_source, entries }, 200, { count: 0 });
    }
    return ok(
      { resolvable: scope != null, ...(scope ? {} : { reason: "scope_unresolved" }), scope, adopted_case_id: adoptedCase?.id ?? null, judged_case_id: judged.caseView?.id ?? null, judged_basis: judged.caseView ? judged.basis : null, goal_count_by_source, entries },
      200,
      { count: entries.length },
    );
  } catch (e) {
    const pending = migrationPendingResponse(e);
    if (pending) return pending;
    throw e;
  }
}
