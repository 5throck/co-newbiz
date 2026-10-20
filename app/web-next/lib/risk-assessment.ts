// @version 1.1.0
/**
 * risk-assessment — S9 리스크 히트맵의 사람 판정 (2026-10-19 decider question:
 * likelihood가 전부 하드코딩 2라 실제 평가 도구가 아니었다). 항목 소스 키
 * (dd:<finding_id> / coc:<contract_id> / inc:<incentive_id> / cov:<covenant_key>)
 * 별로 사람의 가능성·영향(1~3)을 기록한다. 자동 산정값은 오버라이드가 없을 때의
 * 기본값이며, 기록은 analyst+ 사람 전용 (경계 #2), 감사가 남는다.
 *
 * v1.1.0 (2026-10-21, ADR-0122 #2 "risk ledger"): every assessment is appended
 * to risk_assessment_ledger (migration 0160) with the optional mitigation the
 * 2026-10-19 design deferred; the 0156 sidecar
 * (md_project.risk_heatmap_assessment_json) is kept as the latest-per-key
 * projection so earlier readers keep working.
 */
import { appendAudit } from "../../../db/lib/access-control.ts";
import type { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";

type Db = ReturnType<typeof getDb>;

export const RISK_ASSESSMENT_LEVELS = [1, 2, 3] as const;
export const RISK_ITEM_KEY_PATTERN = /^(dd|coc|inc|cov):/;
export const MITIGATION_MAX_LENGTH = 1000;

export interface RiskAssessmentOverride {
  likelihood: 1 | 2 | 3;
  impact: 1 | 2 | 3;
  by: string;
  at: string;
}

export interface RiskAssessmentRecord extends RiskAssessmentOverride {
  mitigation: string | null;
}

export type RiskAssessmentMap = Record<string, RiskAssessmentOverride>;

export function parseRiskAssessment(raw: string | null | undefined): RiskAssessmentMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: RiskAssessmentMap = {};
    for (const [key, v] of Object.entries(parsed ?? {})) {
      if (!v || typeof v !== "object") continue;
      const o = v as { likelihood?: unknown; impact?: unknown; by?: unknown; at?: unknown };
      if (o.likelihood !== 1 && o.likelihood !== 2 && o.likelihood !== 3) continue;
      if (o.impact !== 1 && o.impact !== 2 && o.impact !== 3) continue;
      out[key] = { likelihood: o.likelihood, impact: o.impact, by: String(o.by ?? ""), at: String(o.at ?? "") };
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeRiskAssessment(map: RiskAssessmentMap): string {
  return JSON.stringify(map);
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

export function mergeRiskAssessment(map: RiskAssessmentMap, key: string, likelihood: 1 | 2 | 3, impact: 1 | 2 | 3, by: string, at: string): RiskAssessmentMap {
  return { ...map, [key]: { likelihood, impact, by, at } };
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

/**
 * Append one assessment to the ledger and refresh the sidecar projection —
 * one transaction, one audit row. The ledger is the history; the sidecar is
 * only ever the latest value per key.
 */
export function recordRiskAssessment(db: Db, input: RecordRiskAssessmentInput): RiskAssessmentRecord & { id: string } {
  const at = input.at ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO risk_assessment_ledger (id, project_id, item_key, likelihood, impact, mitigation, recorded_by, recorded_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, input.projectId, input.key, input.likelihood, input.impact, input.mitigation, input.by, at],
    );
    const row = db
      .query("SELECT risk_heatmap_assessment_json AS j FROM md_project WHERE id = ?")
      .get(input.projectId) as { j: string | null } | undefined;
    const merged = mergeRiskAssessment(parseRiskAssessment(row?.j), input.key, input.likelihood, input.impact, input.by, at);
    db.run("UPDATE md_project SET risk_heatmap_assessment_json = ? WHERE id = ?", [serializeRiskAssessment(merged), input.projectId]);
    appendAudit(db, {
      actor: input.by,
      action: "risk_assessment.recorded",
      target: `${input.projectId}:${input.key}:${input.likelihood}-${input.impact}${input.mitigation ? ":mitigation" : ""}`,
      now: at,
    });
  })();
  return { id, likelihood: input.likelihood, impact: input.impact, mitigation: input.mitigation, by: input.by, at };
}

/** Latest assessment per item key — ledger first, sidecar as the pre-0160 fallback. */
export function latestRiskAssessments(db: Db, projectId: string): Record<string, RiskAssessmentRecord> {
  const out: Record<string, RiskAssessmentRecord> = {};
  const row = db
    .query("SELECT risk_heatmap_assessment_json AS j FROM md_project WHERE id = ?")
    .get(projectId) as { j: string | null } | undefined;
  for (const [key, v] of Object.entries(parseRiskAssessment(row?.j))) out[key] = { ...v, mitigation: null };
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
