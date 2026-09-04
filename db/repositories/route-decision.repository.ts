// Route-decision repository — reads for the S4 진출방식 결정 surface.
// Extracted from app/api/opportunities/[id]/route-decision/route.ts so the
// decisions+scores join lives beside the other route-decision SQL (the POST
// validation stays in the route: it is request-shape logic, not data access).
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";

export interface RouteDecisionRead {
  id: string;
  track: string;
  sub_track: string | null;
  rationale: string;
  alternatives_considered: string | null;
  decided_by: string;
  decided_at: string;
  intent: string | null;
  override_flagged: number | null;
  staging_recommended: string | null;
  total_score: number | null;
  scores: Array<{ intent: string | null; criterion: string; score: number; evidence_note: string }>;
}

export function listRouteDecisionsWithScores(opportunityId: string, db: Database = getDb()): RouteDecisionRead[] {
  const decisions = db
    .query(
      `SELECT id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
              intent, override_flagged, staging_recommended, total_score
       FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC`,
    )
    .all(opportunityId) as Array<Record<string, unknown> & { id: string }>;
  const scores = db
    .query(
      `SELECT s.decision_id, s.intent, s.criterion, s.score, s.evidence_note
       FROM route_decision_score s
       JOIN route_decision d ON d.id = s.decision_id
       WHERE d.opportunity_id = ? ORDER BY s.created_at`,
    )
    .all(opportunityId) as Array<Record<string, unknown> & { decision_id: string }>;
  return decisions.map((d) => ({
    ...d,
    scores: scores
      .filter((s) => s.decision_id === d.id)
      .map(({ decision_id: _drop, ...rest }) => rest as RouteDecisionRead["scores"][number]),
  })) as RouteDecisionRead[];
}
