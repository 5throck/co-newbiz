// GET /api/projects/[id]/timeline — stage timeline + SLA (ADR-0122 #1).
// Milestone dates are derived from each stage's first-class artifact
// timestamps (computed, never stored); SLA targets come from the stage_sla
// policy table (admin-managed; unset = "정책 미설정" — honest, not invented).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { evaluateProcess } from "../../../../../lib/process-flow.ts";

function day(a: string, b: string): number | null {
  const d = (new Date(a).getTime() - new Date(b).getTime()) / (24 * 3600 * 1000);
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();

  const project = db.query(
    "SELECT source_opportunity_id, created_at FROM md_project WHERE id = ?",
  ).get(id) as { source_opportunity_id: string | null; created_at: string } | undefined;
  if (!project) return notFound();
  const opp = project.source_opportunity_id;

  // One milestone date per stage — the earliest artifact timestamp of the
  // stage's primary table (S12 uses the latest scorecard observation).
  const milestone = (sql: string, ...p: unknown[]): string | null => {
    const r = db.query(sql).get(...p) as { d: string | null } | undefined;
    return r?.d ?? null;
  };
  const m: Record<string, string | null> = {
    S1: opp ? milestone(
      `SELECT MAX(a.completed_at) AS d FROM market_sizing_analysis a
         JOIN opportunity o ON o.industry_id = a.industry_id
        WHERE o.id = ? AND a.status = 'completed'`, opp) : null,
    S2: opp ? milestone("SELECT MIN(created_at) AS d FROM opportunity WHERE id = ?", opp) : null,
    S3: opp ? milestone("SELECT MAX(completed_at) AS d FROM synergy_analysis WHERE opportunity_id = ? AND status = 'completed'", opp) : null,
    S4: opp ? milestone("SELECT MIN(decided_at) AS d FROM route_decision WHERE opportunity_id = ?", opp) : null,
    S5: opp ? milestone("SELECT MIN(created_at) AS d FROM greenfield_assessment WHERE opportunity_id = ?", opp) : null,
    S6: opp ? milestone("SELECT MIN(created_at) AS d FROM brownfield_target WHERE opportunity_id = ?", opp) : null,
    S7: opp ? milestone("SELECT MIN(updated_at) AS d FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'", opp) : null,
    S8: milestone("SELECT MIN(created_at) AS d FROM business_case_model WHERE project_id = ?", id),
    S9: milestone("SELECT MIN(assessed_at) AS d FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL AND status != 'pending'", id),
    S10: milestone("SELECT MIN(hypothesized_at) AS d FROM deal_structure_hypothesis WHERE project_id = ?", id),
    S11: milestone("SELECT MIN(decided_at) AS d FROM gate_decision WHERE entity_type = 'project' AND entity_id = ?", id),
    S12: milestone("SELECT MAX(observed_at) AS d FROM venture_scorecard WHERE project_id = ?", id),
  };

  const sla = db.query("SELECT stage_id, target_days FROM stage_sla").all() as Array<{ stage_id: string; target_days: number }>;
  const slaMap = new Map(sla.map((r) => [r.stage_id, r.target_days]));

  // Stage status comes from the SAME engine as the stage rail (/process):
  // S1-S7 from the source opportunity, S8-S12 from the project. Never derived
  // from milestone presence (a missing timestamp is not "in progress").
  const stageStatus = new Map<string, string>();
  const projEval = evaluateProcess({ type: "project", id });
  for (const st of projEval.stages) stageStatus.set(st.id, st.status);
  if (opp) {
    for (const st of evaluateProcess({ type: "opportunity", id: opp }).stages) {
      if (st.sequence <= 7) stageStatus.set(st.id, st.status);
    }
  }

  const order = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"];
  const stages: Array<Record<string, unknown>> = [];
  let last: string | null = project.created_at;
  for (const sid of order) {
    const done = m[sid] ?? null;
    const target = slaMap.get(sid) ?? null;
    let elapsed: number | null = null;
    if (done && last) elapsed = day(done, last);
    let breach: boolean | null = null;
    if (elapsed !== null && target !== null) breach = elapsed > target;
    stages.push({
      stage_id: sid, milestone_at: done, elapsed_days: elapsed,
      sla_target_days: target, sla_breach: breach,
      sla_set: slaMap.has(sid),
      status: stageStatus.get(sid) ?? null,
      not_applicable: stageStatus.get(sid) === "skipped",
      in_progress: stageStatus.get(sid) === "current",
    });
    if (done) last = done;
  }
  return ok({ stages, project_created_at: project.created_at }, 200, { stages: stages.length });
}
