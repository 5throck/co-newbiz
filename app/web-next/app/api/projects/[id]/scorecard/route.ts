// GET /api/projects/[id]/scorecard — the S12 quarterly portfolio-scorecard
// view (ADR-0101 §2). Reads via db/repositories/venture-scorecard
// .repository.ts's getPortfolioRollup DIRECTLY — no logic is extracted or
// duplicated (the `scorecard:rollup` CLI is a print wrapper over the same
// call); this route owns per-caller visibility (the rollup itself is a pure
// query). Optional ?review_cycle=YYYY-Qn pins an explicit cycle; without it
// the repository resolves the project's latest and reports resolved_from so
// the UI never mistakes a resolved-latest read for a pinned one. The response
// also carries the per-cycle trend and the append-only transition-decision
// history (0071). Deny-by-default: getProjectIfVisible via visibleProject —
// non-members get 404 (FR-SEC-01); admins are excluded by role separation.
// GET only — the transition-decision write lives in its own POST route.
import { getDb } from "../../../../../../../db/client.ts";
import { getPortfolioRollup } from "../../../../../../../db/repositories/venture-scorecard.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { isValidReviewCycle } from "../../../../../lib/portfolio.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

interface TransitionDecisionRow {
  id: string;
  review_cycle: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  rationale: string;
  learning_capture: string | null;
  created_at: string;
  recorded_by: string; // the recorder — run.created_by lineage (ADR-0005/0101 §1)
}

function listTransitionDecisions(projectId: string): TransitionDecisionRow[] {
  return getDb()
    .query(
      `SELECT d.id, d.review_cycle, d.decision, d.decided_by, d.decided_at,
              d.rationale, d.learning_capture, d.created_at,
              r.created_by AS recorded_by
       FROM venture_transition_decision d JOIN run r ON r.id = d.run_id
       WHERE d.project_id = ?
       ORDER BY d.decided_at DESC, d.id DESC`,
    )
    .all(projectId) as unknown as TransitionDecisionRow[];
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();

  const explicitCycle = new URL(request.url).searchParams.get("review_cycle");
  if (explicitCycle !== null && !isValidReviewCycle(explicitCycle)) {
    return badRequest("invalid_request", "review_cycle must match YYYY-Q[1-4] (e.g. 2026-Q3).");
  }

  // The shared rollup core, scoped to THIS project. Every pure call — one
  // cycle per invocation; the trend below walks the available cycles.
  const rollup = getPortfolioRollup({ reviewCycle: explicitCycle ?? undefined, projectIds: [id] });
  const trend = rollup.provenance.review_cycles_available.map((cycle) => {
    const r = getPortfolioRollup({ reviewCycle: cycle, projectIds: [id] });
    const measures = r.financial.length + r.strategic.length;
    return {
      review_cycle: cycle,
      measures,
      on_target: [...r.financial, ...r.strategic].filter((x) => x.status === "on_target").length,
      deviation: [...r.financial, ...r.strategic].filter((x) => x.status === "deviation").length,
      insufficient_evidence: r.insufficient_evidence.length,
    };
  });

  const decisions = listTransitionDecisions(id);

  return ok(
    {
      project: { id: project.id, project_no: project.project_no },
      rollup: {
        review_cycle: rollup.review_cycle,
        resolved_from: rollup.resolved_from,
        financial: rollup.financial,
        strategic: rollup.strategic,
        class_rollup: rollup.class_rollup,
        insufficient_evidence: rollup.insufficient_evidence,
        provenance: rollup.provenance,
      },
      trend,
      decisions: {
        latest: decisions[0] ?? null,
        history: decisions,
      },
    },
    200,
    { decision_count: decisions.length, cycle_count: trend.length },
  );
}
