// @version 1.0.0
/**
 * Assumption registry write path — design v1.0 §4-4, FR-DATA-07.
 *
 * The single validation + insert used by BOTH the REST route
 * (POST /api/assumptions) and the `assume` CLI case, so the two can never
 * drift on the rules that matter: the kind enum, finite value, mandatory
 * as_of, and kind='assumed' requiring a non-empty rationale. The DB CHECK
 * behind the last rule stays as the second line of defense — this layer
 * refuses first with a precise message instead of a constraint error.
 *
 * Validation failures throw AssumptionValidationError carrying the HTTP
 * error code the REST surface maps to (the SimulationInputError pattern);
 * a missing run throws a plain Error, matching createRun's "not found"
 * convention on the CLI side.
 */

import type { Database } from "bun:sqlite";
import { appendAudit } from "./access-control.ts";
import { ulid } from "./ulid.ts";

export const ASSUMPTION_KINDS = new Set(["live", "user", "derived", "assumed"]);

export class AssumptionValidationError extends Error {
  constructor(
    public readonly code: "invalid_request" | "rationale_required",
    message: string,
  ) {
    super(message);
  }
}

export interface RecordAssumptionOptions {
  runId: string;
  assumptionKey: string;
  kind: string;
  value: number;
  /** ISO-8601 date the assumption is effective as of. */
  asOf: string;
  rationale?: string;
  anchorRef?: string | null;
  /** Integer TTL in days; null when the assumption carries none. */
  ttlDays?: number | null;
  /** Audit actor — the HTTP user id or "cli". */
  actor: string;
  now: string;
}

export interface AssumptionRow {
  id: string;
  run_id: string;
  assumption_key: string;
  kind: string;
  value: number;
  rationale: string | null;
  anchor_ref: string | null;
  as_of: string;
  ttl_days: number | null;
}

export function recordAssumption(db: Database, options: RecordAssumptionOptions): AssumptionRow {
  if (!ASSUMPTION_KINDS.has(options.kind)) {
    throw new AssumptionValidationError(
      "invalid_request",
      `kind must be one of ${[...ASSUMPTION_KINDS].join("|")}.`,
    );
  }
  if (typeof options.value !== "number" || !Number.isFinite(options.value)) {
    throw new AssumptionValidationError("invalid_request", "value must be a number.");
  }
  if (!options.asOf?.trim()) {
    throw new AssumptionValidationError("invalid_request", "as_of is required (ISO-8601 date).");
  }
  const rationale = options.rationale?.trim() ?? "";
  if (options.kind === "assumed" && !rationale) {
    throw new AssumptionValidationError(
      "rationale_required",
      "kind='assumed' requires a non-empty rationale (FR-DATA-07) — the DB CHECK backs this, but it is refused here first.",
    );
  }
  const run = db.query("SELECT id FROM run WHERE id = ?").get(options.runId);
  if (!run) throw new Error(`run '${options.runId}' not found`);

  const row: AssumptionRow = {
    id: ulid(),
    run_id: options.runId,
    assumption_key: options.assumptionKey,
    kind: options.kind,
    value: options.value,
    rationale: rationale || null,
    anchor_ref: options.anchorRef?.trim() || null,
    as_of: options.asOf.trim(),
    ttl_days: Number.isInteger(options.ttlDays) ? options.ttlDays! : null,
  };
  // A raw INSERT failure (e.g. the FR-DATA-07 CHECK racing a concurrent
  // writer) bubbles up as-is: the REST route maps it to 400
  // assumption_rejected, the CLI prints the message — never a 500.
  db.run(
    `INSERT INTO assumption (id, run_id, assumption_key, kind, value, rationale, anchor_ref, as_of, ttl_days)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [row.id, row.run_id, row.assumption_key, row.kind, row.value, row.rationale, row.anchor_ref, row.as_of, row.ttl_days],
  );
  appendAudit(db, {
    actor: options.actor,
    action: "assumption_set",
    target: `${row.run_id}:${row.assumption_key}:${row.kind}`,
    now: options.now,
  });
  return row;
}
