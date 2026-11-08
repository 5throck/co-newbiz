// @version 1.0.1
/**
 * opportunity-deal-shape.repository.ts - the opportunity-scope deal-shape evaluation (ADR-0194 item A, migration 0188; hosted at S7, brownfield only, since 2026-11-08 / ADR-0195 - it was the S4 screen).
 *
 * One row = one HUMAN verdict on one deal shape for one opportunity. Append-only with a superseded_by chain
 * (ADR-0005 / FR-DATA-10): one LIVE row per (opportunity, shape); re-recording a shape inserts a new live row and
 * supersedes the old one in the same transaction, so history stays attributable. Nothing is ever deleted.
 *
 * Kill criterion #9 (deal-shape-chain:no_viable_deal_shape, brownfield-only, opportunity target_screening) reads `summarizeLiveDealShapes`.
 * Risk-officer A-1: only live rows written through `recordDealShapeEvaluation` count - no score, route decision,
 * route recommendation or LLM-draft path reaches this table or this summary. A-2: the vocabulary has no "not yet
 * evaluated" state (viable is 0|1, CHECK-enforced), so an unevaluated shape is simply the absence of a live row;
 * no live rows at all means the variable is MISSING (the criterion reads unassessed), never a recorded zero.
 */
import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";

/** Byte-identical to the deal_shape_evaluation CHECK vocabulary (0026/0033). Promotion to md_deal_shape is recorded debt (ADR-0194 O-A3). */
export const DEAL_SHAPES = [
  "full_acquisition",
  "majority_stake",
  "spv",
  "holdco_route",
  "joint_venture",
  "minority_stake",
  "license_in",
  "co_development",
] as const;
export const DEAL_SHAPE_INTENTS = ["integration", "capability_access"] as const;
export type DealShape = (typeof DEAL_SHAPES)[number];
export type DealShapeIntent = (typeof DEAL_SHAPE_INTENTS)[number];

export const RATIONALE_MAX = 2000;
export const EVIDENCE_REF_MAX = 2000;

export interface DealShapeEvaluationRow {
  id: string;
  opportunity_id: string;
  shape: DealShape;
  intent: DealShapeIntent;
  viable: boolean;
  rationale: string;
  evidence_ref: string | null;
  evaluated_by: string;
  evaluated_at: string;
  superseded_by: string | null;
}

export interface RecordDealShapeInput {
  opportunityId: string;
  shape: unknown;
  intent: unknown;
  viable: unknown;
  rationale: unknown;
  evidenceRef?: unknown;
  /** The calling human's user id, taken from the session by the route - never from a request body. */
  evaluatedBy: string;
  now: string;
}

/** `invalid` = request shape/vocabulary problem (route: 400 invalid_request); `opportunity_not_found` = route: 404. */
export class DealShapeError extends Error {
  constructor(
    readonly kind: "invalid" | "opportunity_not_found",
    message: string,
  ) {
    super(message);
    this.name = "DealShapeError";
  }
}

interface RawRow extends Omit<DealShapeEvaluationRow, "viable"> {
  viable: number;
}
const COLUMNS =
  "id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by";
const toRow = (r: RawRow): DealShapeEvaluationRow => ({ ...r, viable: r.viable === 1 });

function parseViable(v: unknown): 0 | 1 | null {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  return null;
}

/**
 * Record (or re-record) one shape verdict. Validates the closed vocabularies and the required rationale, requires the
 * opportunity to exist, and supersedes the shape's previous live row atomically. Returns the new live row.
 */
export function recordDealShapeEvaluation(db: Database, input: RecordDealShapeInput): DealShapeEvaluationRow {
  const shape = typeof input.shape === "string" ? input.shape : "";
  if (!(DEAL_SHAPES as readonly string[]).includes(shape))
    throw new DealShapeError("invalid", `shape must be one of: ${DEAL_SHAPES.join(" | ")}.`);
  const intent = typeof input.intent === "string" ? input.intent : "";
  if (!(DEAL_SHAPE_INTENTS as readonly string[]).includes(intent))
    throw new DealShapeError("invalid", `intent must be one of: ${DEAL_SHAPE_INTENTS.join(" | ")}.`);
  const viable = parseViable(input.viable);
  if (viable === null)
    throw new DealShapeError("invalid", "viable must be a boolean (true = viable, false = not viable).");
  const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
  if (!rationale)
    throw new DealShapeError("invalid", "rationale is required: the written feedback behind every verdict.");
  if (rationale.length > RATIONALE_MAX)
    throw new DealShapeError("invalid", `rationale must be at most ${RATIONALE_MAX} characters.`);
  let evidenceRef: string | null = null;
  if (input.evidenceRef !== undefined && input.evidenceRef !== null) {
    if (typeof input.evidenceRef !== "string") throw new DealShapeError("invalid", "evidence_ref must be a string.");
    evidenceRef = input.evidenceRef.trim() || null;
    if (evidenceRef && evidenceRef.length > EVIDENCE_REF_MAX)
      throw new DealShapeError("invalid", `evidence_ref must be at most ${EVIDENCE_REF_MAX} characters.`);
  }
  if (!input.evaluatedBy) throw new DealShapeError("invalid", "A verdict needs the calling user's identity.");

  const id = ulid();
  const write = db.transaction(() => {
    if (!db.query("SELECT 1 AS x FROM opportunity WHERE id = ?").get(input.opportunityId)) {
      throw new DealShapeError("opportunity_not_found", "Opportunity not found.");
    }
    // superseded_by points at a row inserted next; the unique live index forbids two live rows, so the old row is
    // taken out of the live set first. The self-FK is therefore checked at commit, not per statement.
    db.run("PRAGMA defer_foreign_keys = ON");
    db.run(
      "UPDATE opportunity_deal_shape_evaluation SET superseded_by = ? WHERE opportunity_id = ? AND shape = ? AND superseded_by IS NULL",
      [id, input.opportunityId, shape],
    );
    db.run(
      `INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by)
       VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
      [id, input.opportunityId, shape, intent, viable, rationale, evidenceRef, input.evaluatedBy, input.now],
    );
  });
  write();
  return toRow(db.query(`SELECT ${COLUMNS} FROM opportunity_deal_shape_evaluation WHERE id = ?`).get(id) as RawRow);
}

/** Live (one per shape, canonical shape order) and superseded history (newest first) for one opportunity. */
export function listDealShapeEvaluations(
  db: Database,
  opportunityId: string,
): { live: DealShapeEvaluationRow[]; history: DealShapeEvaluationRow[] } {
  const rows = (
    db
      .query(
        `SELECT ${COLUMNS} FROM opportunity_deal_shape_evaluation WHERE opportunity_id = ? ORDER BY evaluated_at DESC, id DESC`,
      )
      .all(opportunityId) as RawRow[]
  ).map(toRow);
  const order = (s: DealShape) => DEAL_SHAPES.indexOf(s);
  return {
    live: rows.filter((r) => r.superseded_by === null).sort((a, b) => order(a.shape) - order(b.shape)),
    history: rows.filter((r) => r.superseded_by !== null),
  };
}

export interface LiveDealShapeSummary {
  /** Live rows recorded (viable or not). */
  recorded: number;
  /** Live rows with viable = 1: the value of dealshape.viable_shapes. */
  viable: number;
  /** MAX(evaluated_at) over the live rows. */
  latestAt: string;
}

/**
 * The count behind dealshape.viable_shapes at opportunity scope. null = no live row recorded: the variable is missing
 * and the criterion reads unassessed (never present 0). A recorded set with zero viable rows is { viable: 0 }.
 */
export function summarizeLiveDealShapes(db: Database, opportunityId: string): LiveDealShapeSummary | null {
  const r = db
    .query(
      "SELECT COUNT(*) AS recorded, COALESCE(SUM(viable),0) AS viable, MAX(evaluated_at) AS latest FROM opportunity_deal_shape_evaluation WHERE opportunity_id = ? AND superseded_by IS NULL",
    )
    .get(opportunityId) as { recorded: number; viable: number; latest: string | null };
  if (r.recorded === 0) return null;
  return { recorded: r.recorded, viable: r.viable, latestAt: r.latest ?? "" };
}
