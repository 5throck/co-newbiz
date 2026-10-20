// @version 1.0.0
/**
 * learnings — the kill-with-learning corpus (ADR-0150 criterion 6: "A kill
 * decision records the captured learning and feeds it back to S1/S2 base
 * rates"; data owners group-review-agent records, risk-officer feeds back).
 * Until 2026-10-21 learning_capture was written and shown in S12 only; no
 * S1/S2 surface read it. This module reads the venture_transition_decision
 * ledger (0071) for kill_with_learning_captured rows and returns them as a
 * display-only corpus — the base-rate adjustment stays a human/agent act.
 * Project identity is withheld for non-members (the backtest's rule); the
 * learning text itself is the org-level lesson and is returned to every
 * authenticated reader.
 */
import type { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;

export interface LearningRow {
  project_id: string | null;
  project_no: string | null;
  name: string | null;
  track: string | null;
  industry_id: string | null;
  review_cycle: string;
  decided_at: string;
  rationale: string;
  learning_capture: string;
}

export interface LearningCorpus {
  rows: LearningRow[];
  by_track: Array<{ track: string | null; kills: number }>;
  total: number;
}

export function killLearnings(
  db: Db,
  opts: { track?: string | null; industryId?: string | null; limit?: number; visible: (projectId: string) => boolean },
): LearningCorpus {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where: string[] = ["v.decision = 'kill_with_learning_captured'", "v.learning_capture IS NOT NULL", "v.learning_capture <> ''"];
  const params: Array<string | number> = [];
  if (opts.track) { where.push("p.track = ?"); params.push(opts.track); }
  if (opts.industryId) { where.push("o.industry_id = ?"); params.push(opts.industryId); }
  const raw = db
    .query(
      `SELECT v.project_id, p.project_no, p.project_name, p.track, o.industry_id, v.review_cycle, v.decided_at, v.rationale, v.learning_capture
       FROM venture_transition_decision v
       JOIN md_project p ON p.id = v.project_id
       LEFT JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE ${where.join(" AND ")}
       ORDER BY v.decided_at DESC, v.id DESC LIMIT ?`,
    )
    .all(...params, limit) as Array<{ project_id: string; project_no: string; project_name: string | null; track: string | null; industry_id: string | null; review_cycle: string; decided_at: string; rationale: string; learning_capture: string }>;
  const rows: LearningRow[] = raw.map((r) => {
    const visible = opts.visible(r.project_id);
    return {
      project_id: visible ? r.project_id : null,
      project_no: visible ? r.project_no : null,
      name: visible ? (r.project_name ?? r.project_no) : null,
      track: r.track,
      industry_id: r.industry_id,
      review_cycle: r.review_cycle,
      decided_at: r.decided_at,
      rationale: r.rationale,
      learning_capture: r.learning_capture,
    };
  });
  const byTrack = db
    .query(
      `SELECT p.track, COUNT(DISTINCT p.id) AS kills FROM md_project p
       WHERE EXISTS (SELECT 1 FROM venture_transition_decision v WHERE v.project_id = p.id AND v.decision = 'kill_with_learning_captured')
       GROUP BY p.track ORDER BY p.track`,
    )
    .all() as Array<{ track: string | null; kills: number }>;
  return { rows, by_track: byTrack, total: byTrack.reduce((a, b) => a + b.kills, 0) };
}
