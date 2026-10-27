// Condition precedents on the gate paths - ADR-0186 D4, design 3.4 (migration 0175).
//
// A condition precedent is a tracked object attached to an IC GO (entity_ic / group_ic) or to its
// countersign. Rules, all under family `validators`:
//   - open `group_ic` conditions block the group_ic GO (409 condition_open);
//   - open `establishment` / `closing` conditions keep S11 incomplete and block the execution-baseline
//     confirmation and the establishment completion step (never a defaulted pass);
//   - an acknowledged `mark_conditional` kill result auto-creates a `closing` condition (D1 table);
//   - the IC package lists every open condition and the snapshot carries them (conditions_open).
// Clearing is a separate human act (routes/projects/[id]/conditions/...): a different person holding an IC
// reviewer grant, cookie session only.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { CLEAR_BY, openConditions, type ClearBy, type ConditionRow, type NewCondition } from "../../../db/repositories/condition-precedent.repository.ts";
import { badRequest, fail } from "./envelope.ts";
import type { IntegrityFailure } from "./gate-integrity.ts";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";
import { validateRationale } from "./rationale-check.ts";

export const MAX_CONDITIONS = 20;
const MAX_CONDITION_TEXT = 1000;

/** Whether open conditions block (family `validators` = enforce). Shadow audits where the gate path can, never in read paths. */
export function conditionsEnforced(): boolean {
  return gateIntegrityMode("validators") === "enforce";
}

/**
 * Parse `conditions[]` of an IC GO / countersign. Shape errors are a 400 whatever the flag mode. Each text
 * meets the ack substance profile (D2). `group_ic` conditions only make sense on an entity_ic decision (a
 * group_ic GO is itself the sitting they wait for).
 */
export function parseConditionsInput(
  raw: unknown,
  gate: string,
  origin: NewCondition["origin"] = "recorder",
): { ok: true; items: NewCondition[] } | { ok: false; response: Response } {
  if (raw === undefined || raw === null) return { ok: true, items: [] };
  const bad = (message: string) => ({ ok: false as const, response: badRequest("invalid_request", message) });
  if (gate !== "entity_ic" && gate !== "group_ic") return bad("conditions can be attached to an entity_ic or group_ic decision only.");
  if (!Array.isArray(raw) || raw.length > MAX_CONDITIONS) return bad(`conditions must be an array of at most ${MAX_CONDITIONS} entries.`);
  const items: NewCondition[] = [];
  for (const entry of raw as unknown[]) {
    const c = entry as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || typeof c.text !== "string" || !c.text.trim()) return bad("each condition must be { text: string, clear_by: group_ic | establishment | closing, owner_role?: string }.");
    if (typeof c.clear_by !== "string" || !(CLEAR_BY as readonly string[]).includes(c.clear_by)) return bad(`clear_by must be one of ${CLEAR_BY.join(" | ")}.`);
    if (c.owner_role !== undefined && c.owner_role !== null && typeof c.owner_role !== "string") return bad("owner_role must be a string.");
    if (gate === "group_ic" && c.clear_by === "group_ic") return bad("a group_ic decision cannot carry a condition that waits for the group_ic sitting; use establishment or closing.");
    const text = c.text.trim().slice(0, MAX_CONDITION_TEXT);
    const check = validateRationale(text, "ack");
    if (!check.ok) {
      return {
        ok: false,
        response: fail(422, "rationale_insufficient", `A condition text does not meet the minimum substance profile (${check.reason}).`, { field: "conditions", reason: check.reason, profile: "ack" }),
      };
    }
    items.push({ text, clear_by: c.clear_by as ClearBy, owner_role: (c.owner_role as string | null | undefined)?.trim().slice(0, 120) || null, origin });
  }
  return { ok: true, items };
}

/** group_ic GO: open conditions that wait for the group_ic sitting (failure for applyFamily). */
export function groupIcConditionFailure(db: Database, projectId: string): IntegrityFailure | null {
  const open = openConditions(db, projectId, ["group_ic"]);
  if (open.length === 0) return null;
  return {
    status: 409,
    code: "condition_open",
    message: `GO is not allowed - ${open.length} open condition precedent(s) must be cleared before the group_ic decision.`,
    details: { conditions: open.map((c) => ({ id: c.id, text: c.text, clear_by: c.clear_by })) },
  };
}

/** Open establishment / closing conditions (the S11 completion blockers). */
export function s11OpenConditions(db: Database, projectId: string): ConditionRow[] {
  return openConditions(db, projectId, ["establishment", "closing"]);
}

/** S11 blockers - empty unless family `validators` = enforce. */
export function s11ConditionBlockers(projectId: string, db: Database = getDb()): { blockers: string[]; missing: string[] } {
  if (!conditionsEnforced()) return { blockers: [], missing: [] };
  const open = s11OpenConditions(db, projectId);
  if (open.length === 0) return { blockers: [], missing: [] };
  return {
    blockers: [`${open.length} open condition precedent(s) from the investment committee must be cleared: ${open.slice(0, 3).map((c) => c.text.slice(0, 40)).join("; ")}${open.length > 3 ? " ..." : ""}`],
    missing: ["IC condition precedents cleared"],
  };
}
