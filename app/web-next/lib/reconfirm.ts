// @version 1.0.0
/**
 * Project re-confirmation requirement - ADR-0186 owner decision O-6 (migration 0179).
 *
 * A project recorded under the legacy gate rules (e.g. PRJ-DSE4PW) is re-confirmed by people before it is used for anything
 * new. An administrator OPENS a requirement (data, no hard-coded project id) naming the items still needed:
 *   wacc_confirmed  - resolveWaccConfirmation(...).confirmed (subject set, WACC and hurdle kind=user)
 *   ic_countersign  - every IC gate with a recorded GO has its latest decision countersigned by a different grant holder,
 *                     and at least one IC GO is countersigned
 *   na_review       - no mandatory DD item stays `na` without a second-person confirmation
 * The items are DERIVED live (display only). While a requirement is open:
 *   - a new GO on that project is refused (409 reconfirmation_required, naming the unmet items) - enforced whatever the
 *     gate-integrity family flags say, because it is a project-specific owner decision. HOLD and KILL are never blocked
 *     (principle 5). A GO at entity_ic / group_ic is let through when ic_countersign is the ONLY unmet item: that re-decision
 *     is the very act the countersign needs (a legacy GO cannot be countersigned), and it is not effective until countersigned.
 *   - business-case adoption is refused the same way.
 *   - viewing, gate-brief generation and IC-package generation carry a non-blocking `reconfirmation` notice.
 * The requirement is CLEARED only by a person holding an IC reviewer grant, with an audited reason, once every item is
 * satisfied; the clearer is never the recorder of one of the project's IC decisions. No system or agent clears it.
 */
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { countersignState, isIcGate, latestProjectDecision } from "../../../db/lib/gate-effective.ts";
import { hasHumanRole } from "../../../db/lib/human-roles.ts";
import { resolveWaccConfirmation } from "../../../db/lib/wacc-confirmation.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { isMandatoryChecklistItem } from "./dd-checklist-tailor.ts";
import type { IntegrityFailure } from "./gate-integrity.ts";
import { validateRationale } from "./rationale-check.ts";

export const RECONFIRM_ITEMS = ["wacc_confirmed", "ic_countersign", "na_review"] as const;
export type ReconfirmItem = (typeof RECONFIRM_ITEMS)[number];
export const RECONFIRM_CLEAR_ROLES = ["entity-ic-reviewer", "group-ic-reviewer"] as const;

export interface ReconfirmRow {
  id: string;
  project_id: string;
  items_json: string;
  reason: string;
  created_by: string;
  created_at: string;
  cleared_by: string | null;
  cleared_at: string | null;
  clear_reason: string | null;
}

export interface ReconfirmStatus {
  open: boolean;
  id: string;
  reason: string;
  created_by: string;
  created_at: string;
  items: Array<{ key: ReconfirmItem; satisfied: boolean }>;
  unmet: ReconfirmItem[];
  /** Every item is satisfied: a grant holder may now clear the requirement. */
  clearable: boolean;
}

function hasTable(db: Database): boolean {
  return !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_reconfirm_requirement'").get();
}

export function openRequirement(db: Database, projectId: string): ReconfirmRow | null {
  if (!hasTable(db)) return null;
  return (db.query("SELECT * FROM project_reconfirm_requirement WHERE project_id = ? AND cleared_at IS NULL").get(projectId) as ReconfirmRow | null) ?? null;
}

function icCountersignSatisfied(db: Database, projectId: string): boolean {
  let countersigned = 0;
  for (const gate of ["entity_ic", "group_ic"]) {
    const d = latestProjectDecision(db, projectId, gate);
    if (!d || d.decision !== "go") continue;
    if (countersignState(db, projectId, d) !== "countersigned") return false;
    countersigned += 1;
  }
  return countersigned > 0;
}

function naReviewSatisfied(db: Database, projectId: string): boolean {
  const rows = db
    .query("SELECT checklist_id, item_id FROM project_checklist_item_state WHERE project_id = ? AND status = 'na' AND na_confirmed_by IS NULL")
    .all(projectId) as Array<{ checklist_id: string; item_id: string }>;
  return !rows.some((r) => isMandatoryChecklistItem(r.checklist_id, r.item_id));
}

function itemSatisfied(db: Database, projectId: string, key: ReconfirmItem): boolean {
  if (key === "wacc_confirmed") return resolveWaccConfirmation(db, projectId).confirmed;
  if (key === "ic_countersign") return icCountersignSatisfied(db, projectId);
  return naReviewSatisfied(db, projectId);
}

export function reconfirmStatus(db: Database, projectId: string): ReconfirmStatus | null {
  const row = openRequirement(db, projectId);
  if (!row) return null;
  let keys: ReconfirmItem[] = [];
  try {
    keys = (JSON.parse(row.items_json) as string[]).filter((k): k is ReconfirmItem => (RECONFIRM_ITEMS as readonly string[]).includes(k));
  } catch { /* an unreadable list is treated as all items */ }
  if (keys.length === 0) keys = [...RECONFIRM_ITEMS];
  const items = keys.map((key) => ({ key, satisfied: itemSatisfied(db, projectId, key) }));
  const unmet = items.filter((i) => !i.satisfied).map((i) => i.key);
  return { open: true, id: row.id, reason: row.reason, created_by: row.created_by, created_at: row.created_at, items, unmet, clearable: unmet.length === 0 };
}

/** Non-blocking notice for read / preparation responses (null when no requirement is open). */
export function reconfirmNotice(db: Database, projectId: string): { code: "reconfirmation_required"; unmet: ReconfirmItem[]; message: string } | null {
  const s = reconfirmStatus(db, projectId);
  if (!s) return null;
  return {
    code: "reconfirmation_required",
    unmet: s.unmet,
    message: s.unmet.length === 0
      ? "Legacy record: the re-confirmation items are satisfied; a person holding an IC reviewer grant still has to clear the requirement before new use."
      : `Legacy record: reconfirmation required before new use (${s.unmet.join(", ")}).`,
  };
}

/** The 409 for a GO / case adoption while the requirement is open; null when not applicable. */
export function reconfirmBlock(db: Database, projectId: string, what: { kind: "gate_decision"; gate: string; decision: string } | { kind: "case_adoption" }): IntegrityFailure | null {
  const s = reconfirmStatus(db, projectId);
  if (!s) return null;
  if (what.kind === "gate_decision") {
    if (what.decision !== "go") return null;
    if (isIcGate(what.gate) && s.unmet.length > 0 && s.unmet.every((k) => k === "ic_countersign")) return null;
  }
  return {
    status: 409,
    code: "reconfirmation_required",
    message: `This project is a legacy record that must be re-confirmed before new use. Unmet: ${s.unmet.length > 0 ? s.unmet.join(", ") : "none (a person holding an IC reviewer grant has to clear the requirement)"}. ${what.kind === "gate_decision" ? "HOLD or KILL can be recorded at any time." : ""}`.trim(),
    details: { requirement_id: s.id, unmet: s.unmet, items: s.items },
  };
}

export class ReconfirmError extends Error {
  constructor(readonly failure: IntegrityFailure) {
    super(failure.code);
  }
}

/** Resolve a project reference (internal md_project.id or human project_no) to the internal id. Never throws; callers format the error. */
export function resolveProjectRef(db: Database, ref: string): { ok: true; id: string; projectNo: string | null } | { ok: false; reason: "not_found" | "ambiguous" } {
  const rows = db.query("SELECT id, project_no FROM md_project WHERE id = ? OR project_no = ?").all(ref, ref) as { id: string; project_no: string | null }[];
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  if (rows.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, id: rows[0].id, projectNo: rows[0].project_no };
}

/** Open a requirement (admin route). One open requirement per project (409 reconfirm_exists). */
export function createRequirement(db: Database, input: { projectId: string; items: readonly string[]; reason: string; by: string; now: string }): ReconfirmRow {
  const fail = (status: IntegrityFailure["status"], code: string, message: string) => new ReconfirmError({ status, code, message });
  if (!db.query("SELECT id FROM md_project WHERE id = ?").get(input.projectId)) throw fail(404, "not_found", "Not found.");
  const items = [...new Set(input.items)];
  if (items.length === 0 || items.some((i) => !(RECONFIRM_ITEMS as readonly string[]).includes(i))) {
    throw fail(400, "invalid_request", `items must be a non-empty subset of ${RECONFIRM_ITEMS.join(" | ")}.`);
  }
  const check = validateRationale(input.reason, "ack");
  if (!check.ok) throw fail(422, "rationale_insufficient", `The reason does not meet the minimum substance profile (${check.reason}).`);
  if (openRequirement(db, input.projectId)) throw fail(409, "reconfirm_exists", "An open re-confirmation requirement already exists for this project.");
  const id = ulid();
  db.run("INSERT INTO project_reconfirm_requirement (id, project_id, items_json, reason, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, input.projectId, JSON.stringify(items), input.reason, input.by, input.now]);
  appendAudit(db, { actor: input.by, action: "reconfirm.create", target: `${input.projectId}:${id}`, now: input.now });
  return db.query("SELECT * FROM project_reconfirm_requirement WHERE id = ?").get(id) as ReconfirmRow;
}

/** Clear the open requirement. Runs in one immediate transaction; every refusal leaves no state change. */
export function clearRequirement(db: Database, input: { projectId: string; by: string; reason: string; now: string }): { id: string } {
  return db
    .transaction(() => {
      const fail = (status: IntegrityFailure["status"], code: string, message: string, details?: Record<string, unknown>) => new ReconfirmError({ status, code, message, details });
      if (!hasHumanRole(db, input.by, RECONFIRM_CLEAR_ROLES)) {
        throw fail(403, "human_role_required", `Clearing a re-confirmation requirement needs an active human-role grant (${RECONFIRM_CLEAR_ROLES.join(" | ")}); an administrator issues grants.`);
      }
      const s = reconfirmStatus(db, input.projectId);
      if (!s) throw fail(409, "reconfirm_not_open", "This project has no open re-confirmation requirement.");
      const makers = (db
        .query("SELECT DISTINCT decided_by FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate IN ('entity_ic', 'group_ic')")
        .all(input.projectId) as Array<{ decided_by: string }>).map((r) => r.decided_by);
      if (makers.includes(input.by)) {
        throw fail(403, "reconfirm_clearer_is_maker", "The person who recorded the project's investment committee decisions cannot clear its re-confirmation requirement.");
      }
      if (s.unmet.length > 0) throw fail(409, "reconfirm_items_unmet", `The re-confirmation items are not all satisfied yet: ${s.unmet.join(", ")}.`, { unmet: s.unmet });
      const check = validateRationale(input.reason, "ack");
      if (!check.ok) throw fail(422, "rationale_insufficient", `The clearing reason does not meet the minimum substance profile (${check.reason}).`, { field: "reason", reason: check.reason, profile: "ack" });
      db.run("UPDATE project_reconfirm_requirement SET cleared_by = ?, cleared_at = ?, clear_reason = ? WHERE id = ?", [input.by, input.now, input.reason, s.id]);
      appendAudit(db, { actor: input.by, action: "reconfirm.clear", target: `${input.projectId}:${s.id}`, now: input.now });
      return { id: s.id };
    })
    .immediate();
}
