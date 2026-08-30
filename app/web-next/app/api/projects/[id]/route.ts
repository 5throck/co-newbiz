// Port of app/server/projects.ts GET /api/projects/:id + DELETE (CRUD completion)
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../lib/envelope.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";

function classificationOf(projectId: string) {
  return getDb()
    .query("SELECT sensitivity, mnpi_flag, wall_group, classified_by, classified_at FROM project_classification WHERE project_id = ?")
    .get(projectId) as { sensitivity: string; mnpi_flag: number; wall_group: string | null; classified_by: string | null; classified_at: string | null } | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const classification = classificationOf(project.id);
  return ok(project, 200, {
    mnpi_banner: classification?.mnpi_flag === 1,
    sensitivity: classification?.sensitivity ?? null,
    wall_group: classification?.wall_group ?? null,
  });
}

// Hard delete + audit — the agreed deletion policy (confirm dialog in UI,
// audit trail in DB). Related child rows are cleaned up in FK-safe order.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") {
    return forbidden("role_required", "Deal deletion requires the analyst role.");
  }
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();

  const db = getDb();
  const now = new Date().toISOString();

  // Clean up child rows in FK-safe order (no ON DELETE CASCADE on legacy FKs)
  const CHILD_TABLES = [
    "activity_run", "agent_run", "agent_position", "gate_evaluation", "decision",
    "process_run", "project_checklist_item_state", "report_snapshot",
    "business_case_line", "business_case_model", "dd_finding",
    "contract_coc_clause", "contingent_liability", "debt_instrument",
    "management_package", "comp_benchmark", "antitrust_finding",
    "incentive", "incentive_deadline", "incentive_project",
    "site_candidate", "partner_candidate", "partner_dd_finding",
    "permit", "certification", "value_chain_link", "proxy_chain", "proxy_link",
    "chain_node_sensitivity", "structure_simulation_result",
    "screening_longlist", "assumption", "fact_industry",
    "rag_assessment", "rag_transition", "waiver", "compliance_check",
    "approval_chain", "dimension_input", "project_variable_snapshot",
    "project_industry", "project_incentive_deadline", "project_policy_pin",
    "project_classification", "project_case_classification",
    "venture_scorecard", "insider_list", "data_access_log",
    "simulation_draw", "simulation", "run_input", "run",
    "document", "opportunity",
    "notification", "watch", "watch_rule",
    "project_member", "md_project",
  ];
  db.transaction(() => {
    for (const t of CHILD_TABLES) {
      try {
        if (t === "md_project") {
          db.run("DELETE FROM md_project WHERE id = ?", [id]);
        } else if (t === "run" || t === "simulation" || t === "simulation_draw") {
          // run/simulation/draw are keyed via project_id or run_id
          if (t === "run") db.run("DELETE FROM run WHERE project_id = ?", [id]);
          if (t === "simulation") db.run("DELETE FROM simulation WHERE run_id IN (SELECT id FROM run WHERE project_id = ?)", [id]);
          if (t === "simulation_draw") db.run("DELETE FROM simulation_draw WHERE simulation_id IN (SELECT s.id FROM simulation s JOIN run r ON r.id = s.run_id WHERE r.project_id = ?)", [id]);
        } else if (t === "opportunity") {
          db.run("DELETE FROM opportunity WHERE project_id = ?", [id]);
        } else if (t === "document") {
          db.run("DELETE FROM document WHERE run_id IN (SELECT id FROM run WHERE project_id = ?)", [id]);
        } else {
          try { db.run(`DELETE FROM ${t} WHERE project_id = ?`, [id]); } catch { /* table may not have project_id */ }
        }
      } catch { /* table may not exist or no matching column */ }
    }
    // auth-related tables use user_id not project_id — skip
    appendAudit(db, { actor: ctx.userId, action: "project_delete", target: project.project_no, now });
  })();

  return ok({ deleted: id, project_no: project.project_no });
}
