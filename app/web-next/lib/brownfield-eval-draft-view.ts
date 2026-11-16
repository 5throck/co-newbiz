// brownfield-eval-draft-view.ts — read model for the additive `eval_draft` field on the S6 targets list (ADR-0199 A8).
// Provisional (AI draft) state only: it never touches eval_summary, ranking or promotion (spec §8).
import type { Database } from "bun:sqlite";
import {
  getLatestRunItemForTarget,
  getLatestVersionWithCheckedAt,
  type EvalDraftCategory,
  type EvidenceGrade,
} from "../../../db/repositories/brownfield-eval-draft.repository.ts";

/** `갱신 권장` threshold (the S1 STALE_DAYS rule). */
export const DRAFT_STALE_DAYS = 90;

export interface VersionChip {
  version_no: number;
  created_at: string;
  checked_at: string;
  provisional_score: number | null;
  stale: boolean;
  evidence_grade: EvidenceGrade;
}

export interface EvalDraftView {
  financial?: VersionChip;
  technical?: VersionChip;
  run_item?: { run_id: string; state: string; error: string | null };
}

export function evalDraftView(db: Database, targetId: string, now: Date = new Date()): EvalDraftView {
  const out: EvalDraftView = {};
  for (const category of ["financial", "technical"] as EvalDraftCategory[]) {
    const v = getLatestVersionWithCheckedAt(db, targetId, category);
    if (!v) continue;
    out[category] = {
      version_no: v.version_no,
      created_at: v.created_at,
      checked_at: v.checked_at,
      provisional_score: v.provisional_score,
      stale: now.getTime() - new Date(v.checked_at).getTime() > DRAFT_STALE_DAYS * 86_400_000,
      evidence_grade: v.evidence_grade,
    };
  }
  const item = getLatestRunItemForTarget(db, targetId);
  if (item) out.run_item = { run_id: item.run_id, state: item.state, error: item.error_message };
  return out;
}
