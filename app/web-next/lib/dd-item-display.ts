// S9 item display state (UX round 2, R2-B item 5).
// "판정 대기" is the default for items that have NO judgement row (new items: an approved custom
// item, a freshly applied sub-track checklist). An item that already has a stored judgement is
// shown exactly as stored - existing judgements are grandfathered (risk-officer dissent): nothing
// here, and no migration, rewrites or re-opens a judged item, so no in-flight project regresses at S9.

export interface StoredItemState {
  status: string;
  note?: string | null;
  evidence_ref?: string | null;
  waiver_id?: string | null;
  assessed_by?: string | null;
  assessed_at?: string | null;
}

export interface ItemDisplay {
  status: string;
  /** true when a person recorded this judgement; false = default state, never judged. */
  judged: boolean;
  /** "who, when" for judged items (absent for the default state). */
  byline: string | null;
}

export function ddItemDisplay(state: StoredItemState | null | undefined): ItemDisplay {
  if (!state) return { status: "pending", judged: false, byline: null };
  const judged = state.status !== "pending";
  const byline = judged && state.assessed_by ? `${state.assessed_by}${state.assessed_at ? ` · ${state.assessed_at.slice(0, 10)}` : ""}` : null;
  return { status: state.status, judged, byline };
}

export type ItemFilter = "all" | "pending" | "fail";

export function matchesFilter(filter: ItemFilter, display: ItemDisplay): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return !display.judged;
  return display.status === "fail";
}
