// @version 1.0.0
/**
 * WACC / hurdle confirmation state of a project - ADR-0186 D8 (family `wacc`).
 *
 * ONE reader for "is the discount rate human-confirmed", shared by the S8 completion rule, the `fs` GO hard block,
 * the gate snapshot `wacc` section and the `provisional` label on valuation outputs, so the four cannot drift.
 *
 * Confirmed = ALL of:
 *   - md_project.wacc_subject is set (the WACC application subject; bf-13 for brownfield, where it is the target),
 *   - the latest `wacc` assumption in scope has kind='user',
 *   - the latest `hurdle_irr` assumption in scope has kind='user'.
 *
 * Scope: see rateScopeState (one shared rule, picked once, latest row of any kind governs, no fallback). Sessions of
 * other shortlisted targets never count. Greenfield has no selection, so the project-level session is read.
 */
import type { Database } from "bun:sqlite";
import { isWaccSubject, listProjectAnalysisTargets } from "./wacc.ts";

export type WaccKeyState = "user" | "assumed" | "absent";
export type WaccMissingItem = "wacc_subject" | "wacc" | "hurdle_irr";

export interface WaccConfirmation {
  confirmed: boolean;
  /** `confirmed` only when subject, WACC and hurdle are all human-confirmed. */
  status: "confirmed" | "provisional";
  subject: string | null;
  wacc: WaccKeyState;
  hurdle_irr: WaccKeyState;
  /** The fin.wacc_source_status reading: absent (no rows) | assumed (any non-user row, or one key missing) | sourced. */
  source_status: "sourced" | "assumed" | "absent";
  missing: WaccMissingItem[];
  /** Why provisional: wacc_unconfirmed, or wacc_subject_not_target (a per-target session needs subject = target, bf-13). */
  reason: "wacc_unconfirmed" | "wacc_subject_not_target" | null;
  wacc_value: number | null;
  hurdle_value: number | null;
  scope: { kind: "project" | "target"; subject_company_id: string | null };
}

/** Company of the target the human selected at S8 (brownfield); null when none is selected or it has no analysable company. */
export function selectedTargetCompanyId(db: Database, projectId: string): string | null {
  const row = db
    .query(
      `SELECT meta_json FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_target_select' AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as { meta_json: string | null } | null;
  if (!row?.meta_json) return null;
  let targetId: string | null = null;
  try { targetId = (JSON.parse(row.meta_json) as { target_id?: string }).target_id ?? null; } catch { return null; }
  if (!targetId) return null;
  return listProjectAnalysisTargets(db, projectId).find((t) => t.targetId === targetId)?.companyId ?? null;
}

export interface RateRow { kind: string; value: number }

/** Latest row of ANY kind for one key in one exact scope (companyId null = project level). */
export function latestRateRow(db: Database, projectId: string, key: "wacc" | "hurdle_irr", companyId: string | null): RateRow | null {
  return (
    (db
      .query(
        `SELECT a.kind, a.value FROM assumption a JOIN run r ON r.id = a.run_id
         WHERE r.project_id = ? AND a.assumption_key = ? AND r.subject_company_id IS ?
         ORDER BY a.as_of DESC, a.id DESC LIMIT 1`,
      )
      .get(projectId, key, companyId) as RateRow | null) ?? null
  );
}

export interface RateScopeState {
  scope: "project" | "target";
  wacc: RateRow | null;
  hurdle_irr: RateRow | null;
}

/**
 * THE shared scope rule (filler and resolveWaccConfirmation). The scope is picked ONCE: the target's scope when the
 * target has a row of either key there, else the project scope. Within the picked scope the latest row of ANY kind
 * governs - a non-user row is "not confirmed" and never falls back to an older user row or to the project scope.
 */
export function rateScopeState(db: Database, projectId: string, companyId: string | null): RateScopeState {
  if (companyId) {
    const w = latestRateRow(db, projectId, "wacc", companyId);
    const h = latestRateRow(db, projectId, "hurdle_irr", companyId);
    if (w || h) return { scope: "target", wacc: w, hurdle_irr: h };
  }
  return { scope: "project", wacc: latestRateRow(db, projectId, "wacc", null), hurdle_irr: latestRateRow(db, projectId, "hurdle_irr", null) };
}

export function resolveWaccConfirmation(db: Database, projectId: string): WaccConfirmation {
  const proj = db.query("SELECT wacc_subject FROM md_project WHERE id = ?").get(projectId) as { wacc_subject: string | null } | null;
  const subject = proj?.wacc_subject && isWaccSubject(proj.wacc_subject) ? proj.wacc_subject : null;
  const companyId = selectedTargetCompanyId(db, projectId);
  const sc = rateScopeState(db, projectId, companyId);
  const st = (r: RateRow | null): WaccKeyState => (r === null ? "absent" : r.kind === "user" ? "user" : "assumed");
  const wacc = st(sc.wacc);
  const hurdle = st(sc.hurdle_irr);
  const missing: WaccMissingItem[] = [];
  let reason: WaccConfirmation["reason"] = null;
  if (!subject) missing.push("wacc_subject");
  // bf-13: a per-target (brownfield) session discounts at the target's risk, so the recorded subject must be `target`.
  else if (sc.scope === "target" && subject !== "target") { missing.push("wacc_subject"); reason = "wacc_subject_not_target"; }
  if (wacc !== "user") missing.push("wacc");
  if (hurdle !== "user") missing.push("hurdle_irr");
  if (missing.length > 0 && reason === null) reason = "wacc_unconfirmed";
  const source_status: WaccConfirmation["source_status"] =
    wacc === "absent" && hurdle === "absent" ? "absent" : wacc === "user" && hurdle === "user" ? "sourced" : "assumed";
  const confirmed = missing.length === 0;
  return {
    confirmed,
    status: confirmed ? "confirmed" : "provisional",
    subject,
    wacc,
    hurdle_irr: hurdle,
    source_status,
    missing,
    reason,
    wacc_value: sc.wacc?.value ?? null,
    hurdle_value: sc.hurdle_irr?.value ?? null,
    scope: { kind: sc.scope, subject_company_id: sc.scope === "target" ? companyId : null },
  };
}
