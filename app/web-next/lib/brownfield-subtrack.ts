// brownfield-subtrack — S9 workspace scope per brownfield sub-track (ADR-0162,
// design 2026-10-12-brownfield-dd-workspace-scope-by-subtrack). Sibling of
// greenfield-subtrack.ts (ADR-0160 addendum b), same mechanism, separate file:
//   - overlay loader for checklists/_overlays/brownfield-workspace-scope.yaml
//     (embedded in the library projection as LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY).
//     Fail-closed: a missing overlay, item or unapproved row means "apply as-is" (A);
//   - per-item scope A/R/X/N of the seven ADR-0148 workspace checklists, and the
//     section scoping of the attached extra checklists (`extra_checklists`);
//   - the cut-off BF_WORKSPACE_SCOPE_DATE with grandfathering and the human-only
//     opt-in (recorded pin migration + audited migration_note);
//   - a read-only in-flight count helper (policy impact, counts only).
// m_and_a is the baseline (every row A, extras unchanged): it never enters the
// scoped path, so its selection, payload and counts stay byte-identical. A null
// or unknown sub-track never enters it either. Which extra checklists attach is
// unchanged (SUB_TRACK_DD_CHECKLISTS + the WAVE_F_PREDICATE_DATE rule), except that the
// scoped path adds BF_SCOPED_EXTRA_ADDITIONS (DEC-20261013-03: ma-01..03, min-05).
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { SUB_TRACK_NONE } from "../../../db/lib/applies-when.ts";
import { DD_WORKSPACE_CHECKLISTS, SUB_TRACK_DD_CHECKLISTS, scopedSubTrackDdChecklists, getBrownfieldWorkspaceOverlay, getChecklistItems, type ChecklistItemDef } from "./library.ts";
import { BF_WORKSPACE_SCOPE_DATE, WAVE_F_PREDICATE_DATE } from "./wave-f-date.ts";
import { currentRoute, hasValidDdGateDecision, previousScopeEntries, type PreviousScopeEntry, type ReplacementPointer, type WorkspaceItemScope } from "./greenfield-subtrack.ts";

export const BROWNFIELD_SUB_TRACKS = [
  "m_and_a",
  "jv",
  "strategic_investment",
  "minority_investment",
  "partnership",
  "rbd",
  "corporate_venture",
] as const;
export type BrownfieldSubTrack = (typeof BROWNFIELD_SUB_TRACKS)[number];
/** The baseline column: all A, extras unchanged — never routed through the scoped path. */
export const BF_BASELINE_SUB_TRACK: BrownfieldSubTrack = "m_and_a";
export type BrownfieldScopeKey = Exclude<BrownfieldSubTrack, "m_and_a">;

/** Governance doc id the recorded opt-in pins (policy impact rule 9). */
export const BF_WS_POLICY_DOC_ID = "ovl-brownfield-workspace-scope";

const WORKSPACE_IDS: readonly string[] = Object.values(DD_WORKSPACE_CHECKLISTS);
const CODES: readonly string[] = ["A", "R", "X", "N"];

export function isBrownfieldSubTrack(v: string | null): v is BrownfieldSubTrack {
  return v !== null && (BROWNFIELD_SUB_TRACKS as readonly string[]).includes(v);
}

// ── Overlay parsing (defensive) ────────────────────────────────────────────

interface BfCell {
  code: "A" | "R" | "X" | "N";
  reading?: string;
  na_reason?: string;
  note?: string;
  replaced_by: Array<{ checklist: string; item: string; stage: string }>;
}
interface BfRow {
  cells: Partial<Record<BrownfieldSubTrack, BfCell>>;
  approved: boolean;
}
interface BfExtra {
  attached_to: string[];
  approved: boolean;
  /** Per sub-track: excluded item id -> { section, reason }. */
  excluded: Partial<Record<BrownfieldSubTrack, Map<string, { section: string | null; na_reason: string | null }>>>;
  /** Per sub-track: item id -> R reading (ADR-0162 addendum 2026-10-13). */
  readings: Partial<Record<BrownfieldSubTrack, Map<string, string>>>;
}
export interface BrownfieldOverlay {
  governance_doc_id: string;
  version: string;
  rows: Map<string, Map<string, BfRow>>;
  extras: Map<string, BfExtra>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isApproved = (a: Record<string, unknown>) => a.status === "approved" && !!str(a.approved_by) && !!str(a.approved_at);

/** Normalise the raw projection; null when absent or unusable (fail-closed to A everywhere). */
export function parseBrownfieldOverlay(raw: unknown): BrownfieldOverlay | null {
  const doc = obj(raw);
  const id = str(doc.governance_doc_id);
  const version = str(doc.version);
  if (id !== BF_WS_POLICY_DOC_ID || !version || doc.track !== "brownfield") return null;
  const rows = new Map<string, Map<string, BfRow>>();
  for (const [checklistId, block] of Object.entries(obj(doc.checklists))) {
    const byItem = new Map<string, BfRow>();
    for (const r of arr(obj(block).items)) {
      const ro = obj(r);
      const itemId = str(ro.id);
      if (!itemId) continue;
      const cells: BfRow["cells"] = {};
      for (const key of BROWNFIELD_SUB_TRACKS) {
        const c = obj(obj(ro.sub_tracks)[key]);
        const code = str(c.code);
        if (!code || !CODES.includes(code)) continue; // C or garbage: ignored -> A
        cells[key] = {
          code: code as BfCell["code"],
          reading: str(c.reading),
          na_reason: str(c.na_reason),
          note: str(c.note),
          replaced_by: arr(c.replaced_by)
            .map((p) => obj(p))
            .filter((p) => str(p.checklist) && str(p.item))
            .map((p) => ({ checklist: p.checklist as string, item: p.item as string, stage: str(p.stage) ?? "" })),
        };
      }
      byItem.set(itemId, { cells, approved: isApproved(obj(ro.approval)) });
    }
    rows.set(checklistId, byItem);
  }
  const extras = new Map<string, BfExtra>();
  for (const [checklistId, block] of Object.entries(obj(doc.extra_checklists))) {
    const b = obj(block);
    const excluded: BfExtra["excluded"] = {};
    const readings: BfExtra["readings"] = {};
    for (const key of BROWNFIELD_SUB_TRACKS) {
      const rm = new Map<string, string>();
      for (const g of arr(obj(obj(b.sub_tracks)[key]).readings)) {
        const go = obj(g);
        const reading = str(go.reading);
        if (reading) for (const itemId of arr(go.ids)) if (typeof itemId === "string") rm.set(itemId, reading);
      }
      readings[key] = rm;
      const m = new Map<string, { section: string | null; na_reason: string | null }>();
      for (const g of arr(obj(obj(b.sub_tracks)[key]).excluded)) {
        const go = obj(g);
        for (const itemId of arr(go.ids)) if (typeof itemId === "string") m.set(itemId, { section: str(go.section) ?? null, na_reason: str(go.na_reason) ?? null });
      }
      excluded[key] = m;
    }
    extras.set(checklistId, {
      attached_to: arr(b.attached_to).filter((x): x is string => typeof x === "string"),
      approved: isApproved(obj(b.approval)),
      excluded,
      readings,
    });
  }
  return { governance_doc_id: id, version, rows, extras };
}

let OVERLAY_CACHE: { value: BrownfieldOverlay | null } | null = null;
/** The brownfield overlay, read once from the projection and cached. */
export function brownfieldOverlay(): BrownfieldOverlay | null {
  if (!OVERLAY_CACHE) OVERLAY_CACHE = { value: parseBrownfieldOverlay(getBrownfieldWorkspaceOverlay()) };
  return OVERLAY_CACHE.value;
}
/** Test seam: replace (raw document) or reset (undefined) the cached overlay. */
export function setBrownfieldOverlayForTest(raw?: unknown): void {
  OVERLAY_CACHE = raw === undefined ? null : { value: parseBrownfieldOverlay(raw) };
}

// ── Cut-off, opt-in, attached extras ───────────────────────────────────────

/** Live opt-in pin (any overlay version — a later version bump never reverts an opt-in). */
export function hasBrownfieldScopeOptIn(projectId: string, db: Database = getDb()): boolean {
  return !!db
    .query("SELECT id FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ? AND superseded_by IS NULL")
    .get(projectId, BF_WS_POLICY_DOC_ID);
}

/** Earliest policy pin or creation, ignoring the opt-in pin itself (an opt-in never re-dates a project). */
function earliestPinOrCreation(projectId: string, db: Database): string | null {
  const proj = db.query("SELECT created_at FROM md_project WHERE id = ?").get(projectId) as { created_at: string | null } | undefined;
  if (!proj) return null;
  const pin = db
    .query("SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ? AND policy_doc_id != ?")
    .get(projectId, BF_WS_POLICY_DOC_ID) as { at: string | null };
  const created = proj.created_at ?? "";
  if (pin.at === null) return created;
  return pin.at < created ? pin.at : created;
}

/** True when the project is past BF_WORKSPACE_SCOPE_DATE by its earliest pin / creation. */
export function brownfieldScopeByDate(projectId: string, db: Database = getDb()): boolean {
  const at = earliestPinOrCreation(projectId, db);
  if (at === null || at < BF_WORKSPACE_SCOPE_DATE) return false;
  // DEC-20261013-05: a project with a valid recorded dd gate decision keeps the view it was decided on.
  return !hasValidDdGateDecision(projectId, db);
}

/**
 * Extra checklists attached to a brownfield project — the same rule as
 * dd-checklist-tailor.subTrackChecklistIds' brownfield branch (unchanged by this
 * design; a unit test keeps the two equal): none before WAVE_F_PREDICATE_DATE unless
 * the project is on the scoped path (opt-in or past BF_WORKSPACE_SCOPE_DATE).
 */
export function brownfieldAttachedExtras(projectId: string, subTrack: string | null, db: Database = getDb()): string[] {
  if (!subTrack) return [];
  // User decision 2026-10-12: a recorded opt-in (non-baseline sub-track) attaches the
  // sub-track extras, scoped by the overlay, even before WAVE_F_PREDICATE_DATE.
  // DEC-20261013-03: the scoped path (opt-in or past BF_WORKSPACE_SCOPE_DATE) also attaches
  // BF_SCOPED_EXTRA_ADDITIONS (merger-control / FDI items), scoped down by the overlay.
  // DEC-20261013-04: in scope by date (cut-off 2026-07-01, before WAVE_F_PREDICATE_DATE)
  // is the same scoped path as an opt-in, so it is checked ahead of the WAVE_F rule.
  if (
    subTrack !== BF_BASELINE_SUB_TRACK &&
    isBrownfieldSubTrack(subTrack) &&
    (hasBrownfieldScopeOptIn(projectId, db) || brownfieldScopeByDate(projectId, db))
  ) {
    return scopedSubTrackDdChecklists(subTrack);
  }
  const proj = db.query("SELECT created_at FROM md_project WHERE id = ?").get(projectId) as { created_at: string | null } | undefined;
  if (!proj) return [];
  const pin = db
    .query("SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ? AND policy_doc_id != ?")
    .get(projectId, BF_WS_POLICY_DOC_ID) as { at: string | null };
  if ((pin.at ?? proj.created_at ?? "") < WAVE_F_PREDICATE_DATE) return [];
  return SUB_TRACK_DD_CHECKLISTS[subTrack] ?? [];
}

export interface BrownfieldRouteInfo {
  sub_track: string | null;
  /** Overlay column when the scoped path can apply; null for m_and_a (baseline), null or unknown sub-track. */
  scope_key: BrownfieldScopeKey | null;
  by_date: boolean;
  opted_in: boolean;
}

export function brownfieldRouteInfo(projectId: string, db: Database = getDb()): BrownfieldRouteInfo | null {
  const route = currentRoute(projectId, db);
  if (!route || route.track !== "brownfield") return null;
  const st = route.sub_track;
  return {
    sub_track: st,
    scope_key: isBrownfieldSubTrack(st) && st !== BF_BASELINE_SUB_TRACK ? (st as BrownfieldScopeKey) : null,
    by_date: brownfieldScopeByDate(projectId, db),
    opted_in: hasBrownfieldScopeOptIn(projectId, db),
  };
}

// ── Item resolution ────────────────────────────────────────────────────────

type StateLite = { status: string; assessed_by: string | null; assessed_at: string | null; waiver_id: string | null };

function stateMap(projectId: string, db: Database): Map<string, StateLite> {
  const m = new Map<string, StateLite>();
  for (const r of db
    .query("SELECT checklist_id, item_id, status, assessed_by, assessed_at, waiver_id FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL")
    .all(projectId) as Array<StateLite & { checklist_id: string; item_id: string }>) {
    m.set(`${r.checklist_id}:${r.item_id}`, r);
  }
  return m;
}

const asIs = (checklistId: string, itemId: string, fallback: WorkspaceItemScope["fallback"]): WorkspaceItemScope => ({
  checklist_id: checklistId, item_id: itemId, overlay_code: null, code: "A", judgeable: true, reading: null, reason: null, note: null,
  replaced_by: [], fallback, rule: "fail_closed", steps: [],
});

function resolveWorkspaceItem(
  ov: BrownfieldOverlay,
  key: BrownfieldScopeKey,
  checklistId: string,
  itemId: string,
  s9Set: Set<string>,
  states: Map<string, StateLite>,
): WorkspaceItemScope {
  const row = ov.rows.get(checklistId)?.get(itemId);
  const cell = row?.cells[key];
  if (!row || !cell) return asIs(checklistId, itemId, "missing_from_overlay");
  if (!row.approved) return asIs(checklistId, itemId, "unapproved");
  // Binding items (fin-09) are never N or X (validator rule); a file saying otherwise applies as-is.
  const def = getChecklistItems(checklistId)?.find((i) => i.id === itemId);
  if (def?.mandatory && !def.waiver_eligible && (cell.code === "N" || cell.code === "X")) return asIs(checklistId, itemId, "missing_from_overlay");
  const common = {
    checklist_id: checklistId, item_id: itemId, overlay_code: cell.code, reading: cell.reading ?? null, note: cell.note ?? null,
    replaced_by: [] as ReplacementPointer[], fallback: null, rule: "overlay" as const, steps: [] as number[],
  };
  if (cell.code === "A" || cell.code === "R") return { ...common, code: cell.code, judgeable: true, reason: null };
  if (cell.code === "N") return { ...common, code: "N", judgeable: false, reason: cell.na_reason ?? null };
  // X: same fail-closed rule as greenfield — a target outside this project's S9 set
  // (extra not attached) or an unjudged earlier-stage target makes the item judgeable again.
  const pointers: ReplacementPointer[] = cell.replaced_by.map((p) => {
    const st = states.get(`${p.checklist}:${p.item}`);
    return {
      checklist_id: p.checklist, item_id: p.item, stage: p.stage, in_s9: s9Set.has(p.checklist),
      status: st?.status ?? null, judged: st?.status === "pass" || st?.status === "fail", assessed_by: st?.assessed_by ?? null, assessed_at: st?.assessed_at ?? null,
    };
  });
  const internalMissing = cell.replaced_by.some((p) => p.stage.startsWith("S9") && !s9Set.has(p.checklist));
  // Only a pass/fail judgement on every target (in-S9 or earlier-stage) holds the X.
  const anyUndecided = pointers.some((p) => !p.judged);
  if (pointers.length === 0 || internalMissing || anyUndecided) {
    return { ...common, code: "A", judgeable: true, reason: null, replaced_by: pointers, fallback: "replacement_not_judged" };
  }
  return { ...common, code: "X", judgeable: false, reason: cell.note ?? null, replaced_by: pointers };
}

function resolveExtraItem(ov: BrownfieldOverlay, key: BrownfieldScopeKey, checklistId: string, itemId: string, items: ChecklistItemDef[]): WorkspaceItemScope {
  const ex = ov.extras.get(checklistId);
  if (!ex) return asIs(checklistId, itemId, "missing_from_overlay");
  if (!ex.approved) return asIs(checklistId, itemId, "unapproved");
  const hit = ex.excluded[key]?.get(itemId);
  const def = items.find((i) => i.id === itemId);
  // Binding items (mandatory, not waivable — bf-01..03) can never be excluded, whatever the file says.
  if (!hit || (def?.mandatory && !def.waiver_eligible)) {
    // R reading on an extra item (never on a binding item, whatever the file says).
    const reading = def?.mandatory && !def.waiver_eligible ? undefined : ex.readings[key]?.get(itemId);
    if (!hit && reading) {
      return { checklist_id: checklistId, item_id: itemId, overlay_code: "R", code: "R", judgeable: true, reading, reason: null, note: null, replaced_by: [], fallback: null, rule: "overlay", steps: [] };
    }
    return { checklist_id: checklistId, item_id: itemId, overlay_code: "A", code: "A", judgeable: true, reading: null, reason: null, note: null, replaced_by: [], fallback: null, rule: "overlay", steps: [] };
  }
  return {
    checklist_id: checklistId, item_id: itemId, overlay_code: "N", code: "N", judgeable: false, reading: null, reason: hit.na_reason,
    note: hit.section ? `section:${hit.section}` : null, replaced_by: [], fallback: null, rule: "overlay", steps: [],
  };
}

export interface BrownfieldScopeContext {
  sub_track: BrownfieldScopeKey;
  key: BrownfieldScopeKey;
  overlay_version: string;
  /** Attached extra checklists (unchanged attach rule). */
  extra_checklists: string[];
  /** Workspace items AND attached-extra items, key `<checklist_id>:<item_id>`. */
  items: Map<string, WorkspaceItemScope>;
  states: Map<string, StateLite>;
  opted_in: boolean;
}

function buildContext(projectId: string, key: BrownfieldScopeKey, ov: BrownfieldOverlay, optedIn: boolean, db: Database, assumeOptIn = false): BrownfieldScopeContext {
  const states = stateMap(projectId, db);
  // Preview of a not-yet-recorded opt-in: the opt-in attaches the sub-track extras.
  const extras = assumeOptIn ? scopedSubTrackDdChecklists(key) : brownfieldAttachedExtras(projectId, key, db);
  const s9Set = new Set([...WORKSPACE_IDS, ...extras]);
  const items = new Map<string, WorkspaceItemScope>();
  for (const c of WORKSPACE_IDS) for (const i of getChecklistItems(c) ?? []) items.set(`${c}:${i.id}`, resolveWorkspaceItem(ov, key, c, i.id, s9Set, states));
  for (const c of extras) {
    const defs = getChecklistItems(c) ?? [];
    for (const i of defs) items.set(`${c}:${i.id}`, resolveExtraItem(ov, key, c, i.id, defs));
  }
  return { sub_track: key, key, overlay_version: ov.version, extra_checklists: [...extras], items, states, opted_in: optedIn };
}

/** Scope for an in-scope brownfield project (non-baseline sub-track, past the cut-off or opted in); else null. */
export function brownfieldScopeContext(projectId: string, db: Database = getDb()): BrownfieldScopeContext | null {
  const info = brownfieldRouteInfo(projectId, db);
  const ov = brownfieldOverlay();
  if (!info?.scope_key || !ov) return null;
  if (!info.by_date && !info.opted_in) return null;
  return buildContext(projectId, info.scope_key, ov, info.opted_in, db);
}

/** The same resolution as if the project were in scope (opt-in preview); null when no scoped path can apply. */
export function hypotheticalBrownfieldScope(projectId: string, db: Database = getDb()): BrownfieldScopeContext | null {
  const info = brownfieldRouteInfo(projectId, db);
  const ov = brownfieldOverlay();
  if (!info?.scope_key || !ov) return null;
  return buildContext(projectId, info.scope_key, ov, info.opted_in, db, !info.opted_in);
}

/** Judgeable items of one attached extra checklist under the scope (section-scoped). */
export function brownfieldExtraItems(ctx: BrownfieldScopeContext, checklistId: string): ChecklistItemDef[] {
  return (getChecklistItems(checklistId) ?? []).filter((i) => ctx.items.get(`${checklistId}:${i.id}`)?.judgeable !== false);
}

/** Scope of one item, or null when the brownfield scope does not apply to the project/checklist. */
export function brownfieldItemScope(projectId: string, checklistId: string, itemId: string, db: Database = getDb()): WorkspaceItemScope | null {
  return brownfieldScopeContext(projectId, db)?.items.get(`${checklistId}:${itemId}`) ?? null;
}

/** Design §10: an `na` on a workspace or scoped extra checklist of an in-scope brownfield project needs a reason. */
export function brownfieldNaRequiresReason(projectId: string, checklistId: string, db: Database = getDb()): boolean {
  const ctx = brownfieldScopeContext(projectId, db);
  if (!ctx) return false;
  return WORKSPACE_IDS.includes(checklistId) || ctx.extra_checklists.includes(checklistId);
}

/** Judgements on items now N/X — kept, listed as "judged under previous scope". */
export function brownfieldPreviousScope(ctx: BrownfieldScopeContext): PreviousScopeEntry[] {
  return previousScopeEntries(ctx.items, ctx.states);
}

// ── Static per-sub-track counts (design §5 / §7) — project-independent ─────

export interface BrownfieldScopeCounts {
  A: number;
  R: number;
  X: number;
  N: number;
  /** A + R of the seven workspace checklists (X counted as excluded; see note in the design). */
  workspace_judgeable: number;
  extras_judgeable: number;
  total_judgeable: number;
}

/**
 * Counts per sub-track straight from the overlay, as for a project with every
 * extra attached and every X replacement in place (the design's Y). m_and_a is
 * computed as all A with unscoped extras (baseline).
 */
export function brownfieldScopeCounts(subTrack: BrownfieldSubTrack, ov: BrownfieldOverlay | null = brownfieldOverlay()): BrownfieldScopeCounts {
  const out: BrownfieldScopeCounts = { A: 0, R: 0, X: 0, N: 0, workspace_judgeable: 0, extras_judgeable: 0, total_judgeable: 0 };
  for (const c of WORKSPACE_IDS) {
    for (const i of getChecklistItems(c) ?? []) {
      const row = ov?.rows.get(c)?.get(i.id);
      const cell = subTrack === BF_BASELINE_SUB_TRACK || !row?.approved ? undefined : row.cells[subTrack];
      out[cell?.code ?? "A"] += 1;
    }
  }
  out.workspace_judgeable = out.A + out.R;
  for (const c of subTrack === BF_BASELINE_SUB_TRACK ? SUB_TRACK_DD_CHECKLISTS[subTrack] ?? [] : scopedSubTrackDdChecklists(subTrack)) {
    const defs = getChecklistItems(c) ?? [];
    for (const i of defs) {
      if (subTrack === BF_BASELINE_SUB_TRACK || !ov) { out.extras_judgeable += 1; continue; }
      if (resolveExtraItem(ov, subTrack as BrownfieldScopeKey, c, i.id, defs).judgeable) out.extras_judgeable += 1;
    }
  }
  out.total_judgeable = out.workspace_judgeable + out.extras_judgeable;
  return out;
}

// ── Human-only opt-in (route enforces cookie + CSRF + human principal) ─────

export type BrownfieldScopeErrorCode = "invalid_request" | "not_brownfield" | "no_scope_change" | "already_opted_in" | "overlay_unavailable";
export type BrownfieldScopeResult<T> = ({ ok: true } & T) | { ok: false; code: BrownfieldScopeErrorCode; message: string };
const err = (code: BrownfieldScopeErrorCode, message: string) => ({ ok: false as const, code, message });

/**
 * Recorded workspace-scope opt-in (design §9.3): pins the brownfield overlay
 * version with an audited migration_note. Never touches checklist item state.
 */
export function optInBrownfieldWorkspaceScope(
  input: { projectId: string; migrationNote: unknown; actor: string; now?: string },
  db: Database = getDb(),
): BrownfieldScopeResult<{ pin_id: string }> {
  const note = typeof input.migrationNote === "string" ? input.migrationNote.trim() : "";
  if (!note) return err("invalid_request", "migration_note가 필요합니다.");
  const ov = brownfieldOverlay();
  if (!ov) return err("overlay_unavailable", "작업 범위 오버레이를 읽을 수 없습니다 — 기존 화면을 유지합니다.");
  const info = brownfieldRouteInfo(input.projectId, db);
  if (!info) return err("not_brownfield", "작업 범위 전환은 brownfield 경로 프로젝트에만 적용합니다.");
  if (!info.scope_key) {
    return err("no_scope_change", "이 세부 유형(인수합병 기준 열 또는 세부 유형 없음)은 작업 범위가 바뀌지 않습니다 — 전환할 것이 없습니다.");
  }
  if (info.by_date || info.opted_in) return err("already_opted_in", "이미 새 작업 범위가 적용된 프로젝트입니다.");
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  // The already_opted_in re-check and the pin writes share one IMMEDIATE transaction.
  const raced = db.transaction(() => {
    if (brownfieldRouteInfo(input.projectId, db)?.opted_in) return true;
    const live = db
      .query("SELECT id FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ? AND superseded_by IS NULL")
      .get(input.projectId, BF_WS_POLICY_DOC_ID) as { id: string } | undefined;
    db.run(
      "INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by) VALUES (?,?,?,?,?,?,?)",
      [id, input.projectId, BF_WS_POLICY_DOC_ID, ov.version, now, input.actor, live?.id ?? null],
    );
    if (live) {
      db.run("UPDATE project_policy_pin SET superseded_by = ? WHERE id = ?", [id, live.id]);
      db.run("UPDATE project_policy_pin SET superseded_by = NULL WHERE id = ?", [id]);
    }
    appendAudit(db, {
      actor: input.actor,
      action: "policy_pin_migrated",
      target: `${input.projectId}:${BF_WS_POLICY_DOC_ID}:${ov.version} migration_note=${note.slice(0, 500)}`,
      now,
    });
    return false;
  }).immediate();
  if (raced) return err("already_opted_in", "이미 새 작업 범위가 적용된 프로젝트입니다.");
  return { ok: true, pin_id: id };
}

// ── Read-only policy-impact helper (design §2 / §9) — counts only ──────────

export interface InFlightBrownfieldProject {
  project_no: string | null;
  sub_track: string;
  grandfathered: boolean;
  opted_in: boolean;
  /** S9 state rows on the gate scope (target_id NULL). */
  s9_rows: number;
  /** Rows that an opt-in would list under "judged under previous scope". */
  would_move: number;
  /** Of those, recorded fails without a waiver (stay unmet). */
  fails_stay_unmet: number;
}
export interface InFlightBrownfieldCounts {
  total: number;
  by_sub_track: Record<string, number>;
  grandfathered: number;
  opted_in: number;
  projects: InFlightBrownfieldProject[];
}

export function inFlightBrownfieldCounts(db: Database = getDb()): InFlightBrownfieldCounts {
  const rows = db
    .query(
      `SELECT m.id AS id, m.project_no AS project_no, r.sub_track AS sub_track
         FROM route_decision r JOIN md_project m ON m.source_opportunity_id = r.opportunity_id
        WHERE r.track = 'brownfield' AND r.is_current = 1
        ORDER BY m.created_at, m.id`,
    )
    .all() as { id: string; project_no: string | null; sub_track: string | null }[];
  const out: InFlightBrownfieldCounts = { total: rows.length, by_sub_track: {}, grandfathered: 0, opted_in: 0, projects: [] };
  for (const r of rows) {
    const key = r.sub_track ?? SUB_TRACK_NONE;
    out.by_sub_track[key] = (out.by_sub_track[key] ?? 0) + 1;
    const byDate = brownfieldScopeByDate(r.id, db);
    const optedIn = hasBrownfieldScopeOptIn(r.id, db);
    if (!byDate) out.grandfathered += 1;
    if (optedIn) out.opted_in += 1;
    const hyp = hypotheticalBrownfieldScope(r.id, db);
    const moved = hyp ? brownfieldPreviousScope(hyp) : [];
    const s9 = (db.query("SELECT COUNT(*) AS c FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL").get(r.id) as { c: number }).c;
    out.projects.push({
      project_no: r.project_no, sub_track: key, grandfathered: !byDate, opted_in: optedIn, s9_rows: s9,
      would_move: moved.length, fails_stay_unmet: moved.filter((m) => m.stays_unmet).length,
    });
  }
  return out;
}
