// S6 bulk AI evaluation (ADR-0199) — client-side types and pure helpers shared by the progress panel, chips,
// version history. UI-only: shapes mirror the A2/A5/A8 route responses (ADR-0200: no confirm route any more).

export type DraftCategory = "financial" | "technical";
export type ProposedStatus = "pass" | "partial" | "fail" | null;

/** A8 — `eval_draft.<category>` on each targets row: version HISTORY only (ADR-0200 §8). Scores live in `eval_summary`. */
export interface VersionChip {
  version_no: number;
  checked_at: string;
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

/** Per-state item counts of a run (A2 `counts`; design 2026-11-17 §10.8). */
export interface RunItemCounts {
  done: number;
  running: number;
  queued: number;
  skipped: number;
  failed: number;
  cancelled: number;
  total: number;
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
  /** Queue model (ADR-0200 part B); absent on older payloads, in which case it is derived from `items`. */
  counts?: RunItemCounts;
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
  /** Non-human verdicts resting on this version (applied) and human verdicts resting on it (reviewed) — ADR-0200 A5. */
  applied_count: number;
  reviewed_count: number;
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
  "queue_full",
  "item_running",
  "item_finished",
  "not_selected",
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
