// Enforce-readiness of the maker/checker contract - ADR-0186 O-1 (security review J5).
//
// Maker/checker is only satisfiable when at least TWO distinct people hold each IC reviewer role: with one holder, the
// recorder of a decision who is also the only grant holder can never be its checker and the gate deadlocks. Reported
// (never enforced) by GET /api/admin/human-roles/readiness and as a one-line boot warning when
// CO_NEWBIZ_GATE_INTEGRITY_MAKER_CHECKER=enforce.
import type { Database } from "bun:sqlite";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";

export const READINESS_ROLES = ["entity-ic-reviewer", "group-ic-reviewer"] as const;
export const MIN_HOLDERS = 2;

export interface MakerCheckerReadiness {
  mode: "off" | "shadow" | "enforce";
  /** True when every IC reviewer role has at least MIN_HOLDERS distinct active holders. */
  ready: boolean;
  roles: Array<{ role: string; active_holders: number; required: number; ok: boolean }>;
  /** Non-empty when mode = enforce and the contract cannot be satisfied (the warning text). */
  warnings: string[];
}

export function makerCheckerReadiness(db: Database): MakerCheckerReadiness {
  const mode = gateIntegrityMode("maker_checker");
  const roles = READINESS_ROLES.map((role) => {
    const n = (db.query("SELECT COUNT(DISTINCT user_id) AS c FROM app_user_human_role WHERE role_key = ? AND revoked_at IS NULL").get(role) as { c: number }).c;
    return { role, active_holders: n, required: MIN_HOLDERS, ok: n >= MIN_HOLDERS };
  });
  const ready = roles.every((r) => r.ok);
  const warnings =
    mode === "enforce" && !ready
      ? roles.filter((r) => !r.ok).map((r) => `maker_checker=enforce but ${r.role} has ${r.active_holders} active holder(s); at least ${MIN_HOLDERS} distinct people are needed or the gate cannot be countersigned.`)
      : [];
  return { mode, ready, roles, warnings };
}
