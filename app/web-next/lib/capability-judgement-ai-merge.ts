// @version 1.0.0
/**
 * ADR-0171 amendment 2026-10-15: client-safe types and the pure fill-empty-only merge for the S5 "판정 제안 (AI)" drafts.
 * No server imports, so the S5 page bundle can use it. The server side lives in capability-judgement-draft.ts.
 */
import type { AttainabilityGrade, GapResolution } from "./capability-gap.ts";

/** Max rows per AI proposal call (server cap; the page sends at most this many ids). */
export const JUDGEMENT_ROW_CAP = 12;

export type JudgementField = "resolution" | "expectedLevel" | "cost" | "months" | "grade" | "rationale";
export const JUDGEMENT_FIELD_LABEL: Record<JudgementField, string> = {
  resolution: "해소 방식", expectedLevel: "기대 수준", cost: "비용", months: "기간", grade: "달성 가능성", rationale: "근거·증빙",
};

export interface JudgementProposal {
  resolution: GapResolution | null;
  expectedLevel: string;
  costKrwM: number | null;
  monthsToAttain: number | null;
  grade: AttainabilityGrade | null;
  rationale: string;
  basis: { resolution: string; expectedLevel: string; cost: string; months: string; grade: string; estimate?: string };
  confidence?: "low" | "medium" | "high";
}

/** Page draft state shape (mirrors JudgementDraft in CapabilityJudgementTable.tsx; strings only). */
export interface PageJudgementDraft { resolution: string; expectedLevel: string; cost: string; months: string; grade: string; rationale: string }
export type AiMarks = Record<string, JudgementField[]>;

/**
 * Pure client merge: fill ONLY the empty fields of each row's page draft with the proposal; fields the person already
 * filled (or edited) stay untouched. A high/low grade is only applied when a rationale exists after the merge.
 * Returns the new drafts, the AI-filled fields per row (the "AI 초안" marks) and how many fields were applied.
 */
export function mergeJudgementProposals(
  current: Record<string, PageJudgementDraft>,
  proposals: Record<string, Pick<JudgementProposal, "resolution" | "expectedLevel" | "costKrwM" | "monthsToAttain" | "grade" | "rationale">>,
): { drafts: Record<string, PageJudgementDraft>; marks: AiMarks; applied: number } {
  const drafts = { ...current };
  const marks: AiMarks = {};
  let applied = 0;
  for (const [id, p] of Object.entries(proposals)) {
    const base = current[id];
    if (!base) continue;
    const d = { ...base };
    const m: JudgementField[] = [];
    if (!d.resolution.trim() && p.resolution) { d.resolution = p.resolution; m.push("resolution"); }
    if (!d.expectedLevel.trim() && p.expectedLevel) { d.expectedLevel = p.expectedLevel; m.push("expectedLevel"); }
    if (!d.cost.trim() && p.costKrwM !== null) { d.cost = String(p.costKrwM); m.push("cost"); }
    if (!d.months.trim() && p.monthsToAttain !== null) { d.months = String(p.monthsToAttain); m.push("months"); }
    if (!d.rationale.trim() && p.rationale) { d.rationale = p.rationale; m.push("rationale"); }
    if (!d.grade && p.grade && (p.grade === "medium" || d.rationale.trim())) { d.grade = p.grade; m.push("grade"); }
    if (m.length === 0) continue;
    drafts[id] = d;
    marks[id] = m;
    applied += m.length;
  }
  return { drafts, marks, applied };
}

