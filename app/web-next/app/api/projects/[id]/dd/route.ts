// GET /api/projects/[id]/dd — the S9 aggregate read surface (ADR-0099 §3):
// the three standard DD checklists with live project_checklist_item_state
// judgments, the custom (tailored) items with full provenance, the dd_finding
// list, and the mechanical S9 completion summary. Visibility is
// deny-by-default: getProjectIfVisible via visibleProject — non-members get
// 404 (existence itself is protected, FR-SEC-01); admins are excluded by
// role separation. Read-only — writes go through the tailor/review/state
// routes. ADR-0157: ?target_id= selects an opened comparison target (409 when
// DD was never opened there); the payload also carries targets[] summaries.
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { listDdWorkspace } from "../../../../../lib/dd-checklist-tailor.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { scopeOrResponse } from "../../../../../lib/dd-target-http.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { summarizeTriangulation, type InterviewSourceRow } from "../../../../../lib/interview-triangulation.ts";
import { buildRiskHeatmap } from "../../../../../lib/risk-heatmap.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  // ADR-0157: optional ?target_id= — omitted = the selected/legacy scope the gate judges.
  const scope = scopeOrResponse(id, new URL(request.url).searchParams.get("target_id"));
  if ("response" in scope) return scope.response;
  const workspace = listDdWorkspace(id, { targetId: scope.targetId, viewerId: auth.auth.userId });
  // 2026-10-21 decider: the workspace surfaces its diligence tools (customer CoC,
  // compensation, interviews, heatmap) with record counts — the section cards read this.
  let tool_counts: Record<string, unknown> | null = null;
  if (!scope.targetId) {
    const db = getDb();
    const coc = db.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN concentration_pct >= 30 OR est_exit_loss IS NOT NULL THEN 1 ELSE 0 END), 0) AS plotted
       FROM contract_coc WHERE project_id = ?`,
    ).get(id) as { total: number; plotted: number };
    const compensation = db.query(
      `SELECT (SELECT COUNT(*) FROM management_package WHERE project_id = ?) AS packages,
              (SELECT COUNT(*) FROM comp_benchmark WHERE project_id = ?) AS parity_rows`,
    ).get(id, id) as { packages: number; parity_rows: number };
    const interviews = db.query(
      "SELECT claim, interviewee, evidence_ref FROM dd_interview WHERE project_id = ?",
    ).all(id) as InterviewSourceRow[];
    const tri = summarizeTriangulation(interviews);
    const heat = buildRiskHeatmap(db, id);
    tool_counts = {
      contracts: { total: coc.total, plotted: coc.plotted },
      compensation: compensation,
      interviews: { total: interviews.length, triangulated_claims: tri.triangulated_count, pending_claims: tri.pending_count },
      heatmap: { total: heat.items.length, high: heat.counts.high },
    };
  }
  return ok({ ...workspace, tool_counts }, 200, { domain_count: workspace.domains.length });
}
