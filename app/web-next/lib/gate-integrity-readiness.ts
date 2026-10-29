// @version 1.0.0
/**
 * Gate-integrity readiness and structured breach codes - shared by the KPI reader (server) and the admin screen (client).
 * Pure and dependency-free: no database, no env. The server resolves the current mode from the family flags and hands the
 * counts in; this module only decides "can this rule family flip from shadow to enforce" per the enforce-flip runbook
 * (docs/runbooks/gate-integrity-enforce-flip.md section 2): 14 clean days, at least 10 decisions, zero would-blocks.
 * Agents never flip a flag - the owner does.
 */

export const READINESS_CLEAN_DAYS = 14;
export const READINESS_MIN_DECISIONS = 10;

export type FamilyMode = "off" | "shadow" | "enforce";

export type BreachCode =
  | "go_share_high" | "go_share_shift"
  | "divergence_zero" | "divergence_high"
  | "divergence_reason_missing" | "would_block_events"
  | "rationale_rejections_high" | "ack_reason_reused"
  | "unassessed_high"
  | "would_block_unexplained"
  | "countersign_pending_old" | "countersign_slow" | "reviewer_holders_low"
  | "conditions_old" | "group_ic_conditions_open"
  | "waivers_old"
  | "na_unconfirmed_old"
  | "wacc_provisional";

export interface BreachItem { code: BreachCode; params: Record<string, string | number> }

/** Build a Breach from [code, params, english fallback] triples. `reasons` keeps the English text for older consumers. */
export function buildBreach(found: ReadonlyArray<readonly [BreachCode, Record<string, string | number>, string]>): { breached: boolean; reasons: string[]; items: BreachItem[] } {
  return { breached: found.length > 0, reasons: found.map((f) => f[2]), items: found.map((f) => ({ code: f[0], params: f[1] })) };
}

export type NotReadyReason =
  | { code: "mode_off" }
  | { code: "clean_days_short"; days: number; need: number }
  | { code: "decisions_few"; count: number; need: number }
  | { code: "would_blocks_open"; count: number };

export type ReadinessVerdict =
  | { state: "enforcing" }
  | { state: "ready" }
  | { state: "not_yet"; reasons: NotReadyReason[] };

export interface FamilyReadinessInput {
  mode: FamilyMode;
  cleanDays: number;
  decisions: number;
  /** Would-block events in the last 14 days (the unexplained count: the system cannot store an explained flag). */
  wouldBlocks14d: number;
  minDecisions?: number;
}

export function computeReadiness(i: FamilyReadinessInput): ReadinessVerdict {
  if (i.mode === "enforce") return { state: "enforcing" };
  const need = i.minDecisions ?? READINESS_MIN_DECISIONS;
  const reasons: NotReadyReason[] = [];
  if (i.mode === "off") reasons.push({ code: "mode_off" });
  if (i.wouldBlocks14d > 0) reasons.push({ code: "would_blocks_open", count: i.wouldBlocks14d });
  if (i.cleanDays < READINESS_CLEAN_DAYS) reasons.push({ code: "clean_days_short", days: i.cleanDays, need: READINESS_CLEAN_DAYS });
  if (i.decisions < need) reasons.push({ code: "decisions_few", count: i.decisions, need });
  return reasons.length === 0 ? { state: "ready" } : { state: "not_yet", reasons };
}

export interface FamilyStatus {
  family: string;
  mode: FamilyMode;
  clean_days: number;
  decisions: number;
  would_blocks_14d: number;
  verdict: ReadinessVerdict;
}

export function familyStatus(family: string, mode: FamilyMode, c: { cleanDays: number; decisions: number; wouldBlocks14d: number }, minDecisions?: number): FamilyStatus {
  return { family, mode, clean_days: c.cleanDays, decisions: c.decisions, would_blocks_14d: c.wouldBlocks14d, verdict: computeReadiness({ mode, ...c, minDecisions }) };
}
