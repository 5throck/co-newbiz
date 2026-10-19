// @version 1.0.0
/**
 * risk-assessment — S9 리스크 히트맵의 사람 판정 오버라이드 (2026-10-19 decider
 * question: likelihood가 전부 하드코딩 2라 실제 평가 도구가 아니었다). 사이드카
 * (md_project.risk_heatmap_assessment_json, 마이그레이션 0156)에 히트맵 항목
 * 소스 키(dd:<finding_id> / coc:<contract_id> / inc:<incentive_id>)별로 사람의
 * 가능성·영향(1~3)을 기록한다. 자동 산정값은 오버라이드가 없을 때의 기본값이며,
 * 기록은 analyst+ 사람 전용 (경계 #2), 감사가 남는다.
 */
import { appendAudit } from "../../../db/lib/access-control.ts";

export const RISK_ASSESSMENT_LEVELS = [1, 2, 3] as const;

export interface RiskAssessmentOverride {
  likelihood: 1 | 2 | 3;
  impact: 1 | 2 | 3;
  by: string;
  at: string;
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

/** Validate one person assessment: source key + likelihood/impact in 1..3. */
export function validateRiskAssessmentInput(input: {
  key?: unknown; likelihood?: unknown; impact?: unknown;
}): { key: string; likelihood: 1 | 2 | 3; impact: 1 | 2 | 3 } {
  const bad = (m: string) => new RiskAssessmentValidationError(m);
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!key || !/^(dd|coc|inc):/.test(key)) throw bad("key는 dd:|coc:|inc: 접두어를 가져야 합니다.");
  if (input.likelihood !== 1 && input.likelihood !== 2 && input.likelihood !== 3) throw bad("likelihood는 1~3이어야 합니다.");
  if (input.impact !== 1 && input.impact !== 2 && input.impact !== 3) throw bad("impact는 1~3이어야 합니다.");
  return { key, likelihood: input.likelihood, impact: input.impact };
}

export function mergeRiskAssessment(map: RiskAssessmentMap, key: string, likelihood: 1 | 2 | 3, impact: 1 | 2 | 3, by: string, at: string): RiskAssessmentMap {
  return { ...map, [key]: { likelihood, impact, by, at } };
}
