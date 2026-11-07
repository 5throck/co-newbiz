// Pure view helpers for the gate-integrity UI (second review, conditions, hard blocks). Client-safe.
// The server decides every outcome; these only shape what the person sees and sends.

export type CountersignViewState = "not_applicable" | "legacy" | "countersigned" | "pending_countersign" | "countersign_rejected";
export const COUNTERSIGN_CHOICES = ["approved", "conditional", "rejected", "withdrawn_pending_resubmission"] as const;
export type CountersignChoice = (typeof COUNTERSIGN_CHOICES)[number];
export const CLEAR_BY_ALL = ["group_ic", "establishment", "closing"] as const;
export type ClearByView = (typeof CLEAR_BY_ALL)[number];

export interface LatestGateRow {
  gate: string;
  /** EFFECTIVE verdict (an IC GO awaiting its second review reads `pending`). */
  decision: string | null;
  recorded_decision?: string | null;
  decision_id?: string;
  decided_by?: string;
  countersign_state?: string | null;
  awaiting_countersign?: boolean;
}

/** What was recorded: falls back to `decision` for responses that predate `recorded_decision`. */
export function recordedDecisionOf(row: LatestGateRow | undefined | null): "go" | "hold" | "kill" | null {
  const d = row ? (row.recorded_decision ?? row.decision) : null;
  return d === "go" || d === "hold" || d === "kill" ? d : null;
}

export function isAwaitingCountersign(row: LatestGateRow | undefined | null): boolean {
  return !!row && (row.awaiting_countersign === true || row.countersign_state === "pending_countersign");
}

/** Conditions are required for a conditional second review. */
export function countersignProblem(choice: CountersignChoice, reason: string, conditions: ReadonlyArray<{ text: string }>): "reason" | "conditions" | null {
  if (!reason.trim()) return "reason";
  if (choice === "conditional" && !conditions.some((c) => c.text.trim())) return "conditions";
  return null;
}

export interface ConditionDraft { text: string; clear_by: ClearByView; owner_role: string }
export const EMPTY_CONDITION = (clearBy: ClearByView): ConditionDraft => ({ text: "", clear_by: clearBy, owner_role: "" });

/** Allowed `clear_by` values: a group_ic GO cannot wait for its own sitting. */
export function clearByOptions(gate: string): readonly ClearByView[] {
  return gate === "group_ic" ? ["establishment", "closing"] : CLEAR_BY_ALL;
}

export function conditionsPayload(drafts: readonly ConditionDraft[]): Array<{ text: string; clear_by: ClearByView; owner_role?: string }> {
  return drafts.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), clear_by: c.clear_by, ...(c.owner_role.trim() ? { owner_role: c.owner_role.trim() } : {}) }));
}

export interface HardBlockView { code: string; keys: string[]; enforced: boolean }
export const KNOWN_HARD_BLOCKS = ["kill_binding_unoverridden", "validators_incomplete", "condition_open", "certification_unconfirmed", "wacc_unconfirmed", "kill_carry_overdue", "kill_carry_unassessed", "kill_lineage_missing", "kill_enforce_unsafe"] as const;
export function enforcedBlocks<T extends { enforced?: boolean }>(blocks: readonly T[]): T[] {
  return blocks.filter((b) => b.enforced !== false);
}
export function advisoryBlocks<T extends { enforced?: boolean }>(blocks: readonly T[]): T[] {
  return blocks.filter((b) => b.enforced === false);
}

/** Readable list from a 409 `details` array of strings / objects. */
export function detailList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return String(o.text ?? o.title ?? o.key ?? o.id ?? "");
    }
    return "";
  }).filter(Boolean);
}

/** Lists carried by the new gate-write 409s. */
export function integrityErrorList(code: string, details: Record<string, unknown>): string[] {
  if (code === "validators_incomplete") return detailList(details.missing);
  if (code === "wacc_unconfirmed") return detailList(details.missing);
  if (code === "condition_open") return detailList(details.conditions);
  if (code === "certification_unconfirmed") return detailList(details.certifications);
  if (code === "kill_carry_overdue" || code === "kill_carry_unassessed" || code === "kill_enforce_unsafe") return detailList(details.keys);
  return [];
}

export function filterConditions<T extends { status: string }>(rows: readonly T[], f: "all" | "open" | "cleared" | "withdrawn"): T[] {
  return f === "all" ? [...rows] : rows.filter((r) => r.status === f);
}
