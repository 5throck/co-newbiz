// GET /api/projects/[id]/business-case/generate/[runId] — generation run
// status (ADR-0098 §3): per-activity status (waiting / running / done / failed / skipped, with
// started/finished timestamps and the failing activity's error) + artifacts assembled from
// activity_run/agent_run (ADR-0096) plus the resulting case summary
// (business_case_model + valuation_simulation). Polled while a run is in progress (202 start). Deny-by-default: the run
// must belong to a project the caller can see, and run/project mismatch is a
// 404 indistinguishable from absence.
import { waccStatusView } from "../../../../../../../lib/wacc-status.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { listBusinessCases } from "../../../../../../../lib/business-case.ts";
import {
  type GenerationRunRow,
  generationRunView,
  sweepStaleGenerationRuns,
} from "../../../../../../../lib/business-case-run.ts";
import { notFound, ok } from "../../../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, runId } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  sweepStaleGenerationRuns();
  const run = db
    .query(
      "SELECT id, status, stage, started_at, finished_at, meta_json FROM process_run WHERE id = ? AND entity_type = 'project' AND entity_id = ? AND stage <> 's11_execution_baseline'",
    )
    .get(runId, id) as GenerationRunRow | undefined;
  if (!run) return notFound();

  const view = generationRunView(run);
  const { cases, recommendedScenario: latestRecommended, adoption, staleness } = listBusinessCases(id);
  return ok(
    {
      ...view,
      recommended_scenario: view.recommended_scenario ?? latestRecommended,
      cases,
      adoption,
      staleness,
      wacc_status: waccStatusView(id, db),
    },
    200,
    { activity_count: view.activities.length },
  );
}
