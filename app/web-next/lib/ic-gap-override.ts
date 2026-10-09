// IC GO with missing artifacts (UX round 2, R2-B item 3).
// Boundary #2: the human decides. A missing business-case adoption, an ungraded
// RAG or pending establishment steps are EVIDENCE for the IC, not prerequisites -
// so the system never blocks a recorded GO. The screen warns, lists each gap and
// requires a typed rationale; the rationale is stored with the decision and shown
// in the IC package. No schema change: the override rides in the existing
// gate_decision.rationale text behind a stable marker and is parsed on read.
import { getDb } from "../../../db/client.ts";
import { readRagView, recomputeRag } from "../../../db/lib/rag-service.ts";
import { findAdoptedCase, listBusinessCases } from "./business-case.ts";
import { establishmentProgress } from "./establishment.ts";

export const IC_GAP_GATES = ["entity_ic", "group_ic"] as const;
export const GAP_MARKER = "[누락 산출물 예외 근거]";

export interface GapOverride {
  items: string[];
  rationale: string;
}

/** The artifacts an IC GO is missing right now, as Korean labels (empty = none). */
export function icGoGapItems(projectId: string, actor?: string): string[] {
  const db = getDb();
  const gaps: string[] = [];
  if (!findAdoptedCase(listBusinessCases(projectId))) gaps.push("채택된 Business Case 없음 (S8)");
  if (actor) {
    try { recomputeRag(db, projectId, "ic_package", { actor }); } catch { /* the read below reports not graded */ }
  }
  if (!readRagView(db, projectId).overall?.grade) gaps.push("RAG 종합 등급 미산정");
  const origin = (db.query("SELECT origin FROM md_project WHERE id = ?").get(projectId) as { origin: string | null } | undefined)?.origin;
  if (origin === "internal" || origin === "joint") {
    const p = establishmentProgress(projectId);
    if (!p.complete) gaps.push(`설립 실행 ${p.done}/5 — 대기 ${p.total - p.done}단계`);
  }
  return gaps;
}

/** Appends the override block to the human rationale (the stored form). */
export function composeRationale(rationale: string, override: GapOverride | null): string {
  if (!override) return rationale;
  return `${rationale}\n\n${GAP_MARKER}\n누락: ${override.items.join("; ")}\n근거: ${override.rationale}`;
}

/** Splits a stored rationale into the human rationale and its gap override (if any). */
export function parseRationale(stored: string): { rationale: string; gap_override: GapOverride | null } {
  const at = stored.indexOf(`\n\n${GAP_MARKER}\n`);
  if (at < 0) return { rationale: stored, gap_override: null };
  const block = stored.slice(at + 2 + GAP_MARKER.length + 1);
  const m = block.match(/^누락: ([\s\S]*?)\n근거: ([\s\S]*)$/);
  if (!m) return { rationale: stored, gap_override: null };
  return { rationale: stored.slice(0, at), gap_override: { items: m[1].split("; ").filter(Boolean), rationale: m[2] } };
}
