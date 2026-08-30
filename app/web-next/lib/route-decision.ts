// Route decision — shared server logic for both API paths
// (POST /api/opportunities/:id/route-decision and POST /api/projects/:id/route-decision,
// per process-flow.md S4). Recording a decision also writes the three-axis
// classification (project_case_classification) so downstream validators and
// views pick up the chosen track through the existing mechanism.
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";

export interface RouteDecisionInput {
  opportunityId: string;
  projectId: string | null;
  track: "greenfield" | "brownfield";
  subTrack?: "existing_business_rbd" | "intra_venture" | null;
  rationale: string;
  alternativesConsidered?: string | null;
  decisionFactors?: Record<string, unknown> | null;
  actor: string;
}

export interface RouteDecisionRow {
  id: string;
  opportunity_id: string;
  project_id: string | null;
  track: string;
  sub_track: string | null;
  rationale: string;
  alternatives_considered: string | null;
  decision_factors_json: string | null;
  decided_by: string;
  decided_at: string;
}

export function listRouteDecisions(filter: { opportunityId?: string; projectId?: string }): RouteDecisionRow[] {
  const db = getDb();
  if (filter.opportunityId) {
    return db
      .query("SELECT * FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC")
      .all(filter.opportunityId) as RouteDecisionRow[];
  }
  if (filter.projectId) {
    return db
      .query("SELECT * FROM route_decision WHERE project_id = ? ORDER BY decided_at DESC")
      .all(filter.projectId) as RouteDecisionRow[];
  }
  return [];
}

export function recordRouteDecision(input: RouteDecisionInput): RouteDecisionRow {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const write = db.transaction(() => {
    db.run(
      `INSERT INTO route_decision (id, opportunity_id, project_id, track, sub_track,
                                   rationale, alternatives_considered, decision_factors_json,
                                   decided_by, decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, input.opportunityId, input.projectId, input.track, input.subTrack ?? null,
        input.rationale, input.alternativesConsidered ?? null,
        input.decisionFactors ? JSON.stringify(input.decisionFactors) : null,
        input.actor, now],
    );
    // Mirror the route onto the three-axis classification when a project
    // exists (greenfield=own build → origin internal; brownfield=M&A →
    // external counterparty; R&BD sub-track → technology_track rbd).
    if (input.projectId) {
      const prev = db
        .query(
          "SELECT id FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL ORDER BY classified_at DESC LIMIT 1",
        )
        .get(input.projectId) as { id: string } | undefined;
      if (prev) {
        db.run("UPDATE project_case_classification SET superseded_by = ? WHERE id = ?", [id, prev.id]);
      }
      db.run(
        `INSERT INTO project_case_classification
           (id, project_id, case_type, origin, technology_track, classified_by, approver_role,
            approved_by, approved_at, classified_at, rationale)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, input.projectId, input.track, input.track === "brownfield" ? "external" : "internal",
          input.subTrack === "existing_business_rbd" ? "rbd" : "none",
          input.actor, "route_decision", input.actor, now, now, input.rationale],
      );
    }
    appendAudit(db, {
      actor: input.actor,
      action: "route_decision",
      target: `${input.opportunityId}:${input.track}${input.subTrack ? "/" + input.subTrack : ""}`,
      now,
    });
  });
  write();
  return {
    id,
    opportunity_id: input.opportunityId,
    project_id: input.projectId,
    track: input.track,
    sub_track: input.subTrack ?? null,
    rationale: input.rationale,
    alternatives_considered: input.alternativesConsidered ?? null,
    decision_factors_json: input.decisionFactors ? JSON.stringify(input.decisionFactors) : null,
    decided_by: input.actor,
    decided_at: now,
  };
}
