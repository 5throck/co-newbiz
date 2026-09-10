// fs-gate evidence read model — the resolved business-target standards for a
// project compared against its adopted business case (ADR-0114). Read-only and
// non-blocking: a miss is decision support for the human fs gate record, never
// an automatic blocker. Visibility is deny-by-default, same as the other
// project routes (FR-SEC-01).
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { listBusinessCases } from "../../../../../lib/business-case.ts";
import {
  evaluateTargets,
  projectTargetScope,
  resolveBusinessTargets,
  type TargetCheckEntry,
} from "../../../../../lib/business-targets.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();

  const scope = projectTargetScope(id);
  if (!scope) {
    // No resolvable scope: the project's company matches no registry member and
    // the deployment has more than one group. The UI shows an actionable state.
    return ok({ resolvable: false, reason: "scope_unresolved", entries: [] satisfies TargetCheckEntry[] }, 200, { count: 0 });
  }
  const resolved = resolveBusinessTargets(scope.groupId, scope.memberId);
  const { cases, recommendedScenario } = listBusinessCases(id);
  const adoptedCase = cases.find((c) => c.adopted) ?? null;
  const entries = evaluateTargets(resolved, scope, adoptedCase, recommendedScenario);
  return ok({ resolvable: true, scope, adopted_case_id: adoptedCase?.id ?? null, entries }, 200, { count: entries.length });
}
