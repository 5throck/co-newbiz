// @version 1.0.0
/**
 * Certification repository — the single write path for `certification` rows
 * (the read side used by deal-review stays where it is; this file owns
 * writes so the boundary below holds for every caller: routes, MCP, CLI).
 *
 * LAYERING (design of record 2026-08-22, overturn 7 / non-negotiable
 * boundary #5 — inference is explicitly disallowed for certification
 * transferability on change of control):
 *   - the DB CHECK (migration 0012) constrains transferability_basis to the
 *     enum ('verified','inferred') — 'inferred' is LEGAL at the database
 *     level by design, because the DB's job is to record the basis;
 *   - THIS layer refuses to circulate an inference: any write whose
 *     resulting row has transferability_basis='inferred' throws, and
 *     'verified' without a transferability_evidence_ref is rejected as an
 *     unsupported claim.
 * A gate-time kill criterion alone would leave inferred values circulating
 * between write time and gate evaluation — the boundary is not a
 * delayed-permission rule, hence the hard block at the write path.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

export interface CertificationRow {
  id: string;
  project_id: string;
  name: string;
  agency: string | null;
  statutory_days: number | null;
  status: string;
  transferability_basis: "verified" | "inferred" | null;
  transferable_on_coc: string | null;
  transferability_evidence_ref: string | null;
  load_bearing: number;
  confirmed_at: string | null;
}

export interface CreateCertificationInput {
  project_id: string;
  name: string;
  agency?: string | null;
  statutory_days?: number | null;
  status?: string;
  transferability_basis?: "verified" | "inferred" | null;
  transferable_on_coc?: string | null;
  transferability_evidence_ref?: string | null;
  load_bearing?: boolean;
  confirmed_at?: string | null;
}

export interface TransferabilityUpdate {
  transferability_basis?: "verified" | "inferred" | null;
  transferable_on_coc?: string | null;
  transferability_evidence_ref?: string | null;
  load_bearing?: boolean;
  confirmed_at?: string | null;
}

/**
 * Non-negotiable boundary #5, write-time form. Throws — never returns a
 * fallback — because "inferred" must not exist in circulation at all, and a
 * 'verified' claim without its evidence reference is unsupported.
 */
function assertTransferabilityBoundary(basis: unknown, evidenceRef: unknown): void {
  if (basis === "inferred") {
    throw new Error(
      "non-negotiable boundary #5: certification transferability on change of control cannot be written as 'inferred' — inference is disallowed (design of record 2026-08-22, overturn 7). Confirm against the certifying body's own rules and write transferability_basis='verified' with a transferability_evidence_ref citing them."
    );
  }
  if (basis === "verified" && (typeof evidenceRef !== "string" || evidenceRef.trim() === "")) {
    throw new Error(
      "transferability_basis='verified' requires a non-empty transferability_evidence_ref — a verification without its evidence reference is an unsupported claim (non-negotiable boundary #5)."
    );
  }
}

const SELECT_ROW = `SELECT id, project_id, name, agency, statutory_days, status,
  transferability_basis, transferable_on_coc, transferability_evidence_ref,
  load_bearing, confirmed_at FROM certification WHERE id = ?`;

export function createCertification(input: CreateCertificationInput): CertificationRow {
  assertTransferabilityBoundary(input.transferability_basis ?? null, input.transferability_evidence_ref ?? null);
  const db = getDb();
  const id = ulid();
  db.run(
    `INSERT INTO certification
       (id, project_id, name, agency, statutory_days, status,
        transferability_basis, transferable_on_coc, transferability_evidence_ref,
        load_bearing, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project_id,
      input.name,
      input.agency ?? null,
      input.statutory_days ?? null,
      input.status ?? "not_started",
      input.transferability_basis ?? null,
      input.transferable_on_coc ?? null,
      input.transferability_evidence_ref ?? null,
      input.load_bearing ? 1 : 0,
      input.confirmed_at ?? null,
    ]
  );
  return db.query(SELECT_ROW).get(id) as CertificationRow;
}

/**
 * Updates only the transferability-related columns. The boundary guard runs
 * against the RESULTING row state (current row merged with the update), so
 * 'verified' cannot be written first and its evidence_ref stripped in a
 * later update — and an 'inferred' basis can never land here at all.
 * Throws when the id does not exist (an update to nothing is a bug in the
 * caller, not a silent no-op).
 */
export function updateTransferability(id: string, update: TransferabilityUpdate): CertificationRow {
  const db = getDb();
  const current = db.query(SELECT_ROW).get(id) as CertificationRow | undefined;
  if (!current) {
    throw new Error(`certification '${id}' not found — cannot update transferability`);
  }

  const effectiveBasis =
    update.transferability_basis !== undefined ? update.transferability_basis : current.transferability_basis;
  const effectiveRef =
    update.transferability_evidence_ref !== undefined
      ? update.transferability_evidence_ref
      : current.transferability_evidence_ref;
  assertTransferabilityBoundary(effectiveBasis, effectiveRef);

  const cols: string[] = [];
  const vals: unknown[] = [];
  const provided: Record<string, unknown> = {
    transferability_basis: update.transferability_basis,
    transferable_on_coc: update.transferable_on_coc,
    transferability_evidence_ref: update.transferability_evidence_ref,
    load_bearing: update.load_bearing === undefined ? undefined : update.load_bearing ? 1 : 0,
    confirmed_at: update.confirmed_at,
  };
  for (const [k, v] of Object.entries(provided)) {
    if (v !== undefined) {
      cols.push(k);
      vals.push(v);
    }
  }
  if (cols.length > 0) {
    db.run(
      `UPDATE certification SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      [...vals, id] as never[]
    );
  }
  return db.query(SELECT_ROW).get(id) as CertificationRow;
}
