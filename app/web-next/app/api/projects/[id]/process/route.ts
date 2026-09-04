// Project-side process evaluation (S8–S11) — mirrors /api/opportunities/[id]
// /process. The opportunity branch is evaluated by the same engine through
// the source_opportunity_id backlink (S1–S7), so one response carries the
// full S1–S11 chain. Deny-by-default: visibleProject (members only; admins
// blocked per ADR-0091 role separation).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { evaluateProcess } from "../../../../../lib/process-flow.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const sourceOpportunityId = (getDb()
    .query("SELECT source_opportunity_id FROM md_project WHERE id = ?")
    .get(id) as { source_opportunity_id: string | null })?.source_opportunity_id ?? null;
  const evaluation = evaluateProcess({ type: "project", id });
  const opportunityEvaluation = sourceOpportunityId
    ? evaluateProcess({ type: "opportunity", id: sourceOpportunityId })
    : null;
  return ok(
    {
      project: { id, project_no: project.project_no ?? null },
      stages: evaluation.stages,
      currentStage: evaluation.currentStage,
      completedStages: evaluation.completedStages,
      nextStage: evaluation.nextStage,
      blockers: evaluation.blockers,
      requiredArtifacts: evaluation.requiredArtifacts,
      gateStatus: evaluation.gateStatus,
      terminated: evaluation.terminated,
      track: evaluation.track,
      subTrack: evaluation.subTrack,
      opportunity: opportunityEvaluation
        ? {
            id: sourceOpportunityId,
            stages: opportunityEvaluation.stages,
            currentStage: opportunityEvaluation.currentStage,
            blockers: opportunityEvaluation.blockers,
            gateStatus: opportunityEvaluation.gateStatus,
          }
        : null,
    },
    200,
  );
}
