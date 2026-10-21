// @version 2.0.0
/**
 * risk-assessment — S9 리스크 히트맵의 사람 판정 (2026-10-19 decider question:
 * likelihood가 전부 하드코딩 2라 실제 평가 도구가 아니었다). 항목 소스 키
 * (dd:<finding_id> / coc:<contract_id> / inc:<incentive_id> / cov:<covenant_key>)
 * 별로 사람의 가능성·영향(1~3)과 완화조치를 기록한다. 자동 산정값은 기록이 없을
 * 때의 기본값이며, 기록은 analyst+ 사람 전용 (경계 #2), 감사가 남는다.
 *
 * v2.0.0 (2026-10-21, migration 0164): risk_assessment_ledger (0160, append-only)
 * is the ONLY store — the 0156 sidecar column was migrated into the ledger and
 * dropped. Latest-per-key is a read over the ledger, never a second copy.
 */
import { appendAudit } from "../../../db/lib/access-control.ts";
import type { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";

type Db = ReturnType<typeof getDb>;

export const RISK_ASSESSMENT_LEVELS = [1, 2, 3] as const;
export const RISK_ITEM_KEY_PATTERN = /^(dd|coc|inc|cov):/;
export const MITIGATION_MAX_LENGTH = 1000;

export interface RiskAssessmentRecord {
  likelihood: 1 | 2 | 3;
  impact: 1 | 2 | 3;
  mitigation: string | null;
  by: string;
  at: string;
}

export class RiskAssessmentValidationError extends Error {}

/** Validate one person assessment: source key + likelihood/impact in 1..3 (+ optional mitigation). */
export function validateRiskAssessmentInput(input: {
  key?: unknown; likelihood?: unknown; impact?: unknown; mitigation?: unknown;
}): { key: string; likelihood: 1 | 2 | 3; impact: 1 | 2 | 3; mitigation: string | null } {
  const bad = (m: string) => new RiskAssessmentValidationError(m);
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!key || !RISK_ITEM_KEY_PATTERN.test(key)) throw bad("key는 dd:|coc:|inc:|cov: 접두어를 가져야 합니다.");
  if (input.likelihood !== 1 && input.likelihood !== 2 && input.likelihood !== 3) throw bad("likelihood는 1~3이어야 합니다.");
  if (input.impact !== 1 && input.impact !== 2 && input.impact !== 3) throw bad("impact는 1~3이어야 합니다.");
  let mitigation: string | null = null;
  if (input.mitigation !== undefined && input.mitigation !== null) {
    if (typeof input.mitigation !== "string") throw bad("mitigation은 문자열이어야 합니다.");
    mitigation = input.mitigation.trim() || null;
    if (mitigation && mitigation.length > MITIGATION_MAX_LENGTH) throw bad(`mitigation은 ${MITIGATION_MAX_LENGTH}자 이내여야 합니다.`);
  }
  return { key, likelihood: input.likelihood, impact: input.impact, mitigation };
}

export interface RecordRiskAssessmentInput {
  projectId: string;
  key: string;
  likelihood: 1 | 2 | 3;
  impact: 1 | 2 | 3;
  mitigation: string | null;
  by: string;
  at?: string;
}

/** Append one assessment to the ledger — one row, one audit entry; the ledger is the history. */
export function recordRiskAssessment(db: Db, input: RecordRiskAssessmentInput): RiskAssessmentRecord & { id: string } {
  const at = input.at ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO risk_assessment_ledger (id, project_id, item_key, likelihood, impact, mitigation, recorded_by, recorded_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, input.projectId, input.key, input.likelihood, input.impact, input.mitigation, input.by, at],
    );
    appendAudit(db, {
      actor: input.by,
      action: "risk_assessment.recorded",
      target: `${input.projectId}:${input.key}:${input.likelihood}-${input.impact}${input.mitigation ? ":mitigation" : ""}`,
      now: at,
    });
  })();
  return { id, likelihood: input.likelihood, impact: input.impact, mitigation: input.mitigation, by: input.by, at };
}

/** Latest assessment per item key, read from the ledger. */
export function latestRiskAssessments(db: Db, projectId: string): Record<string, RiskAssessmentRecord> {
  const out: Record<string, RiskAssessmentRecord> = {};
  const ledger = db
    .query(
      `SELECT item_key, likelihood, impact, mitigation, recorded_by, recorded_at
       FROM risk_assessment_ledger WHERE project_id = ? ORDER BY recorded_at ASC, id ASC`,
    )
    .all(projectId) as Array<{ item_key: string; likelihood: 1 | 2 | 3; impact: 1 | 2 | 3; mitigation: string | null; recorded_by: string; recorded_at: string }>;
  for (const r of ledger) {
    out[r.item_key] = { likelihood: r.likelihood, impact: r.impact, mitigation: r.mitigation, by: r.recorded_by, at: r.recorded_at };
  }
  return out;
}

export interface RiskAssessmentHistoryRow {
  id: string;
  item_key: string;
  likelihood: 1 | 2 | 3;
  impact: 1 | 2 | 3;
  mitigation: string | null;
  recorded_by: string;
  recorded_at: string;
}

export function riskAssessmentHistory(db: Db, projectId: string, itemKey?: string): RiskAssessmentHistoryRow[] {
  const sql = `SELECT id, item_key, likelihood, impact, mitigation, recorded_by, recorded_at
     FROM risk_assessment_ledger WHERE project_id = ?${itemKey ? " AND item_key = ?" : ""}
     ORDER BY recorded_at DESC, id DESC`;
  return (itemKey ? db.query(sql).all(projectId, itemKey) : db.query(sql).all(projectId)) as RiskAssessmentHistoryRow[];
}
