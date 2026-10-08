// @version 1.1.0
/** Shared result types for the AI evaluation harness (Wave B-2). */

export interface CaseScore {
  caseId: string;
  stage: string;
  fn: string;
  /** 0..1, deterministic. null = not scored (see couldNotEvaluate). */
  score: number | null;
  failures: string[];
}

export interface CouldNotEvaluate {
  caseId: string;
  fn: string;
  reason: string;
}

export interface SuiteResult {
  name: string;
  kind: "deterministic" | "llm";
  cases: CaseScore[];
  couldNotEvaluate: CouldNotEvaluate[];
  /** Extra suite-level metrics (e.g. schema-valid rate). */
  metrics: Record<string, number>;
  /** Optional pre-rendered markdown lines (e.g. the calibration reliability tables). */
  detail?: string[];
}

export const meanScore = (cases: CaseScore[]): number | null => {
  const s = cases.filter((c) => c.score !== null) as Array<CaseScore & { score: number }>;
  return s.length === 0 ? null : s.reduce((a, c) => a + c.score, 0) / s.length;
};
