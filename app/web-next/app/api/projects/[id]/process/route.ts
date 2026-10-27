// Project-side process evaluation (S8–S12) — mirrors /api/opportunities/[id]
// /process. The opportunity branch is evaluated by the same engine through
// the source_opportunity_id backlink (S1–S7), so one response carries the
// full S1–S12 chain. Deny-by-default: visibleProject (members only; admins
// blocked per ADR-0091 role separation).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { isLead, visibleProject } from "../../../../../lib/project-visibility.ts";
import { evaluateProcess } from "../../../../../lib/process-flow.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  // 아카이브(보관/삭제 표시) 프로젝트도 원본 열람이 가능해야 한다.
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
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
      project: { id, project_no: project.project_no ?? null, project_name: project.project_name ?? null },
      stages: evaluation.stages,
      currentStage: evaluation.currentStage,
      completedStages: evaluation.completedStages,
      nextStage: evaluation.nextStage,
      blockers: evaluation.blockers,
      requiredArtifacts: evaluation.requiredArtifacts,
      gateStatus: evaluation.gateStatus,
      // ADR-0186 D6: IC GOs recorded but still awaiting their second-reviewer countersign (gateStatus reads them as pending under maker_checker = enforce).
      awaitingCountersign: evaluation.awaitingCountersign ?? [],
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
    // is_lead: 삭제/마감·보관 액션 노출 판단. project_status/deleted: 보관·삭제
    // 검토/안건에서 UI가 저장/수정 액션을 숨기도록 판단하는 근거(쓰기는 서버에서 차단).
    { is_lead: isLead(auth.auth, id), project_status: project.status ?? null, deleted: project.deleted_at != null },
  );
}
