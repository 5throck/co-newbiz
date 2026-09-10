// GET /api/projects/[id]/business-case/generate/[runId] — generation run
// status (ADR-0098 §3): per-activity status + artifacts assembled from
// activity_run/agent_run (ADR-0096) plus the resulting case summary
// (business_case_model + valuation_simulation). Deny-by-default: the run
// must belong to a project the caller can see, and run/project mismatch is a
// 404 indistinguishable from absence.
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { listBusinessCases } from "../../../../../../../lib/business-case.ts";
import { notFound, ok } from "../../../../../../../lib/envelope.ts";

interface RunRow {
  id: string;
  status: string;
  stage: string;
  started_at: string;
  finished_at: string | null;
  meta_json: string | null;
}
interface ActivityRow {
  activity_id: string;
  status: string;
  output_md: string | null;
  agent_key: string;
  started_at: string;
  finished_at: string | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, runId } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const run = db
    .query("SELECT id, status, stage, started_at, finished_at, meta_json FROM process_run WHERE id = ? AND entity_type = 'project' AND entity_id = ?")
    .get(runId, id) as RunRow | undefined;
  if (!run) return notFound();

  const activities = db
    .query(
      `SELECT a.activity_id, a.status, a.output_md, r.agent_key, a.started_at, a.finished_at
       FROM activity_run a JOIN agent_run r ON r.process_run_id = a.process_run_id AND r.activity_id = a.activity_id
       WHERE a.process_run_id = ? ORDER BY a.started_at, a.id`,
    )
    .all(runId) as unknown as ActivityRow[];

  let recommendedScenario: string | null = null;
  if (run.meta_json) {
    try {
      recommendedScenario = (JSON.parse(run.meta_json) as { recommended_scenario?: string }).recommended_scenario ?? null;
    } catch {
      // unparseable meta — treat as no recommendation recorded
    }
  }
  const { cases, recommendedScenario: latestRecommended, adoption } = listBusinessCases(id);
  return ok(
    {
      runId: run.id,
      status: run.status,
      stage: run.stage,
      started_at: run.started_at,
      finished_at: run.finished_at,
      recommended_scenario: recommendedScenario ?? latestRecommended,
      activities: activities.map((a) => ({
        activityId: a.activity_id,
        agentKey: a.agent_key,
        status: a.status,
        started_at: a.started_at,
        finished_at: a.finished_at,
        outputMd: a.output_md,
      })),
      cases,
      adoption,
    },
    200,
    { activity_count: activities.length },
  );
}
