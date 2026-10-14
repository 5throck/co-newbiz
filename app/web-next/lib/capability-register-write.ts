// The single wrapper for writing opportunity.capability_gap_json rows (ADR-0170),
// next to serializeGapRegister (ADR-0169). Every writer of the register ROWS goes
// through here so S3-side changes invalidate S8 judgements (moved to history, never
// deleted), deleted rows are archived, and the events are audited under the calling
// user (boundary #1: agents have no account of their own).
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import type { CapabilityGapRow } from "./capability-gap.ts";
import { applyRegisterLinkage, type LinkageResult } from "./capability-linkage.ts";
import { serializeGapRegister } from "./technical-lens.ts";

export interface RegisterWriteResult extends LinkageResult { json: string }

/** Serialize + store + audit the invalidation events. Call inside the caller's transaction if it has one. */
export function persistGapRegister(db: Database, opportunityId: string, rows: CapabilityGapRow[], at: string, actor: string): RegisterWriteResult {
  const storedJson = (db.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(opportunityId) as { j: string | null } | null)?.j ?? null;
  const linked = applyRegisterLinkage(rows, storedJson, at, actor);
  const json = serializeGapRegister(linked.rows, at, storedJson, undefined, linked.removed);
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json, opportunityId]);
  if (linked.invalidated.length > 0) {
    appendAudit(db, { actor, action: "capability_attainability.invalidate", target: `${opportunityId}#capability-stale:${linked.invalidated.join(",")}`, now: at });
  }
  if (linked.archived.length > 0) {
    appendAudit(db, { actor, action: "capability_attainability.archive_removed", target: `${opportunityId}#capability-removed:${linked.archived.join(",")}`, now: at });
  }
  for (const rowId of linked.trimmed) {
    appendAudit(db, { actor, action: "capability_attainability.history_trim", target: `${opportunityId}#capability@${rowId}`, now: at });
  }
  return { ...linked, json };
}
