// Pure view-model helpers for the acknowledged-GO block (gate decision panel and proposal confirm page).
// The server stays the authority (it recomputes the snapshot and re-checks every reason); these helpers only
// shape what the person sees and sends, and carry entered reasons across a snapshot refresh.
import { validateRationale, type RationaleReason } from "./rationale-check.ts";

export interface SnapshotKillItem { key: string; procedure: string; criterion_id: string; title: string; action: string }
export interface SnapshotRequiredAck { key: string; kind: string; procedure?: string; criterion_id?: string; action?: string }
export interface GateSnapshotView {
  gate: string;
  kill: {
    triggered: Array<SnapshotKillItem & { binding?: boolean; override_id?: string | null }>;
    unassessed: SnapshotKillItem[];
    inert: number;
    inert_list: Array<{ key: string; title: string }>;
    evaluated?: number;
  };
  rag: { overall: string | null; dimensions: Array<{ dimension: string; grade: string }>; data_confidence_cap: { grade: string | null; applied: boolean; capped_dimension: string | null } } | null;
  validators: { declared: number; applicable: number; completed: number; missing: string[] } | null;
  nonwaivable_open: Array<{ key: string; checklist_id: string; item_id: string; status: string }>;
  wacc: { subject: string | null; status: "sourced" | "assumed" | "absent"; bf13: "set" | "unset" | "n/a" } | null;
  waivers: { active: Array<{ id: string; clause_ref: string; approved_by: string | null; expires_at: string }>; expiring_14d: string[] };
  ladder: { prior_gate: string | null; prior_decision: string | null; effective: boolean; blocker: string | null };
  ai: { brief_id: string; recommended: string | null; confidence: string | null } | null;
  required_acks: SnapshotRequiredAck[];
  hard_blocks: Array<{ code: string; keys: string[] }>;
}
export interface GateSnapshotEnvelope { gate: string; snapshot_hash: string; snapshot: GateSnapshotView; cached?: boolean; legacy?: boolean }

/** Entered acknowledgement state: one reason per key, plus the procedures whose unassessed items share one reason. */
export interface AckState {
  reasons: Record<string, string>;
  shared: Record<string, boolean>;
}
export const EMPTY_ACK_STATE: AckState = { reasons: {}, shared: {} };

export interface AckPayloadItem { key: string; kind: string; reason: string; covers?: string[] }

/** The key that holds the shared reason of a procedure's unassessed group (its first key, in snapshot order). */
export function groupLead(required: readonly SnapshotRequiredAck[], procedure: string): string | null {
  return required.find((r) => r.kind === "kill_unassessed" && r.procedure === procedure)?.key ?? null;
}

export function unassessedProcedures(required: readonly SnapshotRequiredAck[]): string[] {
  const out: string[] = [];
  for (const r of required) if (r.kind === "kill_unassessed" && r.procedure && !out.includes(r.procedure)) out.push(r.procedure);
  return out;
}

/** The keys whose reason field is shown (shared groups collapse to their lead). */
export function visibleAckKeys(required: readonly SnapshotRequiredAck[], state: AckState): SnapshotRequiredAck[] {
  return required.filter((r) => {
    if (r.kind !== "kill_unassessed" || !r.procedure || !state.shared[r.procedure]) return true;
    return groupLead(required, r.procedure) === r.key;
  });
}

/** Acknowledgements to send: non-empty reasons only (the server names what is missing); shared groups use `covers`. */
export function buildAckPayload(required: readonly SnapshotRequiredAck[], state: AckState): AckPayloadItem[] {
  const out: AckPayloadItem[] = [];
  for (const r of visibleAckKeys(required, state)) {
    const reason = (state.reasons[r.key] ?? "").trim();
    if (!reason) continue;
    const item: AckPayloadItem = { key: r.key, kind: r.kind, reason };
    if (r.kind === "kill_unassessed" && r.procedure && state.shared[r.procedure]) {
      const covers = required.filter((x) => x.kind === "kill_unassessed" && x.procedure === r.procedure && x.key !== r.key).map((x) => x.key);
      if (covers.length > 0) item.covers = covers;
    }
    out.push(item);
  }
  return out;
}

/** Keys that still have no reason (blocks the submit locally; the server re-checks). */
export function missingAckKeys(required: readonly SnapshotRequiredAck[], state: AckState): string[] {
  return visibleAckKeys(required, state).filter((r) => !(state.reasons[r.key] ?? "").trim()).map((r) => r.key);
}

/** A form-only hint for a typed reason (null = acceptable or still empty). */
export function reasonHint(reason: string): RationaleReason | null {
  if (!reason.trim()) return null;
  const check = validateRationale(reason, "ack");
  return check.ok ? null : check.reason;
}

/** Carry entered reasons over to a fresh snapshot: keep those whose key still exists, report the rest. */
export function reconcileAckState(prev: AckState, prevRequired: readonly SnapshotRequiredAck[], nextRequired: readonly SnapshotRequiredAck[]): { state: AckState; dropped: string[]; added: string[] } {
  const nextKeys = new Set(nextRequired.map((r) => r.key));
  const reasons: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(prev.reasons)) {
    if (!v.trim()) continue;
    if (nextKeys.has(k)) reasons[k] = v; else dropped.push(k);
  }
  const procs = new Set(unassessedProcedures(nextRequired));
  const shared: Record<string, boolean> = {};
  for (const [p, on] of Object.entries(prev.shared)) if (on && procs.has(p)) shared[p] = true;
  // A shared reason is stored under the lead key; if the lead changed, move it.
  for (const p of Object.keys(shared)) {
    const oldLead = groupLead(prevRequired, p);
    const newLead = groupLead(nextRequired, p);
    if (oldLead && newLead && oldLead !== newLead && prev.reasons[oldLead]?.trim() && !reasons[newLead]) reasons[newLead] = prev.reasons[oldLead];
  }
  const prevKeys = new Set(prevRequired.map((r) => r.key));
  const added = nextRequired.map((r) => r.key).filter((k) => !prevKeys.has(k));
  return { state: { reasons, shared }, dropped, added };
}

/** Split a server error `details` into per-key problems for inline display. */
export interface AckProblems { missing: string[]; unknown: string[]; invalid: Array<{ key: string; problem: string }>; weak: Array<{ key: string; reason: string }> }
export function ackProblemsFromError(code: string, details: unknown): AckProblems {
  const d = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const out: AckProblems = { missing: [], unknown: [], invalid: [], weak: [] };
  if (code === "ack_required") {
    out.missing = strs(d.missing);
    out.unknown = strs(d.unknown);
    if (Array.isArray(d.invalid)) out.invalid = (d.invalid as Array<Record<string, unknown>>).filter((x) => typeof x?.key === "string").map((x) => ({ key: String(x.key), problem: String(x.problem ?? "") }));
  } else if (code === "rationale_insufficient" && d.field === "acknowledgements" && Array.isArray(d.items)) {
    out.weak = (d.items as Array<Record<string, unknown>>).filter((x) => typeof x?.key === "string").map((x) => ({ key: String(x.key), reason: String(x.reason ?? "") }));
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
