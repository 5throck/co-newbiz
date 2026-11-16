// S6 bulk AI evaluation (ADR-0199) — client-side types and pure helpers shared by the progress panel, chips,
// version comparison and confirm dialog. UI-only: shapes mirror the A2/A5/A6/A8 route responses.

export type DraftCategory = "financial" | "technical";
export type ProposedStatus = "pass" | "partial" | "fail" | null;

/** A8 — `eval_draft.<category>` on each targets row. */
export interface VersionChip {
  version_no: number;
  created_at: string;
  checked_at: string;
  provisional_score: number | null;
  /** Optional: absent on responses from before the counts were exposed. */
  proposed_count?: number;
  unverified_count?: number;
  stale: boolean;
  evidence_grade: string;
}

export interface EvalDraftView {
  financial?: VersionChip;
  technical?: VersionChip;
  run_item?: { run_id: string; state: string; error: string | null };
}

export type RunStatus = "running" | "paused_budget" | "interrupted" | "completed" | "cancelled" | "failed";

export interface RunItemView {
  id: string;
  brownfield_target_id: string;
  company_name: string | null;
  seq: number;
  state: string;
  financial_outcome: string | null;
  technical_outcome: string | null;
  error_message: string | null;
}

/** A2 — latest run header + items (`run: null` when the opportunity never ran). */
export interface RunProgressView {
  run: {
    id: string;
    status: RunStatus;
    total_targets: number;
    pause_reason: string | null;
    error_message: string | null;
    web_evidence: 0 | 1;
    force_refresh: 0 | 1;
    /** UTC start of the run (run header column); drives the elapsed-time line. */
    started_at?: string;
  } | null;
  items: RunItemView[];
  progress: { done: number; total: number };
  budget: { calls: number; budget: number; reserve: number };
}

export interface DraftPayloadItem {
  criterion_id: string;
  proposed_status: ProposedStatus;
  note?: string | null;
  reason_detail?: string | null;
}
export interface DraftPayload {
  criteria_snapshot: Array<{ criterion_id: string; label: string; rubric?: Record<string, unknown> | null }>;
  items: DraftPayloadItem[];
  human_items: Array<{ criterion_id: string; status: string }>;
}

/** A5 — one version row, with its payload when `include=payload` was requested. */
export interface VersionRow {
  id: string;
  category: DraftCategory;
  version_no: number;
  provisional_score: number | null;
  proposed_count: number;
  unverified_count: number;
  evidence_grade: string;
  created_at: string;
  confirmed_count: number;
  payload?: DraftPayload;
}

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ["running", "paused_budget", "interrupted"];
export const isRunActive = (s: RunStatus | undefined): boolean => s !== undefined && ACTIVE_RUN_STATUSES.includes(s);

/** Fixed error / pause / skip codes the API can put on a run item or run (see brownfield-eval-bulk.ts). */
export const KNOWN_ITEM_CODES = [
  "dart_error",
  "llm_error",
  "parse_error",
  "db_error",
  "payload_too_large",
  "unknown",
] as const;
export const KNOWN_PAUSE_REASONS = ["dart_budget_reserve", "dart_budget_exhausted", "dart_status_020"] as const;
export const KNOWN_CALL_ERRORS = [
  "engine_active",
  "engine_active_bulk_block",
  "engine_active_concurrency_cap",
  "already_promoted",
  "start_cooldown",
  "budget_reserve",
  "not_resumable",
  "no_candidates",
  "stale_version",
  "human_only",
] as const;

/** Maps an arbitrary server code onto a catalog key; anything unrecognised folds into `unknown`. */
export function knownCode<T extends string>(code: string | null | undefined, list: readonly T[], fallback: T): T {
  return code && (list as readonly string[]).includes(code) ? (code as T) : fallback;
}

export type CellKind = "proposal" | "human" | "unverified" | "absent";
export interface CompareCell {
  kind: CellKind;
  status: string | null;
  changed: boolean;
  /** Fixed reason code of an unverified technical item (payload reason_detail), when recorded. */
  reasonDetail?: string | null;
}
export interface CompareRow {
  criterion_id: string;
  label: string;
  cells: CompareCell[];
}
export interface CompareScore {
  version_no: number;
  score: number | null;
  delta: number | null;
}

function cellOf(v: VersionRow, criterionId: string): Omit<CompareCell, "changed"> {
  const p = v.payload;
  if (!p) return { kind: "absent", status: null };
  const human = p.human_items.find((h) => h.criterion_id === criterionId);
  if (human) return { kind: "human", status: human.status };
  const item = p.items.find((i) => i.criterion_id === criterionId);
  if (!item) return { kind: "absent", status: null };
  return item.proposed_status === null
    ? { kind: "unverified", status: null, reasonDetail: item.reason_detail ?? null }
    : { kind: "proposal", status: item.proposed_status };
}

/**
 * Comparison table model. `versions` is newest first (A5 order); at most `max` columns. A cell is `changed` when the
 * next-older column in the table holds a different state for the same criterion (the oldest column is never marked).
 */
export function buildComparison(
  versions: VersionRow[],
  max = 5,
): { columns: VersionRow[]; rows: CompareRow[]; scores: CompareScore[] } {
  const columns = versions.slice(0, max);
  const labels = new Map<string, string>();
  const order: string[] = [];
  for (const v of columns) {
    for (const c of v.payload?.criteria_snapshot ?? []) {
      if (!labels.has(c.criterion_id)) {
        labels.set(c.criterion_id, c.label);
        order.push(c.criterion_id);
      }
    }
  }
  const rows = order.map((id) => {
    const raw = columns.map((v) => cellOf(v, id));
    const cells = raw.map((c, i) => {
      const older = raw[i + 1];
      const changed = older !== undefined && (older.kind !== c.kind || older.status !== c.status);
      return { ...c, changed };
    });
    return { criterion_id: id, label: labels.get(id) ?? id, cells };
  });
  const scores = columns.map((v, i) => {
    const older = columns[i + 1];
    const delta =
      older && v.provisional_score !== null && older.provisional_score !== null
        ? v.provisional_score - older.provisional_score
        : null;
    return { version_no: v.version_no, score: v.provisional_score, delta };
  });
  return { columns, rows, scores };
}

export interface ConfirmPlan {
  write: Array<{ criterion_id: string; label: string; status: Exclude<ProposedStatus, null> }>;
  skippedHuman: Array<{ criterion_id: string; label: string }>;
  skippedUnverified: Array<{ criterion_id: string; label: string }>;
}

/** Items the confirm route will write vs skip, as known from the version payload (the server re-checks at confirm). */
export function buildConfirmPlan(payload: DraftPayload): ConfirmPlan {
  const label = (id: string) => payload.criteria_snapshot.find((c) => c.criterion_id === id)?.label ?? id;
  const human = new Set(payload.human_items.map((h) => h.criterion_id));
  const plan: ConfirmPlan = { write: [], skippedHuman: [], skippedUnverified: [] };
  for (const h of payload.human_items)
    plan.skippedHuman.push({ criterion_id: h.criterion_id, label: label(h.criterion_id) });
  for (const i of payload.items) {
    if (human.has(i.criterion_id)) continue;
    if (i.proposed_status === null)
      plan.skippedUnverified.push({ criterion_id: i.criterion_id, label: label(i.criterion_id) });
    else plan.write.push({ criterion_id: i.criterion_id, label: label(i.criterion_id), status: i.proposed_status });
  }
  return plan;
}
