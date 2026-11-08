// Pure view-model helpers for the acknowledged-GO block (gate decision panel and proposal confirm page).
// The server stays the authority (it recomputes the snapshot and re-checks every reason); these helpers only
// shape what the person sees and sends, and carry entered reasons across a snapshot refresh.
import { validateRationale, type RationaleReason } from "./rationale-check.ts";

export interface SnapshotKillItem {
  key: string;
  procedure: string;
  criterion_id: string;
  title: string;
  action: string;
}
export interface SnapshotRequiredAck {
  key: string;
  kind: string;
  procedure?: string;
  criterion_id?: string;
  action?: string;
}
/** ADR-0193: a criterion whose stage is after the entity's current stage - information only, never acknowledged or counted. */
export interface SnapshotKillNotReached extends SnapshotKillItem {
  evaluable_from: string;
  reevaluate_at: string;
}
/** ADR-0193: how a carried criterion stands at this gate. open = evaluated but still unassessed (or overdue); open_monitoring = S12, waits for post-close data. */
export type KillClosure = "evaluated" | "open" | "out_of_track" | "open_monitoring";
export interface SnapshotKillCarriedIn {
  key: string;
  title: string;
  from_decision_id: string | null;
  outcome: "false" | "triggered" | "unassessed" | "overdue" | "out_of_track";
  reason?: string | null;
  closure: KillClosure;
  action: string;
  evaluable_from: string;
  reevaluate_at: string;
  route_decision_id: string | null;
  implicit?: boolean;
}
export interface SnapshotKillScheduled {
  key: string;
  title: string;
  action: string;
  evaluable_from: string;
  reevaluate_at: string;
  status: "pending";
}
export interface SnapshotKillCaveat {
  key: string;
  caveat: string;
}
export interface GateSnapshotView {
  gate: string;
  kill: {
    triggered: Array<SnapshotKillItem & { binding?: boolean; override_id?: string | null; partial_input?: boolean }>;
    unassessed: SnapshotKillItem[];
    inert: number;
    inert_list: Array<{ key: string; title: string }>;
    evaluated?: number;
    /** Schema v2 (ADR-0193). Absent on a legacy snapshot: read as empty. */
    current_stage?: string;
    not_reached?: SnapshotKillNotReached[];
    carried_in?: SnapshotKillCarriedIn[];
    scheduled?: SnapshotKillScheduled[];
    caveats?: SnapshotKillCaveat[];
    lineage_missing?: boolean;
  };
  rag: {
    overall: string | null;
    dimensions: Array<{ dimension: string; grade: string }>;
    data_confidence_cap: { grade: string | null; applied: boolean; capped_dimension: string | null };
  } | null;
  validators: { declared: number; applicable: number; completed: number; missing: string[] } | null;
  nonwaivable_open: Array<{ key: string; checklist_id: string; item_id: string; status: string }>;
  wacc: { subject: string | null; status: "sourced" | "assumed" | "absent"; bf13: "set" | "unset" | "n/a" } | null;
  waivers: {
    active: Array<{ id: string; clause_ref: string; approved_by: string | null; expires_at: string }>;
    expiring_14d: string[];
  };
  ladder: {
    prior_gate: string | null;
    prior_decision: string | null;
    effective: boolean;
    blocker: string | null;
    prior_awaiting_countersign?: boolean;
  };
  conditions_open?: Array<{ id: string; text: string; clear_by: string }>;
  ai: { brief_id: string; recommended: string | null; confidence: string | null } | null;
  required_acks: SnapshotRequiredAck[];
  hard_blocks: Array<{ code: string; keys: string[]; enforced?: boolean }>;
}
export interface GateSnapshotEnvelope {
  gate: string;
  snapshot_hash: string;
  snapshot: GateSnapshotView;
  cached?: boolean;
  legacy?: boolean;
}

/**
 * Entered acknowledgement state.
 * - Unassessed kill criteria (kind "kill_unassessed") are CONFIRMED with a checkbox per item and answered with ONE shared
 *   reason (`sharedReason`) applied to every checked item; `perItem` switches to one reason per checked item (`reasons`).
 * - Every other required kind keeps one reason per item (`reasons`).
 */
export interface AckState {
  reasons: Record<string, string>;
  /** Unassessed items the person confirmed as not assessed. */
  checked: Record<string, boolean>;
  sharedReason: string;
  perItem: boolean;
}
export const EMPTY_ACK_STATE: AckState = { reasons: {}, checked: {}, sharedReason: "", perItem: false };

/** The server stores one entry per key, so every payload item carries its own reason (no `covers`). */
export interface AckPayloadItem {
  key: string;
  kind: string;
  reason: string;
}

export const isUnassessedAck = (r: SnapshotRequiredAck): boolean => r.kind === "kill_unassessed";

/** Required items that are confirmed with a checkbox and the shared reason. */
export function unassessedAcks(required: readonly SnapshotRequiredAck[]): SnapshotRequiredAck[] {
  return required.filter(isUnassessedAck);
}

/** Required items that keep their own reason field. */
export function reasonAcks(required: readonly SnapshotRequiredAck[]): SnapshotRequiredAck[] {
  return required.filter((r) => !isUnassessedAck(r));
}

/** The (trimmed) reason that applies to one required item under the current state; "" when it has none. */
export function ackReasonOf(r: SnapshotRequiredAck, state: AckState): string {
  if (isUnassessedAck(r)) return (state.perItem ? (state.reasons[r.key] ?? "") : state.sharedReason).trim();
  return (state.reasons[r.key] ?? "").trim();
}

/** Acknowledgements to send: one per satisfied item (non-empty reason; unassessed items only when checked). The server names what is missing. */
export function buildAckPayload(required: readonly SnapshotRequiredAck[], state: AckState): AckPayloadItem[] {
  const out: AckPayloadItem[] = [];
  for (const r of required) {
    if (isUnassessedAck(r) && !state.checked[r.key]) continue;
    const reason = ackReasonOf(r, state);
    if (!reason) continue;
    out.push({ key: r.key, kind: r.kind, reason });
  }
  return out;
}

/** Keys still open: an unassessed item that is unchecked or has no reason, or any other item without a reason. */
export function missingAckKeys(required: readonly SnapshotRequiredAck[], state: AckState): string[] {
  return required
    .filter((r) => (isUnassessedAck(r) && !state.checked[r.key]) || !ackReasonOf(r, state))
    .map((r) => r.key);
}

/** A form-only hint for a typed reason (null = acceptable or still empty). */
export function reasonHint(reason: string): RationaleReason | null {
  if (!reason.trim()) return null;
  const check = validateRationale(reason, "ack");
  return check.ok ? null : check.reason;
}

/** Carry entered state over to a fresh snapshot: keep what belongs to a key that still exists, report the rest. */
export function reconcileAckState(
  prev: AckState,
  prevRequired: readonly SnapshotRequiredAck[],
  nextRequired: readonly SnapshotRequiredAck[],
): { state: AckState; dropped: string[]; added: string[] } {
  const nextKeys = new Set(nextRequired.map((r) => r.key));
  const reasons: Record<string, string> = {};
  const checked: Record<string, boolean> = {};
  const dropped: string[] = [];
  const drop = (k: string) => {
    if (!dropped.includes(k)) dropped.push(k);
  };
  for (const [k, v] of Object.entries(prev.reasons)) {
    if (!v.trim()) continue;
    if (nextKeys.has(k)) reasons[k] = v;
    else drop(k);
  }
  for (const [k, on] of Object.entries(prev.checked)) {
    if (!on) continue;
    if (nextKeys.has(k)) checked[k] = true;
    else drop(k);
  }
  const prevKeys = new Set(prevRequired.map((r) => r.key));
  const added = nextRequired.map((r) => r.key).filter((k) => !prevKeys.has(k));
  return { state: { reasons, checked, sharedReason: prev.sharedReason, perItem: prev.perItem }, dropped, added };
}

/** Split a server error `details` into per-key problems for inline display. */
export interface AckProblems {
  missing: string[];
  unknown: string[];
  invalid: Array<{ key: string; problem: string }>;
  weak: Array<{ key: string; reason: string }>;
}
export function ackProblemsFromError(code: string, details: unknown): AckProblems {
  const d = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const out: AckProblems = { missing: [], unknown: [], invalid: [], weak: [] };
  if (code === "ack_required") {
    out.missing = strs(d.missing);
    out.unknown = strs(d.unknown);
    if (Array.isArray(d.invalid))
      out.invalid = (d.invalid as Array<Record<string, unknown>>)
        .filter((x) => typeof x?.key === "string")
        .map((x) => ({ key: String(x.key), problem: String(x.problem ?? "") }));
  } else if (code === "rationale_insufficient" && d.field === "acknowledgements" && Array.isArray(d.items)) {
    out.weak = (d.items as Array<Record<string, unknown>>)
      .filter((x) => typeof x?.key === "string")
      .map((x) => ({ key: String(x.key), reason: String(x.reason ?? "") }));
  }
  return out;
}

/** A readable fallback title for a key without a snapshot item: the catalog key suffix to look up. */
export function ackKeyFamily(key: string): "kill" | "rag" | "np" | "other" {
  if (key.startsWith("kill:")) return "kill";
  if (key.startsWith("rag:")) return "rag";
  if (key.startsWith("np:")) return "np";
  return "other";
}

// ── ADR-0193: stage-scoped kill criteria (not reached, carried in, scheduled, caveats, partial input) ──

/** Gate ids the catalog can name (`common.gate.<id>`); anything else (e.g. `open_monitoring`) has no gate label. */
const NAMED_GATES: ReadonlySet<string> = new Set([
  "screening",
  "pre_fs",
  "target_screening",
  "fs",
  "dd",
  "entity_ic",
  "group_ic",
]);
export const isNamedGate = (g: string | null | undefined): g is string => !!g && NAMED_GATES.has(g);

/** The v2 kill-scope fields with legacy snapshots read as empty. */
export function killScopeView(kill: GateSnapshotView["kill"]): {
  notReached: SnapshotKillNotReached[];
  carriedIn: SnapshotKillCarriedIn[];
  scheduled: SnapshotKillScheduled[];
  caveats: SnapshotKillCaveat[];
  partialTriggered: GateSnapshotView["kill"]["triggered"];
  closedCarries: number;
} {
  const carriedIn = kill.carried_in ?? [];
  return {
    notReached: kill.not_reached ?? [],
    carriedIn,
    scheduled: kill.scheduled ?? [],
    caveats: kill.caveats ?? [],
    partialTriggered: kill.triggered.filter((t) => t.partial_input === true),
    closedCarries: carriedIn.filter((c) => c.closure === "evaluated" || c.closure === "out_of_track").length,
  };
}

/** Closure state -> catalog suffix and a leading icon (a state is never colour alone). */
export const CLOSURE_VIEW: Readonly<Record<KillClosure, { icon: string; tone: "green" | "amber" | "neutral" }>> = {
  evaluated: { icon: "✓", tone: "green" },
  open: { icon: "⚠", tone: "amber" },
  open_monitoring: { icon: "◐", tone: "neutral" },
  out_of_track: { icon: "↷", tone: "neutral" },
};
export function closureView(closure: string): { id: KillClosure; icon: string; tone: "green" | "amber" | "neutral" } {
  const id: KillClosure = closure in CLOSURE_VIEW ? (closure as KillClosure) : "open";
  return { id, ...CLOSURE_VIEW[id] };
}

/** Evidence caveats of one criterion key (a key may carry several; duplicates collapse). */
export function caveatsOfKey(kill: GateSnapshotView["kill"], key: string): string[] {
  return [...new Set((kill.caveats ?? []).filter((c) => c.key === key).map((c) => c.caveat))];
}

/** `ack_not_reached` (400): the client asked to acknowledge a criterion the server classifies as not reached. */
export const ACK_NOT_REACHED_CODE = "ack_not_reached";
export function ackNotReachedKeys(details: unknown): string[] {
  const d = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
  return Array.isArray(d.keys) ? d.keys.filter((x): x is string => typeof x === "string") : [];
}

/** Drop entered state for keys the server no longer asks about (after `ack_not_reached` or a refreshed snapshot). */
export function dropAckKeys(state: AckState, keys: readonly string[]): AckState {
  const drop = new Set(keys);
  const reasons = Object.fromEntries(Object.entries(state.reasons).filter(([k]) => !drop.has(k)));
  const checked = Object.fromEntries(Object.entries(state.checked).filter(([k]) => !drop.has(k)));
  return { ...state, reasons, checked };
}

/**
 * AI-divergence on the gate decision form (ADR-0186 D9). The form shows ONE reasoning field; when the decision differs
 * from the AI recommendation its text is also the `divergence_reason` (server: required for a GO, optional otherwise).
 */
export type DivergenceMode = "required" | "optional" | null;
export function divergenceMode(aiRecommended: string | null | undefined, decision: string): DivergenceMode {
  if (!aiRecommended || aiRecommended === decision) return null;
  return decision === "go" ? "required" : "optional";
}

/** The `divergence_reason` to send: the merged field text when the decision differs from the AI, else nothing. */
export function mergedDivergenceReason(
  aiRecommended: string | null | undefined,
  decision: string,
  rationale: string,
): string | undefined {
  const text = rationale.trim();
  return divergenceMode(aiRecommended, decision) && text ? text : undefined;
}

/** Server 422s that belong to the divergence reason (shown on the merged rationale field). */
export function isDivergenceError(code: string, details: unknown): boolean {
  if (code === "divergence_reason_required") return true;
  const d = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
  return code === "rationale_insufficient" && d.field === "divergence_reason";
}
