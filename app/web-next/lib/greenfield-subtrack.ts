// greenfield-subtrack — S9 selection by greenfield sub-track (ADR-0160 and its
// 2026-10-12 addendum, migration 0136). Owns:
//   - the greenfield extra-checklist map and item scope (null sub-track keeps
//     today's empty set — byte-identical);
//   - the cut-off / opt-in rule (GF_SUBTRACK_PREDICATE_DATE, recorded pin
//     migration with a migration_note);
//   - site_required: read through the routing resolver (live AND reviewed
//     assertion only), written by the human-only greenfield-scope route via
//     the dimension-input repository's single-person confirmation path
//     (assert + review by the same person in one transaction, no evidence_ref
//     — user decision 2026-10-12, ADR-0160 addendum (d));
//   - the read-only in-flight greenfield count query (policy impact, design §8);
//   - the S9 workspace scope overlay (ADR-0160 addendum b, design
//     2026-10-12-greenfield-dd-workspace-domains-by-track): A/R/X/N/C per item
//     of the seven ADR-0148 checklists, its cut-off (GF_WORKSPACE_SCOPE_DATE)
//     and its human-only opt-in. Fail-closed: a missing overlay, item or
//     unapproved row means "apply as-is" (A), never N.
// Brownfield never reaches this module — dd-checklist-tailor keeps its
// brownfield branch unchanged.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ROUTING_VAR_KEYS, SUB_TRACK_NONE, resolveRoutingVars } from "../../../db/lib/applies-when.ts";
import { assertWithSinglePersonConfirmation } from "../../../db/repositories/dimension-input.repository.ts";
import { DD_WORKSPACE_CHECKLISTS, getChecklistItems, getWorkspaceOverlay, type ChecklistItemDef } from "./library.ts";
import { GF_SUBTRACK_PREDICATE_DATE, GF_WORKSPACE_SCOPE_DATE } from "./wave-f-date.ts";

export const GREENFIELD_SUB_TRACKS = ["existing_business_rbd", "intra_venture"] as const;
export type GreenfieldSubTrack = (typeof GREENFIELD_SUB_TRACKS)[number];

/** Procedure doc id + version a recorded opt-in pins (policy impact rule 9). */
export const GF_DD_POLICY_DOC_ID = "shared-greenfield-dd";
export const GF_DD_SUBTRACK_VERSION = "1.1.0";

/** Extra S9 checklists per greenfield sub-track (design §4.2). Null: none. */
export const GF_SUB_TRACK_DD_CHECKLISTS: Record<GreenfieldSubTrack, string[]> = {
  existing_business_rbd: ["chk-rbd-technology-checklist"],
  intra_venture: ["chk-rbd-technology-checklist", "chk-entity-formation-checklist"],
};

/** Item scope for greenfield extras: entity-formation is read as plan evidence (ef-01/03/07 only). */
export const GF_CHECKLIST_ITEM_SCOPE: Record<string, readonly string[]> = {
  "chk-entity-formation-checklist": ["ef-01", "ef-03", "ef-07"],
};

/** The site-visit checklist whose `na` needs a reason when the sub-track rule takes the site out of scope. */
export const GF_SITE_CHECKLISTS = ["chk-technical-dd-checklist"];

/** Site-related items inside GF_SITE_CHECKLISTS (site visit tdd-01 and its evidence tdd-02); other items stay reason-free. */
export const GF_SITE_ITEM_SCOPE: Record<string, readonly string[]> = {
  "chk-technical-dd-checklist": ["tdd-01", "tdd-02"],
};

/** Items of a checklist as applied to a sub-track extra (scope-filtered; unscoped checklists unchanged). */
export function scopedChecklistItems(checklistId: string): ChecklistItemDef[] | null {
  const items = getChecklistItems(checklistId);
  const scope = GF_CHECKLIST_ITEM_SCOPE[checklistId];
  if (!items || !scope) return items;
  return items.filter((i) => scope.includes(i.id));
}

export interface ProjectRoute {
  track: "greenfield" | "brownfield";
  sub_track: string | null;
}

export function currentRoute(projectId: string, db: Database = getDb()): ProjectRoute | null {
  return (
    (db
      .query(
        "SELECT r.track, r.sub_track FROM route_decision r JOIN md_project m ON m.source_opportunity_id = r.opportunity_id WHERE m.id = ? AND r.is_current = 1",
      )
      .get(projectId) as ProjectRoute | undefined) ?? null
  );
}

export function isGreenfieldSubTrack(v: string | null): v is GreenfieldSubTrack {
  return v !== null && (GREENFIELD_SUB_TRACKS as readonly string[]).includes(v);
}

/** Live opt-in pin: a human re-pinned greenfield-dd to the sub-track version. */
export function hasSubTrackOptIn(projectId: string, db: Database = getDb()): boolean {
  return !!db
    .query("SELECT id FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ? AND pinned_version = ? AND superseded_by IS NULL")
    .get(projectId, GF_DD_POLICY_DOC_ID, GF_DD_SUBTRACK_VERSION);
}

/**
 * Sub-track selection is active when the project's earliest pin (or creation)
 * is on/after the cut-off, or a human opted it in. Older projects keep the
 * 1.0.0 (site-centric, no extras) selection.
 */
export function subTrackSelectionActive(projectId: string, db: Database = getDb()): boolean {
  const proj = db.query("SELECT created_at FROM md_project WHERE id = ?").get(projectId) as { created_at: string | null } | undefined;
  if (!proj) return false;
  const pin = db.query("SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ?").get(projectId) as { at: string | null };
  if ((pin.at ?? proj.created_at ?? "") >= GF_SUBTRACK_PREDICATE_DATE) return true;
  return hasSubTrackOptIn(projectId, db);
}

/** Resolved site applicability: reviewed assertion, else the sub-track default (none for existing_business_rbd). */
export type SiteRequiredBasis = "confirmed" | "default" | "unconfirmed";
export interface SiteScope {
  site_required: boolean | null;
  basis: SiteRequiredBasis;
  /** Steps/checklists apply fail-closed when the value is unknown. */
  site_steps_apply: boolean;
  /**
   * Always null since 2026-10-12 (ADR-0160 addendum (d)): a confirmation is
   * effective immediately, so there is no pending-review state. Kept in the
   * payload (null) for client compatibility.
   */
  pending_assertion: { id: string; value: boolean; asserted_by: string; rationale: string; evidence_ref: string } | null;
}

export interface GreenfieldSelection {
  track: "greenfield";
  sub_track: string | null;
  /** 'none' | a greenfield sub-track | 'unknown' (brownfield or other value on a greenfield route). */
  sub_track_class: "none" | GreenfieldSubTrack | "unknown";
  selection_active: boolean;
  opted_in: boolean;
  extra_checklists: string[];
  site: SiteScope;
  /** Checklists whose items need a reason on `na` (applicability decided by the sub-track rule). */
  na_reason_checklists: string[];
  excluded_steps: number[];
  warnings: string[];
}

function siteScope(projectId: string, cls: GreenfieldSelection["sub_track_class"], db: Database): SiteScope {
  const lookup = resolveRoutingVars(projectId, db);
  const snap = lookup(ROUTING_VAR_KEYS.siteRequired);
  const pending = null;
  if (snap?.status === "present" && typeof snap.value === "boolean") {
    return { site_required: snap.value, basis: "confirmed", site_steps_apply: snap.value, pending_assertion: pending };
  }
  // No default for existing_business_rbd or intra_venture: a human must confirm; site steps apply until then.
  if (cls === "intra_venture" || cls === "existing_business_rbd") return { site_required: null, basis: "unconfirmed", site_steps_apply: true, pending_assertion: pending };
  return { site_required: true, basis: "default", site_steps_apply: true, pending_assertion: pending };
}

/** Greenfield S9 selection for one project; null for brownfield / no route. */
export function greenfieldSelection(projectId: string, db: Database = getDb()): GreenfieldSelection | null {
  const route = currentRoute(projectId, db);
  if (!route || route.track !== "greenfield") return null;
  const warnings: string[] = [];
  const cls: GreenfieldSelection["sub_track_class"] =
    route.sub_track === null ? "none" : isGreenfieldSubTrack(route.sub_track) ? route.sub_track : "unknown";
  if (cls === "unknown") {
    warnings.push(
      `greenfield 경로의 세부 트랙 '${route.sub_track}'은(는) 알 수 없는 값입니다 — 신규 부지 기본 선택(세부 트랙 없음)을 적용합니다. 경로 결정을 확인하세요.`,
    );
  }
  const optedIn = hasSubTrackOptIn(projectId, db);
  const active = subTrackSelectionActive(projectId, db);
  const site = siteScope(projectId, cls, db);
  if (!active || cls === "none" || cls === "unknown") {
    return {
      track: "greenfield",
      sub_track: route.sub_track,
      sub_track_class: cls,
      selection_active: active,
      opted_in: optedIn,
      extra_checklists: [],
      site: active ? site : { site_required: true, basis: "default", site_steps_apply: true, pending_assertion: site.pending_assertion },
      na_reason_checklists: [],
      excluded_steps: [6, 7, 8],
      warnings,
    };
  }
  if ((cls === "existing_business_rbd" || cls === "intra_venture") && site.basis === "unconfirmed") {
    warnings.push("기존사업 R&BD·사내벤처 세부 트랙은 부지 필요 여부의 기본값이 없습니다 — 사람이 확인하기 전까지 부지 단계가 적용됩니다.");
  }
  const extra = GF_SUB_TRACK_DD_CHECKLISTS[cls];
  const excluded = [2, ...(site.site_steps_apply ? [] : [1, 3]), ...(cls === "intra_venture" ? [] : [8])].sort((a, b) => a - b);
  return {
    track: "greenfield",
    sub_track: route.sub_track,
    sub_track_class: cls,
    selection_active: true,
    opted_in: optedIn,
    extra_checklists: [...extra],
    site,
    na_reason_checklists: [...extra, ...(site.site_steps_apply ? [] : GF_SITE_CHECKLISTS)],
    excluded_steps: excluded,
    warnings,
  };
}

/**
 * True when an `na` on (checklist) for this project must carry a reason. Brownfield: always false.
 * Workspace scope (design §10): for a greenfield project in the new workspace scope every item
 * of the seven workspace checklists needs a reason on `na`.
 */
export function naRequiresReason(projectId: string, checklistId: string, itemId?: string, db: Database = getDb()): boolean {
  const sel = greenfieldSelection(projectId, db);
  if (!sel) return false;
  if (WORKSPACE_CHECKLIST_IDS.includes(checklistId) && workspaceScopeActive(projectId, sel, db)) return true;
  if (!sel.na_reason_checklists.includes(checklistId)) return false;
  const siteItems = GF_SITE_ITEM_SCOPE[checklistId];
  // Sub-track extra checklists keep whole-checklist scope; a site checklist only for its site items.
  if (siteItems && !sel.extra_checklists.includes(checklistId)) return itemId === undefined || siteItems.includes(itemId);
  return true;
}

// ── Human-only writes (route enforces cookie + CSRF + human principal) ──

export type ScopeErrorCode =
  | "invalid_request"
  | "not_greenfield"
  | "no_run"
  | "not_found"
  | "write_rejected"
  | "already_opted_in"
  | "overlay_unavailable";
export type ScopeResult<T> = ({ ok: true } & T) | { ok: false; code: ScopeErrorCode; message: string };
const err = (code: ScopeErrorCode, message: string) => ({ ok: false as const, code, message });
export const MAX_MIGRATION_NOTE_LEN = 2000;

function latestRunId(projectId: string, db: Database): string | null {
  const r = db
    .query("SELECT id FROM run WHERE project_id = ? AND superseded_by IS NULL ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(projectId) as { id: string } | undefined;
  return r?.id ?? null;
}

export function confirmSiteRequired(
  input: { projectId: string; value: unknown; rationale: unknown; actor: string; now?: string },
  db: Database = getDb(),
): ScopeResult<{ assertion_id: string }> {
  if (typeof input.value !== "boolean") return err("invalid_request", "site_required는 true 또는 false여야 합니다.");
  const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
  if (!rationale) return err("invalid_request", "부지 필요 여부 확인에는 rationale이 필요합니다.");
  const route = currentRoute(input.projectId, db);
  if (!route || route.track !== "greenfield") return err("not_greenfield", "부지 필요 여부는 greenfield 경로 프로젝트에만 기록합니다.");
  // Plain greenfield (no sub-track): site_required defaults to true and has no UI control; only true may be confirmed.
  if ((route.sub_track === null || route.sub_track === "none") && input.value === false) {
    return err("invalid_request", "세부 트랙이 없는 신규 사업은 부지 불필요로 확인할 수 없습니다");
  }
  const runId = latestRunId(input.projectId, db);
  if (!runId) return err("no_run", "이 프로젝트에 분석 run이 없습니다 — 단언은 run 범위로만 기록됩니다.");
  try {
    // Single-person confirmation (user decision 2026-10-12): effective immediately, no evidence_ref.
    const row = assertWithSinglePersonConfirmation(
      {
        project_id: input.projectId,
        run_id: runId,
        var_key: ROUTING_VAR_KEYS.siteRequired,
        value: { kind: "bool", value: input.value },
        evidence_ref: "",
        asserted_by: input.actor,
        rationale,
        now: input.now,
      },
      db,
    );
    return { ok: true, assertion_id: row.id };
  } catch (e) {
    return err("write_rejected", (e as Error).message);
  }
}

/**
 * Recorded pin migration (policy impact rule 9): supersede the live
 * greenfield-dd pin with the 1.1.0 pin and audit the migration_note. Never
 * touches checklist item state; existing site rows stay as they are.
 */
export function optInSubTrackSelection(
  input: { projectId: string; migrationNote: unknown; actor: string; now?: string },
  db: Database = getDb(),
): ScopeResult<{ pin_id: string }> {
  const note = typeof input.migrationNote === "string" ? input.migrationNote.trim() : "";
  if (!note) return err("invalid_request", "migration_note가 필요합니다.");
  if (note.length > MAX_MIGRATION_NOTE_LEN) return err("invalid_request", `migration_note는 ${MAX_MIGRATION_NOTE_LEN}자 이하여야 합니다.`);
  const route = currentRoute(input.projectId, db);
  if (!route || route.track !== "greenfield") return err("not_greenfield", "세부 트랙 선택 전환은 greenfield 경로 프로젝트에만 적용합니다.");
  if (hasSubTrackOptIn(input.projectId, db)) return err("already_opted_in", "이미 세부 트랙 선택으로 전환된 프로젝트입니다.");
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    const live = db
      .query("SELECT id FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ? AND superseded_by IS NULL")
      .get(input.projectId, GF_DD_POLICY_DOC_ID) as { id: string } | undefined;
    // Same successor-born-non-live order as the other supersede chains (partial live index).
    db.run(
      "INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by) VALUES (?,?,?,?,?,?,?)",
      [id, input.projectId, GF_DD_POLICY_DOC_ID, GF_DD_SUBTRACK_VERSION, now, input.actor, live?.id ?? null],
    );
    if (live) {
      db.run("UPDATE project_policy_pin SET superseded_by = ? WHERE id = ?", [id, live.id]);
      db.run("UPDATE project_policy_pin SET superseded_by = NULL WHERE id = ?", [id]);
    }
    appendAudit(db, {
      actor: input.actor,
      action: "policy_pin_migrated",
      target: `${input.projectId}:${GF_DD_POLICY_DOC_ID}:${GF_DD_SUBTRACK_VERSION} migration_note=${note.slice(0, 500)}`,
      now,
    });
  })();
  return { ok: true, pin_id: id };
}

// ── Read-only policy-impact query (design §8) — counts only ──

export interface InFlightGreenfieldCounts {
  total: number;
  by_sub_track: Record<string, number>;
  grandfathered: number;
  opted_in: number;
}

export function inFlightGreenfieldCounts(db: Database = getDb()): InFlightGreenfieldCounts {
  const rows = db
    .query(
      `SELECT m.id AS id, r.sub_track AS sub_track, MIN(pp.pinned_at) AS first_pin, m.created_at AS created_at
         FROM route_decision r
         JOIN md_project m ON m.source_opportunity_id = r.opportunity_id
         LEFT JOIN project_policy_pin pp ON pp.project_id = m.id
        WHERE r.track = 'greenfield' AND r.is_current = 1
        GROUP BY m.id`,
    )
    .all() as { id: string; sub_track: string | null; first_pin: string | null; created_at: string | null }[];
  const out: InFlightGreenfieldCounts = { total: rows.length, by_sub_track: {}, grandfathered: 0, opted_in: 0 };
  for (const r of rows) {
    const key = r.sub_track ?? SUB_TRACK_NONE;
    out.by_sub_track[key] = (out.by_sub_track[key] ?? 0) + 1;
    if ((r.first_pin ?? r.created_at ?? "") < GF_SUBTRACK_PREDICATE_DATE) out.grandfathered += 1;
    if (hasSubTrackOptIn(r.id, db)) out.opted_in += 1;
  }
  return out;
}

// ── S9 workspace scope overlay (ADR-0160 addendum b) ──────────────────────
//
// Source: checklists/_overlays/greenfield-workspace-scope.yaml, embedded in the
// library projection (LIBRARY_WORKSPACE_OVERLAY, drift-checked). Read once and
// cached. Every reader below is defensive: anything malformed, missing or
// unapproved resolves to "apply as-is" (A). Brownfield never reaches it.

/** Governance doc id + the pin a recorded workspace opt-in writes (policy impact rule 9). */
export const GF_WS_POLICY_DOC_ID = "ovl-greenfield-workspace-scope";

export type WorkspaceCode = "A" | "R" | "X" | "N" | "C";
export type WorkspaceScopeKey = "none" | GreenfieldSubTrack;
export const WORKSPACE_CHECKLIST_IDS: readonly string[] = Object.values(DD_WORKSPACE_CHECKLISTS);
const WORKSPACE_CODES: readonly string[] = ["A", "R", "X", "N", "C"];

interface OverlayPointer {
  checklist: string;
  item: string;
  stage: string;
}
interface OverlayCell {
  code: WorkspaceCode;
  reading?: string;
  na_reason?: string;
  note?: string;
  replaced_by?: OverlayPointer[];
}
interface OverlayRow {
  id: string;
  topic: string;
  cells: Partial<Record<WorkspaceScopeKey, OverlayCell>>;
  approved: boolean;
}
export interface OverlayStep {
  step: number;
  purpose: string;
  tabs: string[];
  items: Array<{ checklist: string; ids: string[] }>;
  pointers: Array<{ checklist: string; ids: string[]; stage: string }>;
  artefact: string | null;
  applies: Partial<Record<WorkspaceScopeKey, string>>;
}
export interface WorkspaceOverlay {
  governance_doc_id: string;
  version: string;
  rows: Map<string, Map<string, OverlayRow>>;
  domain_of: Map<string, string>;
  steps: OverlayStep[];
  tab_labels: Record<string, { en: string; ko: string }>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const SCOPE_KEYS: readonly WorkspaceScopeKey[] = ["none", ...GREENFIELD_SUB_TRACKS];

/** Normalise the raw projection; null when the overlay is absent or unusable (fail-closed to A). */
export function parseWorkspaceOverlay(raw: unknown): WorkspaceOverlay | null {
  const doc = obj(raw);
  const id = str(doc.governance_doc_id);
  const version = str(doc.version);
  if (id !== GF_WS_POLICY_DOC_ID || !version) return null;
  const rows = new Map<string, Map<string, OverlayRow>>();
  const domainOf = new Map<string, string>();
  for (const [checklistId, block] of Object.entries(obj(doc.checklists))) {
    const b = obj(block);
    const domain = str(b.domain);
    if (domain) domainOf.set(checklistId, domain);
    const byItem = new Map<string, OverlayRow>();
    for (const r of arr(b.items)) {
      const ro = obj(r);
      const itemId = str(ro.id);
      if (!itemId) continue;
      const approval = obj(ro.approval);
      const cells: OverlayRow["cells"] = {};
      for (const key of SCOPE_KEYS) {
        const c = obj(obj(ro.sub_tracks)[key]);
        const code = str(c.code);
        if (!code || !WORKSPACE_CODES.includes(code)) continue;
        cells[key] = {
          code: code as WorkspaceCode,
          reading: str(c.reading),
          na_reason: str(c.na_reason),
          note: str(c.note),
          replaced_by: arr(c.replaced_by)
            .map((p) => obj(p))
            .filter((p) => str(p.checklist) && str(p.item))
            .map((p) => ({ checklist: p.checklist as string, item: p.item as string, stage: str(p.stage) ?? "" })),
        };
      }
      byItem.set(itemId, {
        id: itemId,
        topic: str(ro.topic) ?? itemId,
        cells,
        approved: approval.status === "approved" && !!str(approval.approved_by) && !!str(approval.approved_at),
      });
    }
    rows.set(checklistId, byItem);
  }
  const steps: OverlayStep[] = arr(doc.steps).flatMap((s) => {
    const so = obj(s);
    if (typeof so.step !== "number") return [];
    return [
      {
        step: so.step,
        purpose: str(so.purpose) ?? "",
        tabs: arr(so.tabs).filter((t): t is string => typeof t === "string"),
        items: arr(so.items).map((i) => ({ checklist: str(obj(i).checklist) ?? "", ids: arr(obj(i).ids).filter((x): x is string => typeof x === "string") })),
        pointers: arr(so.pointers).map((i) => ({
          checklist: str(obj(i).checklist) ?? "",
          ids: arr(obj(i).ids).filter((x): x is string => typeof x === "string"),
          stage: str(obj(i).stage) ?? "",
        })),
        artefact: str(so.artefact) ?? null,
        applies: Object.fromEntries(SCOPE_KEYS.map((k) => [k, str(obj(so.applies)[k])]).filter(([, v]) => v)) as OverlayStep["applies"],
      },
    ];
  });
  const tabLabels: WorkspaceOverlay["tab_labels"] = {};
  for (const [k, v] of Object.entries(obj(doc.tab_labels))) {
    const en = str(obj(v).en);
    const ko = str(obj(v).ko);
    if (en && ko) tabLabels[k] = { en, ko };
  }
  return { governance_doc_id: id, version, rows, domain_of: domainOf, steps, tab_labels: tabLabels };
}

let OVERLAY_CACHE: { value: WorkspaceOverlay | null } | null = null;
/** The overlay, read once from the projection and cached (tests may inject a replacement). */
export function workspaceOverlay(): WorkspaceOverlay | null {
  if (!OVERLAY_CACHE) OVERLAY_CACHE = { value: parseWorkspaceOverlay(getWorkspaceOverlay()) };
  return OVERLAY_CACHE.value;
}
/** Test seam: replace (raw document) or reset (undefined) the cached overlay. */
export function setWorkspaceOverlayForTest(raw?: unknown): void {
  OVERLAY_CACHE = raw === undefined ? null : { value: parseWorkspaceOverlay(raw) };
}

/** Live workspace-scope opt-in pin (any overlay version; a later version bump never reverts an opt-in). */
export function hasWorkspaceScopeOptIn(projectId: string, db: Database = getDb()): boolean {
  return !!db
    .query("SELECT id FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ? AND superseded_by IS NULL")
    .get(projectId, GF_WS_POLICY_DOC_ID);
}

function earliestPinOrCreation(projectId: string, db: Database): string | null {
  const proj = db.query("SELECT created_at FROM md_project WHERE id = ?").get(projectId) as { created_at: string | null } | undefined;
  if (!proj) return null;
  // Opt-in pins (this overlay, or the ADR-0160 1.1.0 re-pin) are excluded: a recorded
  // opt-in of one scope must never move a grandfathered project into the other (§10).
  const pin = db
    .query(
      "SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ? AND policy_doc_id != ? AND NOT (policy_doc_id = ? AND pinned_version = ?)",
    )
    .get(projectId, GF_WS_POLICY_DOC_ID, GF_DD_POLICY_DOC_ID, GF_DD_SUBTRACK_VERSION) as { at: string | null };
  const created = proj.created_at ?? "";
  if (pin.at === null) return created;
  return pin.at < created ? pin.at : created;
}

/** True when the project is past the workspace cut-off by its earliest pin / creation (no opt-in needed). */
export function workspaceScopeByDate(projectId: string, db: Database = getDb()): boolean {
  const at = earliestPinOrCreation(projectId, db);
  return at !== null && at >= GF_WORKSPACE_SCOPE_DATE;
}

/**
 * The workspace scope is active when an overlay is loaded, the project is past
 * GF_WORKSPACE_SCOPE_DATE or a person opted it in, and — for the two named
 * sub-tracks — the ADR-0160 sub-track selection is active too (the overlay's
 * replacements point into the sub-track extra checklists).
 */
export function workspaceScopeActive(projectId: string, sel: GreenfieldSelection | null, db: Database = getDb()): boolean {
  if (!sel || !workspaceOverlay()) return false;
  if (!workspaceScopeByDate(projectId, db) && !hasWorkspaceScopeOptIn(projectId, db)) return false;
  if (isGreenfieldSubTrack(sel.sub_track_class) && !sel.selection_active) return false;
  return true;
}

/** Overlay column for a selection: the named sub-track when its selection is active, else 'none'. */
export function workspaceScopeKey(sel: GreenfieldSelection): WorkspaceScopeKey {
  return isGreenfieldSubTrack(sel.sub_track_class) && sel.selection_active ? sel.sub_track_class : "none";
}

export interface ReplacementPointer {
  checklist_id: string;
  item_id: string;
  stage: string;
  /** Judged inside the S9 workspace (sub-track extra tab) vs an earlier stage (read-only). */
  in_s9: boolean;
  status: string | null;
  judged: boolean;
  assessed_by: string | null;
  assessed_at: string | null;
}

export interface WorkspaceItemScope {
  checklist_id: string;
  item_id: string;
  /** Code as written in the overlay for this column; null = missing or unapproved (applied as A). */
  overlay_code: WorkspaceCode | null;
  /** Effective code after the site rule (C) and the replacement fallback. */
  code: "A" | "R" | "X" | "N";
  judgeable: boolean;
  reading: string | null;
  reason: string | null;
  note: string | null;
  replaced_by: ReplacementPointer[];
  /** Why the item fell back to judgeable/as-is (fail-closed paths). */
  fallback: "missing_from_overlay" | "unapproved" | "replacement_not_judged" | null;
  /** 'site_rule' when the C code resolved through site_required. */
  rule: "overlay" | "site_rule" | "fail_closed";
  steps: number[];
}

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

function stepsByItem(ov: WorkspaceOverlay): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const s of ov.steps)
    for (const g of s.items)
      for (const id of g.ids) {
        const k = `${g.checklist}:${id}`;
        m.set(k, [...(m.get(k) ?? []), s.step]);
      }
  return m;
}

/** A replacement pointer holds only on a recorded pass or fail (security/risk review 2026-10-12). */
export function isDecisive(status: string | null | undefined): boolean {
  return status === "pass" || status === "fail";
}

function resolveItem(
  ov: WorkspaceOverlay,
  key: WorkspaceScopeKey,
  sel: GreenfieldSelection,
  checklistId: string,
  itemId: string,
  states: Map<string, StateLite>,
  steps: Map<string, number[]>,
): WorkspaceItemScope {
  const base = { checklist_id: checklistId, item_id: itemId, steps: steps.get(`${checklistId}:${itemId}`) ?? [] };
  const row = ov.rows.get(checklistId)?.get(itemId);
  const cell = row?.cells[key];
  if (!row || !cell || !row.approved) {
    return {
      ...base, overlay_code: null, code: "A", judgeable: true, reading: null, reason: null, note: null, replaced_by: [],
      fallback: !row || !cell ? "missing_from_overlay" : "unapproved", rule: "fail_closed",
    };
  }
  const common = { ...base, overlay_code: cell.code, reading: cell.reading ?? null, note: cell.note ?? null, replaced_by: [] as ReplacementPointer[], fallback: null, rule: "overlay" as const };
  if (cell.code === "A" || cell.code === "R") return { ...common, code: cell.code, judgeable: true, reason: null };
  if (cell.code === "N") return { ...common, code: "N", judgeable: false, reason: cell.na_reason ?? null };
  if (cell.code === "C") {
    return sel.site.site_steps_apply
      ? { ...common, code: "A", judgeable: true, reason: null, rule: "site_rule" }
      : { ...common, code: "N", judgeable: false, reason: cell.na_reason ?? null, rule: "site_rule" };
  }
  // X: pointers with live status; an earlier-stage target never judged (or a target outside
  // this project's S9 set) makes the original item judgeable again (fail-closed, design §6).
  const s9Set = new Set([...WORKSPACE_CHECKLIST_IDS, ...sel.extra_checklists]);
  const pointers: ReplacementPointer[] = (cell.replaced_by ?? []).map((p) => {
    const st = states.get(`${p.checklist}:${p.item}`);
    return {
      checklist_id: p.checklist,
      item_id: p.item,
      stage: p.stage,
      in_s9: s9Set.has(p.checklist),
      status: st?.status ?? null,
      judged: isDecisive(st?.status),
      assessed_by: st?.assessed_by ?? null,
      assessed_at: st?.assessed_at ?? null,
    };
  });
  const internalMissing = (cell.replaced_by ?? []).some((p) => p.stage.startsWith("S9") && !s9Set.has(p.checklist));
  // Every replacement target — earlier-stage or in-S9 — must hold a pass/fail judgement;
  // na, waived, pending or a missing row leaves the original item judgeable.
  const anyUndecided = pointers.some((p) => !p.judged);
  if (pointers.length === 0 || internalMissing || anyUndecided) {
    return { ...common, code: "A", judgeable: true, reason: null, replaced_by: pointers, fallback: "replacement_not_judged" };
  }
  return { ...common, code: "X", judgeable: false, reason: cell.note ?? null, replaced_by: pointers };
}

/** Resolved scope of every item of the seven workspace checklists for one active project. */
export function resolveWorkspaceItems(
  projectId: string,
  sel: GreenfieldSelection,
  db: Database = getDb(),
  opts: { states?: Map<string, StateLite>; key?: WorkspaceScopeKey } = {},
): Map<string, WorkspaceItemScope> {
  const out = new Map<string, WorkspaceItemScope>();
  const ov = workspaceOverlay();
  const states = opts.states ?? stateMap(projectId, db);
  const key = opts.key ?? workspaceScopeKey(sel);
  const steps = ov ? stepsByItem(ov) : new Map<string, number[]>();
  for (const checklistId of WORKSPACE_CHECKLIST_IDS) {
    for (const item of getChecklistItems(checklistId) ?? []) {
      const scope = ov
        ? resolveItem(ov, key, sel, checklistId, item.id, states, steps)
        : ({
            checklist_id: checklistId, item_id: item.id, overlay_code: null, code: "A", judgeable: true, reading: null, reason: null, note: null,
            replaced_by: [], fallback: "missing_from_overlay", rule: "fail_closed", steps: [],
          } satisfies WorkspaceItemScope);
      out.set(`${checklistId}:${item.id}`, scope);
    }
  }
  return out;
}

/**
 * Scope of one workspace item for a project (design §7 option 3 single entry
 * point). null = the workspace scope does not apply (brownfield, grandfathered,
 * or not one of the seven workspace checklists) — the caller keeps today's path.
 */
export function workspaceItemScope(projectId: string, checklistId: string, itemId: string, db: Database = getDb()): WorkspaceItemScope | null {
  if (!WORKSPACE_CHECKLIST_IDS.includes(checklistId)) return null;
  const sel = greenfieldSelection(projectId, db);
  if (!sel || !workspaceScopeActive(projectId, sel, db)) return null;
  return resolveWorkspaceItems(projectId, sel, db).get(`${checklistId}:${itemId}`) ?? null;
}

export interface StepTag {
  step: number;
  purpose: string;
  in_scope: boolean;
  /** Reason text when out of scope. */
  reason: string | null;
  pointers: Array<{ checklist_id: string; item_id: string; stage: string; status: string | null; judged: boolean }>;
}

function stepInScope(applies: string | undefined, sel: GreenfieldSelection): { in_scope: boolean; reason: string | null } {
  switch (applies) {
    case "yes":
      return { in_scope: true, reason: null };
    case "if_site_required":
      return sel.site.site_steps_apply
        ? { in_scope: true, reason: null }
        : { in_scope: false, reason: "부지가 필요하지 않습니다 (site_required = false 확인됨, ADR-0160 부지 규칙)." };
    case "replaced_by_step_6":
      return { in_scope: false, reason: "이 세부 트랙에서는 6단계(핵심 팀 준비 상태)로 대체됩니다." };
    case "no":
      return { in_scope: false, reason: "이 세부 트랙의 절차에 포함되지 않습니다." };
    default:
      // Unknown or missing value: fail-closed — the step applies.
      return { in_scope: true, reason: null };
  }
}

/** Per-tab step tags from the overlay `steps` key (design §6A.3). */
export function stepTabMap(sel: GreenfieldSelection, states: Map<string, StateLite>): Record<string, StepTag[]> {
  const ov = workspaceOverlay();
  const out: Record<string, StepTag[]> = {};
  if (!ov) return out;
  const key = workspaceScopeKey(sel);
  for (const s of ov.steps) {
    const scope = stepInScope(s.applies[key], sel);
    const pointers = s.pointers.flatMap((p) =>
      p.ids.map((id) => {
        const st = states.get(`${p.checklist}:${id}`);
        return { checklist_id: p.checklist, item_id: id, stage: p.stage, status: st?.status ?? null, judged: isDecisive(st?.status) };
      }),
    );
    for (const tab of s.tabs) (out[tab] ??= []).push({ step: s.step, purpose: s.purpose, ...scope, pointers });
  }
  return out;
}

export interface PlanReadinessRow {
  step: number;
  purpose: string;
  in_scope: boolean;
  reason: string | null;
  artefact: string | null;
  /** 'recorded' | 'not_recorded' | 'not_tracked' (no system store for the artefact; check manually). */
  status: "recorded" | "not_recorded" | "not_tracked";
  detail: string | null;
}

/** Steps 4/5/6 status rows (never counted in Y; step 6 reads hdd-01 of the hr tab). */
export function planReadinessRows(projectId: string, sel: GreenfieldSelection, db: Database = getDb()): PlanReadinessRow[] {
  const ov = workspaceOverlay();
  if (!ov) return [];
  const key = workspaceScopeKey(sel);
  const rows: PlanReadinessRow[] = [];
  for (const s of ov.steps.filter((x) => x.tabs.includes("plan_readiness"))) {
    const scope = stepInScope(s.applies[key], sel);
    let status: PlanReadinessRow["status"] = "not_tracked";
    let detail: string | null = null;
    if (s.step === 4) {
      const n = (db
        .query("SELECT COUNT(*) AS c FROM dd_finding WHERE project_id = ? AND target_id IS NULL AND (value_impact IS NOT NULL OR assumption_key IS NOT NULL)")
        .get(projectId) as { c: number }).c;
      status = n > 0 ? "recorded" : "not_recorded";
      detail = `value_impact / assumption_key에 연결된 발견사항 ${n}건`;
    } else if (s.step === 5) {
      const g = db
        .query("SELECT decision, decided_at FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate = 'dd' ORDER BY decided_at DESC LIMIT 1")
        .get(projectId) as { decision: string; decided_at: string } | undefined;
      status = g ? "recorded" : "not_recorded";
      detail = g ? `DD 게이트 결정: ${g.decision} (${g.decided_at})` : null;
    } else if (s.step === 6) {
      // Core-team readiness is judged on the hr tab: hdd-01 (key-people map) of the gate scope.
      const st = db
        .query("SELECT status FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = ? AND item_id = 'hdd-01' AND target_id IS NULL")
        .get(projectId, DD_WORKSPACE_CHECKLISTS.hr) as { status: string } | undefined;
      if (st?.status === "pass") {
        status = "recorded";
        detail = "hdd-01(핵심 인력 지도) 판정 통과로 확인되었습니다.";
      } else {
        status = "not_recorded";
        detail = !st
          ? "hdd-01(핵심 인력 지도)을 아직 판정하지 않았습니다. 인력/조직 계획 탭에서 판정하세요."
          : st.status === "pending"
            ? "hdd-01(핵심 인력 지도) 판정이 보류 중입니다."
            : `hdd-01(핵심 인력 지도) 판정 결과가 '${st.status}'이므로 확인되지 않았습니다.`;
      }
    } else {
      detail = "시스템에 이 산출물의 기록이 없습니다. 직접 확인하세요.";
    }
    rows.push({ step: s.step, purpose: s.purpose, ...scope, artefact: s.artefact, status, detail });
  }
  return rows;
}

export interface PreviousScopeEntry {
  checklist_id: string;
  item_id: string;
  code: "X" | "N";
  status: string;
  assessed_by: string | null;
  assessed_at: string | null;
  /** A recorded fail without a waiver stays unmet until a person re-judges it (design §9.3). */
  stays_unmet: boolean;
}

/** Judgements recorded on items that are now X or N (kept, never deleted; listed as history). */
export function previousScopeEntries(items: Map<string, WorkspaceItemScope>, states: Map<string, StateLite>): PreviousScopeEntry[] {
  const out: PreviousScopeEntry[] = [];
  for (const [k, sc] of items) {
    if (sc.judgeable) continue;
    const st = states.get(k);
    if (!st || st.status === "pending") continue;
    out.push({
      checklist_id: sc.checklist_id,
      item_id: sc.item_id,
      code: sc.code as "X" | "N",
      status: st.status,
      assessed_by: st.assessed_by,
      assessed_at: st.assessed_at,
      stays_unmet: st.status === "fail" && !st.waiver_id,
    });
  }
  return out;
}

export interface WorkspaceScopeContext {
  sel: GreenfieldSelection;
  key: WorkspaceScopeKey;
  overlay_version: string;
  items: Map<string, WorkspaceItemScope>;
  states: Map<string, StateLite>;
}

/** Everything a reader needs, or null when the workspace scope is not active for the project. */
export function workspaceScopeContext(projectId: string, db: Database = getDb(), selIn?: GreenfieldSelection | null): WorkspaceScopeContext | null {
  const sel = selIn === undefined ? greenfieldSelection(projectId, db) : selIn;
  const ov = workspaceOverlay();
  if (!sel || !ov || !workspaceScopeActive(projectId, sel, db)) return null;
  const states = stateMap(projectId, db);
  return { sel, key: workspaceScopeKey(sel), overlay_version: ov.version, items: resolveWorkspaceItems(projectId, sel, db, { states }), states };
}

/** The same resolution as if the project were in scope (opt-in preview); null for brownfield / no overlay. */
export function hypotheticalWorkspaceScope(projectId: string, db: Database = getDb()): WorkspaceScopeContext | null {
  const sel0 = greenfieldSelection(projectId, db);
  const ov = workspaceOverlay();
  if (!sel0 || !ov) return null;
  // The opt-in records the ADR-0160 pin too when needed (design §10), so preview with the selection active.
  const sel = sel0.selection_active || !isGreenfieldSubTrack(sel0.sub_track_class) ? sel0 : previewSelection(projectId, sel0, db);
  const states = stateMap(projectId, db);
  return { sel, key: workspaceScopeKey(sel), overlay_version: ov.version, items: resolveWorkspaceItems(projectId, sel, db, { states }), states };
}

function previewSelection(projectId: string, sel: GreenfieldSelection, db: Database): GreenfieldSelection {
  const cls = sel.sub_track_class as GreenfieldSubTrack;
  const site = siteScope(projectId, cls, db);
  return {
    ...sel,
    selection_active: true,
    extra_checklists: [...GF_SUB_TRACK_DD_CHECKLISTS[cls]],
    site,
    na_reason_checklists: [...GF_SUB_TRACK_DD_CHECKLISTS[cls], ...(site.site_steps_apply ? [] : GF_SITE_CHECKLISTS)],
  };
}

/**
 * Recorded workspace-scope opt-in (design §9.3, §10): pins the overlay version
 * with an audited migration_note. When the ADR-0160 sub-track selection is not
 * active yet for a named sub-track, the same action records that pin too (one
 * human act, two pins). Never touches checklist item state.
 */
export function optInWorkspaceScope(
  input: { projectId: string; migrationNote: unknown; actor: string; now?: string },
  db: Database = getDb(),
): ScopeResult<{ pin_id: string; subtrack_pin_id: string | null }> {
  const note = typeof input.migrationNote === "string" ? input.migrationNote.trim() : "";
  if (!note) return err("invalid_request", "migration_note가 필요합니다.");
  if (note.length > MAX_MIGRATION_NOTE_LEN) return err("invalid_request", `migration_note는 ${MAX_MIGRATION_NOTE_LEN}자 이하여야 합니다.`);
  const ov = workspaceOverlay();
  if (!ov) return err("overlay_unavailable", "작업 범위 오버레이를 읽을 수 없습니다 — 기존 화면을 유지합니다.");
  const sel = greenfieldSelection(input.projectId, db);
  if (!sel) return err("not_greenfield", "작업 범위 전환은 greenfield 경로 프로젝트에만 적용합니다.");
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  // One IMMEDIATE transaction: the already_opted_in check, the optional
  // sub-track pin and the workspace pin commit or roll back together (the
  // nested optInSubTrackSelection transaction becomes a savepoint).
  try {
    return db.transaction((): ScopeResult<{ pin_id: string; subtrack_pin_id: string | null }> => {
      if (workspaceScopeActive(input.projectId, sel, db)) throw new OptInAbort(err("already_opted_in", "이미 새 작업 범위가 적용된 프로젝트입니다."));
      let subtrackPinId: string | null = null;
      if (isGreenfieldSubTrack(sel.sub_track_class) && !sel.selection_active) {
        const r = optInSubTrackSelection({ projectId: input.projectId, migrationNote: note, actor: input.actor, now }, db);
        if (!r.ok) throw new OptInAbort(r);
        subtrackPinId = r.pin_id;
      }
      const live = db
        .query("SELECT id FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ? AND superseded_by IS NULL")
        .get(input.projectId, GF_WS_POLICY_DOC_ID) as { id: string } | undefined;
      db.run(
        "INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by) VALUES (?,?,?,?,?,?,?)",
        [id, input.projectId, GF_WS_POLICY_DOC_ID, ov.version, now, input.actor, live?.id ?? null],
      );
      if (live) {
        db.run("UPDATE project_policy_pin SET superseded_by = ? WHERE id = ?", [id, live.id]);
        db.run("UPDATE project_policy_pin SET superseded_by = NULL WHERE id = ?", [id]);
      }
      appendAudit(db, {
        actor: input.actor,
        action: "policy_pin_migrated",
        target: `${input.projectId}:${GF_WS_POLICY_DOC_ID}:${ov.version} migration_note=${note.slice(0, 500)}`,
        now,
      });
      return { ok: true, pin_id: id, subtrack_pin_id: subtrackPinId };
    }).immediate();
  } catch (e) {
    if (e instanceof OptInAbort) return e.result;
    throw e;
  }
}

/** Carries a refusal out of the opt-in transaction so it rolls back. */
class OptInAbort extends Error {
  constructor(public readonly result: { ok: false; code: ScopeErrorCode; message: string }) {
    super(result.message);
  }
}
