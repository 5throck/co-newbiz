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
  rationale: string | null;
  alternatives_considered: string | null;
  decided_by: string;
  decided_at: string;
  intent: string | null;
  override_flagged: number | null;
  staging_recommended: string | null;
  total_score: number | null;
  status: "draft" | "final";
  updated_at: string | null;
  scores: Array<{ intent: string | null; criterion: string; score: number; evidence_note: string }>;
}

function attachScores(decisions: Array<Record<string, unknown> & { id: string }>, opportunityId: string, db: Database): RouteDecisionRead[] {
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

// ADR-0124: 결정 이력(결정 이력 탭)은 status='final'만 보여준다 — 초안이
// 마치 기록된 결정처럼 보이면 안 된다.
export function listRouteDecisionsWithScores(opportunityId: string, db: Database = getDb()): RouteDecisionRead[] {
  const decisions = db
    .query(
      `SELECT id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
              intent, override_flagged, staging_recommended, total_score, status, updated_at
       FROM route_decision WHERE opportunity_id = ? AND status = 'final' ORDER BY decided_at DESC`,
    )
    .all(opportunityId) as Array<Record<string, unknown> & { id: string }>;
  return attachScores(decisions, opportunityId, db);
}

// ADR-0124: 기회당 열린 초안은 최대 1건(부분 유니크 인덱스로 강제) — 있으면
// 그 초안과 채점을 함께 돌려준다.
export function getDraftRouteDecision(opportunityId: string, db: Database = getDb()): RouteDecisionRead | null {
  const row = db
    .query(
      `SELECT id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
              intent, override_flagged, staging_recommended, total_score, status, updated_at
       FROM route_decision WHERE opportunity_id = ? AND status = 'draft'`,
    )
    .get(opportunityId) as (Record<string, unknown> & { id: string }) | null;
  if (!row) return null;
  return attachScores([row], opportunityId, db)[0];
}
