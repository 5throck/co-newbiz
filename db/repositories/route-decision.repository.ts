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
  // ADR-0135: 권위 행 표시. is_current=1은 기회당 최대 1건(부분 유니크 인덱스).
  is_current: number;
  superseded_by: string | null;
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

const DECISION_COLUMNS =
  `id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
   intent, override_flagged, staging_recommended, total_score, status, updated_at,
   is_current, superseded_by`;

// ADR-0124: 결정 이력(결정 이력 탭)은 status='final'만 보여준다 — 초안이
// 마치 기록된 결정처럼 보이면 안 된다.
// ADR-0135: 이력은 대체된 결정까지 전부 보여주되(supersede는 삭제가 아니다),
// 권위 행이 어느 것인지는 타임스탬프로 재유도하지 않고 is_current로 읽는다 —
// 현재 결정이 항상 첫 행이다.
export function listRouteDecisionsWithScores(opportunityId: string, db: Database = getDb()): RouteDecisionRead[] {
  const decisions = db
    .query(
      `SELECT ${DECISION_COLUMNS}
       FROM route_decision WHERE opportunity_id = ? AND status = 'final'
       ORDER BY is_current DESC, decided_at DESC, id DESC`,
    )
    .all(opportunityId) as Array<Record<string, unknown> & { id: string }>;
  return attachScores(decisions, opportunityId, db);
}

// ADR-0135: 게이트/스테이지 로직이 읽어야 하는 "지금 유효한 진출방식 결정".
// 기회당 is_current=1은 부분 유니크 인덱스로 최대 1건이 보장된다 — 호출부가
// `ORDER BY decided_at DESC LIMIT 1` 관행을 되풀이할 필요가 없다.
export function getCurrentRouteDecision(opportunityId: string, db: Database = getDb()): RouteDecisionRead | null {
  const row = db
    .query(`SELECT ${DECISION_COLUMNS} FROM route_decision WHERE opportunity_id = ? AND is_current = 1`)
    .get(opportunityId) as (Record<string, unknown> & { id: string }) | null;
  if (!row) return null;
  return attachScores([row], opportunityId, db)[0];
}

// ADR-0135: 새 결정을 확정할 때 이전 권위 행을 대체 처리한다 — 삭제가 아니라
// is_current=0 + superseded_by 기록(이력 보존). 반드시 새 결정 행이 이미
// 존재하는 상태에서, 같은 트랜잭션/쓰기 경로 안에서 호출해야 한다(self-FK).
// 순서도 중요하다: 이전 행을 먼저 내려야 부분 유니크 인덱스가 충돌하지 않는다.
export function finalizeRouteDecisionCurrency(
  opportunityId: string,
  newDecisionId: string,
  db: Database = getDb(),
): void {
  db.run(
    `UPDATE route_decision SET is_current = 0, superseded_by = ?
     WHERE opportunity_id = ? AND is_current = 1 AND id <> ?`,
    [newDecisionId, opportunityId, newDecisionId],
  );
  db.run(
    "UPDATE route_decision SET is_current = 1, superseded_by = NULL WHERE id = ?",
    [newDecisionId],
  );
}

// ADR-0124: 기회당 열린 초안은 최대 1건(부분 유니크 인덱스로 강제) — 있으면
// 그 초안과 채점을 함께 돌려준다.
export function getDraftRouteDecision(opportunityId: string, db: Database = getDb()): RouteDecisionRead | null {
  const row = db
    .query(
      `SELECT ${DECISION_COLUMNS} FROM route_decision WHERE opportunity_id = ? AND status = 'draft'`,
    )
    .get(opportunityId) as (Record<string, unknown> & { id: string }) | null;
  if (!row) return null;
  return attachScores([row], opportunityId, db)[0];
}
