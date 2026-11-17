// @version 2.0.0
/**
 * opportunity-deal-shape.repository.ts - the opportunity-scope deal-shape evaluation (ADR-0194 item A, migration 0188; hosted at S7,
 * brownfield only, ADR-0195). Reshaped by ADR-0201 / migration 0198: overall viability first.
 *
 * One table, two row kinds. A SHAPE row (shape + intent set) = a HUMAN verdict "this shape is viable" (legacy rows may hold
 * viable = 0). An OVERALL row (shape NULL, intent NULL, viable 0) = "no shape is viable". There is no overall-viable row: overall
 * viable means one or more live shape rows. The live set is one overall row OR one or more shape rows, never both; every write
 * replaces the whole live set in one transaction (append-only superseded_by chain, ADR-0005 / FR-DATA-10 - nothing is deleted).
 * The mutual exclusivity spans rows, so it is enforced here and pinned by a test, not by a trigger.
 *
 * Kill criterion #9 (deal-shape-chain:no_viable_deal_shape, brownfield-only, opportunity target_screening) reads
 * `summarizeLiveDealShapes` (COUNT of live rows / SUM(viable), SQL unchanged): an overall row = recorded 1, viable 0 (triggered);
 * an empty live set = null (the variable is MISSING, unassessed - never a recorded zero). Risk-officer A-1: only a person's write
 * through this module reaches the table; no score, route decision, recommendation or LLM-draft path writes here.
 *
 * Optimistic concurrency: a write replaces the set, so it must carry the `live_token` of the set the person was looking at; a
 * missing or stale token throws DealShapeError("stale") (route: 409 deal_shape_stale) instead of silently dropping a colleague's verdict.
 */
import { createHash } from "node:crypto";
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

export const MAX_SHAPES = DEAL_SHAPES.length;

/** shape and intent are both null on an overall "no shape is viable" row. */
export interface DealShapeEvaluationRow {
  id: string;
  opportunity_id: string;
  shape: DealShape | null;
  intent: DealShapeIntent | null;
  viable: boolean;
  rationale: string;
  evidence_ref: string | null;
  evaluated_by: string;
  evaluated_at: string;
  superseded_by: string | null;
}

interface WriteBase {
  opportunityId: string;
  /** The live_token of the set the person last read (GET). Required: a replace-the-set write must not be blind. */
  liveToken: unknown;
  /** The calling human's user id, taken from the session by the route - never from a request body. */
  evaluatedBy: string;
  now: string;
  /** Runs INSIDE the write transaction after the rows are written (only when something changed): a throw rolls the whole write back. Used for the audit entry. */
  onWrite?: (result: DealShapeWriteResult) => void;
}
export interface RecordOverallNotViableInput extends WriteBase {
  rationale: unknown;
  evidenceRef?: unknown;
}
export interface RecordViableShapesInput extends WriteBase {
  intent: unknown;
  shapes: unknown;
}
export interface DealShapeWriteResult {
  /** The new live rows (one overall row, or the viable shape rows in canonical order). Empty when nothing changed. */
  rows: DealShapeEvaluationRow[];
  /** Ids of the previously live rows that were superseded. */
  superseded: string[];
  /** false = the submitted set was identical to the live set and nothing was written. */
  changed: boolean;
}

/**
 * `invalid` = request shape/vocabulary problem (route: 400 invalid_request, `details` names field/shape);
 * `stale` = missing/outdated live_token (route: 409 deal_shape_stale, `details.live_token` = the current token);
 * `opportunity_not_found` = route: 404.
 */
export class DealShapeError extends Error {
  constructor(
    readonly kind: "invalid" | "stale" | "opportunity_not_found",
    message: string,
    readonly details: Record<string, unknown> = {},
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
const shapeOrder = (s: DealShape | null) => (s === null ? -1 : DEAL_SHAPES.indexOf(s));

/** The first 16 hex chars of sha256 over the sorted live row ids (an empty live set hashes the empty string). */
export function computeLiveToken(liveIds: readonly string[]): string {
  return createHash("sha256")
    .update([...liveIds].sort().join(","))
    .digest("hex")
    .slice(0, 16);
}

function readLive(db: Database, opportunityId: string): DealShapeEvaluationRow[] {
  return (
    db
      .query(
        `SELECT ${COLUMNS} FROM opportunity_deal_shape_evaluation WHERE opportunity_id = ? AND superseded_by IS NULL`,
      )
      .all(opportunityId) as RawRow[]
  )
    .map(toRow)
    .sort((a, b) => shapeOrder(a.shape) - shapeOrder(b.shape));
}

export function getLiveToken(db: Database, opportunityId: string): string {
  return computeLiveToken(readLive(db, opportunityId).map((r) => r.id));
}

function cleanRationale(v: unknown, field: string, details: Record<string, unknown> = {}): string {
  const rationale = typeof v === "string" ? v.trim() : "";
  if (!rationale)
    throw new DealShapeError("invalid", "rationale is required: the written feedback behind every verdict.", {
      field,
      ...details,
    });
  if (rationale.length > RATIONALE_MAX)
    throw new DealShapeError("invalid", `rationale must be at most ${RATIONALE_MAX} characters.`, { field, ...details });
  return rationale;
}

function cleanEvidence(v: unknown, details: Record<string, unknown> = {}): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new DealShapeError("invalid", "evidence_ref must be a string.", { field: "evidence_ref", ...details });
  const evidence = v.trim() || null;
  if (evidence && evidence.length > EVIDENCE_REF_MAX)
    throw new DealShapeError("invalid", `evidence_ref must be at most ${EVIDENCE_REF_MAX} characters.`, {
      field: "evidence_ref",
      ...details,
    });
  return evidence;
}

function requireActor(evaluatedBy: string): void {
  if (!evaluatedBy) throw new DealShapeError("invalid", "A verdict needs the calling user's identity.");
}

/** Shared transaction: opportunity exists, token matches, optional no-op test, then supersede + insert. */
function replaceLiveSet(
  db: Database,
  base: WriteBase,
  plan: {
    rows: Array<Pick<DealShapeEvaluationRow, "shape" | "intent" | "viable" | "rationale" | "evidence_ref">>;
    isNoop: (live: DealShapeEvaluationRow[]) => boolean;
  },
): DealShapeWriteResult {
  const ids = plan.rows.map(() => ulid());
  let result: DealShapeWriteResult = { rows: [], superseded: [], changed: false };
  const write = db.transaction(() => {
    if (!db.query("SELECT 1 AS x FROM opportunity WHERE id = ?").get(base.opportunityId))
      throw new DealShapeError("opportunity_not_found", "Opportunity not found.");
    const live = readLive(db, base.opportunityId);
    const current = computeLiveToken(live.map((r) => r.id));
    if (typeof base.liveToken !== "string" || base.liveToken !== current)
      throw new DealShapeError(
        "stale",
        "The recorded verdict changed since you loaded it (or live_token is missing). Review the current verdict and record again.",
        { live_token: current },
      );
    if (plan.isNoop(live)) return;
    // superseded_by points at rows inserted next; the unique live indexes forbid two live rows, so the old rows leave the live
    // set first and the self-FK is checked at commit, not per statement.
    db.run("PRAGMA defer_foreign_keys = ON");
    const newestByShape = new Map(plan.rows.map((r, i) => [r.shape, ids[i]]));
    for (const old of live) {
      db.run("UPDATE opportunity_deal_shape_evaluation SET superseded_by = ? WHERE id = ?", [
        (old.shape !== null && newestByShape.get(old.shape)) || ids[0],
        old.id,
      ]);
    }
    plan.rows.forEach((r, i) => {
      db.run(
        `INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by)
         VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
        [ids[i], base.opportunityId, r.shape, r.intent, r.viable ? 1 : 0, r.rationale, r.evidence_ref, base.evaluatedBy, base.now],
      );
    });
    result = {
      rows: ids.map((id) => toRow(db.query(`SELECT ${COLUMNS} FROM opportunity_deal_shape_evaluation WHERE id = ?`).get(id) as RawRow)),
      superseded: live.map((r) => r.id),
      changed: true,
    };
    base.onWrite?.(result);
  });
  // IMMEDIATE takes the write lock up front, so a concurrent writer waits and then fails the live_token check (409 stale)
  // instead of hitting SQLITE_BUSY mid-transaction.
  write.immediate();
  return result;
}

/**
 * Overall "no shape is viable": one rationale, no shape, no intent. Supersedes every live row of the opportunity (shape rows of
 * either viable value and a previous overall row). Re-recording an identical overall verdict is a no-op.
 */
export function recordOverallNotViable(db: Database, input: RecordOverallNotViableInput): DealShapeWriteResult {
  const rationale = cleanRationale(input.rationale, "rationale");
  const evidenceRef = cleanEvidence(input.evidenceRef);
  requireActor(input.evaluatedBy);
  return replaceLiveSet(db, input, {
    rows: [{ shape: null, intent: null, viable: false, rationale, evidence_ref: evidenceRef }],
    isNoop: (live) =>
      live.length === 1 &&
      live[0].shape === null &&
      live[0].rationale === rationale &&
      live[0].evidence_ref === evidenceRef,
  });
}

/**
 * Overall viable: 1-8 unique shapes, one intent for all, one rationale per shape. Inserts viable shape rows in canonical shape
 * order; supersedes same-shape rows, unselected shapes, legacy viable = 0 rows and any overall row. An identical set is a no-op.
 */
export function recordViableShapes(db: Database, input: RecordViableShapesInput): DealShapeWriteResult {
  const intent = typeof input.intent === "string" ? input.intent : "";
  if (!(DEAL_SHAPE_INTENTS as readonly string[]).includes(intent))
    throw new DealShapeError("invalid", `intent must be one of: ${DEAL_SHAPE_INTENTS.join(" | ")}.`, { field: "intent" });
  if (!Array.isArray(input.shapes) || input.shapes.length === 0)
    throw new DealShapeError("invalid", "shapes must list at least one viable shape.", { field: "shapes" });
  if (input.shapes.length > MAX_SHAPES)
    throw new DealShapeError("invalid", `shapes must list at most ${MAX_SHAPES} shapes.`, { field: "shapes" });
  const seen = new Set<string>();
  const rows: Array<Pick<DealShapeEvaluationRow, "shape" | "intent" | "viable" | "rationale" | "evidence_ref">> = [];
  for (const raw of input.shapes as unknown[]) {
    const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const shape = typeof entry.shape === "string" ? entry.shape : "";
    if (!(DEAL_SHAPES as readonly string[]).includes(shape))
      throw new DealShapeError("invalid", `shape must be one of: ${DEAL_SHAPES.join(" | ")}.`, { field: "shape" });
    if (seen.has(shape)) throw new DealShapeError("invalid", `shape ${shape} is listed more than once.`, { field: "shapes", shape });
    seen.add(shape);
    rows.push({
      shape: shape as DealShape,
      intent: intent as DealShapeIntent,
      viable: true,
      rationale: cleanRationale(entry.rationale, "rationale", { shape }),
      evidence_ref: cleanEvidence(entry.evidence_ref, { shape }),
    });
  }
  rows.sort((a, b) => shapeOrder(a.shape) - shapeOrder(b.shape));
  requireActor(input.evaluatedBy);
  return replaceLiveSet(db, input, {
    rows,
    isNoop: (live) =>
      live.length === rows.length &&
      rows.every((r, i) => {
        const l = live[i];
        return (
          l.shape === r.shape &&
          l.viable &&
          l.intent === r.intent &&
          l.rationale === r.rationale &&
          l.evidence_ref === r.evidence_ref
        );
      }),
  });
}

export type DealShapeVerdict = "unassessed" | "not_viable" | "viable";

export interface DealShapeEvaluationList {
  /** Live SHAPE rows in canonical order (legacy viable = 0 rows included until the next write supersedes them). */
  live: DealShapeEvaluationRow[];
  /** The live overall "no shape is viable" row, or null. */
  overall: DealShapeEvaluationRow | null;
  /** Superseded rows of both kinds, newest first. */
  history: DealShapeEvaluationRow[];
  /** unassessed = nothing live; not_viable = a live overall row or only legacy not-viable shape rows; viable = at least one live viable shape row. */
  verdict: DealShapeVerdict;
  live_token: string;
}

export function listDealShapeEvaluations(db: Database, opportunityId: string): DealShapeEvaluationList {
  const rows = (
    db
      .query(
        `SELECT ${COLUMNS} FROM opportunity_deal_shape_evaluation WHERE opportunity_id = ? ORDER BY evaluated_at DESC, id DESC`,
      )
      .all(opportunityId) as RawRow[]
  ).map(toRow);
  const liveAll = rows.filter((r) => r.superseded_by === null);
  const live = liveAll.filter((r) => r.shape !== null).sort((a, b) => shapeOrder(a.shape) - shapeOrder(b.shape));
  const overall = liveAll.find((r) => r.shape === null) ?? null;
  // Legacy viable = 0 shape rows alone read not_viable, consistent with kill criterion #9 (recorded > 0, viable 0).
  const verdict: DealShapeVerdict = live.some((r) => r.viable)
    ? "viable"
    : overall || live.length > 0
      ? "not_viable"
      : "unassessed";
  return {
    live,
    overall,
    history: rows.filter((r) => r.superseded_by !== null),
    verdict,
    live_token: computeLiveToken(liveAll.map((r) => r.id)),
  };
}

export interface LiveDealShapeSummary {
  /** Live rows recorded (an overall row counts as one). */
  recorded: number;
  /** Live rows with viable = 1: the value of dealshape.viable_shapes (an overall row contributes 0). */
  viable: number;
  /** MAX(evaluated_at) over the live rows. */
  latestAt: string;
  /** A live overall "no shape is viable" row exists (for the UI and the gate brief). */
  overallNotViable: boolean;
}

/**
 * The count behind dealshape.viable_shapes at opportunity scope. null = no live row recorded: the variable is missing
 * and the criterion reads unassessed (never present 0). A recorded set with zero viable rows (an overall row, or legacy
 * not-viable rows) is { viable: 0 }.
 */
export function summarizeLiveDealShapes(db: Database, opportunityId: string): LiveDealShapeSummary | null {
  const r = db
    .query(
      "SELECT COUNT(*) AS recorded, COALESCE(SUM(viable),0) AS viable, MAX(evaluated_at) AS latest, COALESCE(SUM(CASE WHEN shape IS NULL THEN 1 ELSE 0 END),0) AS overall FROM opportunity_deal_shape_evaluation WHERE opportunity_id = ? AND superseded_by IS NULL",
    )
    .get(opportunityId) as { recorded: number; viable: number; latest: string | null; overall: number };
  if (r.recorded === 0) return null;
  return { recorded: r.recorded, viable: r.viable, latestAt: r.latest ?? "", overallNotViable: r.overall > 0 };
}
