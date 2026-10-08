// Typed, precondition-enforced closure (ADR-0152, Wave F PR F-1).
//
// closeEntity is the single write path that ends a project or an opportunity.
// It validates the closure type's blocking precondition against the
// human-recorded basis record (gate_decision / venture_transition_decision),
// writes one closure_record row, denormalizes closure_type onto md_project,
// and moves pipeline_run to the type-mapped terminal status — all in ONE
// transaction. It never decides: the basis records are human outputs
// (boundary #2) and `closedBy` is the session user (boundary #1) — agent ids
// are rejected.
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { appendAudit } from "../lib/access-control.ts";
import { ulid } from "../lib/ulid.ts";

export type ClosureEntityType = "project" | "opportunity";
export type ClosureType =
  | "killed_at_gate"
  | "withdrawn"
  | "graduated_to_core"
  | "divested"
  | "killed_with_learning"
  | "dropped";

export const CLOSURE_TYPES_BY_ENTITY: Record<ClosureEntityType, readonly ClosureType[]> = {
  project: ["killed_at_gate", "withdrawn", "graduated_to_core", "divested", "killed_with_learning"],
  opportunity: ["killed_at_gate", "withdrawn", "dropped"],
};

/** Terminal pipeline_run status per closure type (design §3.1). */
export const TERMINAL_RUN_STATUS: Record<ClosureType, "killed" | "withdrawn" | "completed"> = {
  killed_at_gate: "killed",
  withdrawn: "withdrawn",
  graduated_to_core: "completed",
  divested: "completed",
  killed_with_learning: "killed",
  dropped: "withdrawn",
};

/** Kill / withdrawal closures must carry learning capture. */
const LEARNING_REQUIRED: ReadonlySet<ClosureType> = new Set([
  "killed_at_gate",
  "withdrawn",
  "killed_with_learning",
  "dropped",
]);

/** Migration 0123 date — gate kills decided earlier are grandfathered. */
export const CLOSURE_MIGRATION_DATE = "2026-10-08";
/** ADR-0151 date — earlier transition rows keep the rationale-only contract. */
const ADR_0151_MIGRATION_DATE = "2026-10-02";
export const WITHDRAWN_MIN_REASON = 20;

export type ClosureErrorCode =
  | "precondition_failed"
  | "invalid_type_for_entity"
  | "already_closed"
  | "invalid_input"
  | "agent_forbidden"
  | "not_found"
  | "invalid_state";

export class ClosureError extends Error {
  constructor(
    public code: ClosureErrorCode,
    message: string,
    /** Names of the missing records (precondition_failed). */
    public missing: string[] = [],
  ) {
    super(message);
  }
}

export interface MissingRecord {
  record: string;
  message: string;
}

export interface TypePreconditions {
  satisfied: boolean;
  missing: MissingRecord[];
  requires_learning_capture: boolean;
  min_reason_length: number;
  basis_table: "gate_decision" | "venture_transition_decision" | "none";
  basis_id: string | null;
}

export interface PreconditionOptions {
  /** Agent persona ids — never valid as a human decider/closer (boundary #1/#2). */
  agentIds?: ReadonlySet<string>;
  /** Caller supplied basisId — must match the located basis record. */
  basisId?: string;
  db?: Database;
}

interface GateRow {
  id: string;
  decided_by: string;
  decided_at: string;
  learning_capture: string | null;
}
interface TransitionRow {
  id: string;
  decision: string;
  decided_at: string;
  learning_capture: string | null;
  core_handoff: string | null;
  divest_plan: string | null;
}

const blank = (v: string | null | undefined): boolean => (v ?? "").trim() === "";

/** Latest effective KILL: a kill that no later decision on the same gate overrides. */
function latestKill(db: Database, entityType: ClosureEntityType, entityId: string): GateRow | undefined {
  return db
    .query(
      `SELECT g.id, g.decided_by, g.decided_at, g.learning_capture FROM gate_decision g
       WHERE g.entity_type = ? AND g.entity_id = ? AND g.decision = 'kill'
         AND NOT EXISTS (
           SELECT 1 FROM gate_decision h
           WHERE h.entity_type = g.entity_type AND h.entity_id = g.entity_id AND h.gate = g.gate
             AND (h.decided_at > g.decided_at OR (h.decided_at = g.decided_at AND h.id > g.id)))
       ORDER BY g.decided_at DESC, g.id DESC LIMIT 1`,
    )
    .get(entityType, entityId) as GateRow | undefined;
}

function latestTransition(db: Database, projectId: string): TransitionRow | undefined {
  return db
    .query(
      `SELECT id, decision, decided_at, learning_capture, core_handoff, divest_plan
       FROM venture_transition_decision WHERE project_id = ?
       ORDER BY decided_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as TransitionRow | undefined;
}

/** A gate whose latest decision is HOLD and a committee evaluation exists after it. */
function hasPendingHold(db: Database, entityType: ClosureEntityType, entityId: string): boolean {
  const row = db
    .query(
      `SELECT g.id FROM gate_decision g
       WHERE g.entity_type = ? AND g.entity_id = ? AND g.decision = 'hold'
         AND NOT EXISTS (
           SELECT 1 FROM gate_decision h
           WHERE h.entity_type = g.entity_type AND h.entity_id = g.entity_id AND h.gate = g.gate
             AND (h.decided_at > g.decided_at OR (h.decided_at = g.decided_at AND h.id > g.id)))
         AND EXISTS (
           SELECT 1 FROM gate_evaluation e JOIN process_run r ON r.id = e.process_run_id
           WHERE r.entity_type = g.entity_type AND r.entity_id = g.entity_id
             AND e.gate = g.gate AND e.created_at > g.decided_at)
       LIMIT 1`,
    )
    .get(entityType, entityId);
  return !!row;
}

export function evaluateTypePreconditions(
  entityType: ClosureEntityType,
  entityId: string,
  closureType: ClosureType,
  opts: PreconditionOptions = {},
): TypePreconditions {
  const db = opts.db ?? getDb();
  const agents = opts.agentIds ?? new Set<string>();
  const missing: MissingRecord[] = [];
  let basisTable: TypePreconditions["basis_table"] = "none";
  let basisId: string | null = null;

  if (!CLOSURE_TYPES_BY_ENTITY[entityType].includes(closureType)) {
    missing.push({ record: "closure_type", message: `'${closureType}' is not valid for a ${entityType}.` });
  } else if (closureType === "killed_at_gate") {
    basisTable = "gate_decision";
    const kill = latestKill(db, entityType, entityId);
    if (!kill) {
      missing.push({ record: "gate_decision(kill)", message: "A recorded gate KILL decision is required." });
    } else {
      basisId = kill.id;
      if (agents.has(kill.decided_by)) {
        missing.push({
          record: "gate_decision.decided_by",
          message: "The KILL must be recorded by a human, not an agent.",
        });
      }
      if (blank(kill.learning_capture) && kill.decided_at >= CLOSURE_MIGRATION_DATE) {
        missing.push({ record: "gate_decision.learning_capture", message: "The gate KILL has no learning capture." });
      }
      if (opts.basisId && opts.basisId !== kill.id) {
        missing.push({ record: "basisId", message: "basisId does not match the latest gate KILL for this entity." });
      }
    }
  } else if (closureType === "withdrawn") {
    if (hasPendingHold(db, entityType, entityId)) {
      missing.push({
        record: "gate_decision(hold)",
        message: "A gate HOLD is awaiting a committee session outcome; record the gate decision first.",
      });
    }
  } else if (closureType === "dropped") {
    const opp = db.query("SELECT status, project_id FROM opportunity WHERE id = ?").get(entityId) as
      | { status: string; project_id: string | null }
      | undefined;
    const decided = db
      .query("SELECT 1 AS x FROM gate_decision WHERE entity_type = 'opportunity' AND entity_id = ? LIMIT 1")
      .get(entityId);
    if (decided) {
      missing.push({
        record: "gate_decision(none)",
        message: "A gate decision exists; use killed_at_gate or withdrawn.",
      });
    }
    if (opp?.project_id) {
      missing.push({
        record: "opportunity.project_id(null)",
        message: "The opportunity is promoted; close the project instead.",
      });
    }
  } else {
    basisTable = "venture_transition_decision";
    const want = {
      graduated_to_core: "graduate_to_core",
      divested: "reduce_or_divest",
      killed_with_learning: "kill_with_learning_captured",
    }[closureType];
    const t = latestTransition(db, entityId);
    if (!t || t.decision !== want) {
      missing.push({
        record: `venture_transition_decision(${want})`,
        message: `The latest S12 transition decision must be '${want}'.`,
      });
    } else {
      basisId = t.id;
      const grandfathered = t.decided_at < ADR_0151_MIGRATION_DATE;
      if (closureType === "graduated_to_core" && !grandfathered && blank(t.core_handoff)) {
        missing.push({ record: "venture_transition_decision.core_handoff", message: "core_handoff is required." });
      }
      if (closureType === "divested" && !grandfathered && blank(t.divest_plan)) {
        missing.push({ record: "venture_transition_decision.divest_plan", message: "divest_plan is required." });
      }
      if (closureType === "killed_with_learning" && blank(t.learning_capture)) {
        missing.push({
          record: "venture_transition_decision.learning_capture",
          message: "learning_capture is required.",
        });
      }
      if (opts.basisId && opts.basisId !== t.id) {
        missing.push({ record: "basisId", message: "basisId does not match the latest transition decision." });
      }
    }
  }

  return {
    satisfied: missing.length === 0,
    missing,
    requires_learning_capture: LEARNING_REQUIRED.has(closureType),
    min_reason_length: closureType === "withdrawn" ? WITHDRAWN_MIN_REASON : 1,
    basis_table: basisTable,
    basis_id: basisId,
  };
}

/** Per-type preconditions for the closure modal / GET .../close/preconditions. */
export function getClosurePreconditions(
  entityType: ClosureEntityType,
  entityId: string,
  opts: PreconditionOptions = {},
): Record<string, TypePreconditions> {
  const out: Record<string, TypePreconditions> = {};
  for (const t of CLOSURE_TYPES_BY_ENTITY[entityType])
    out[t] = evaluateTypePreconditions(entityType, entityId, t, opts);
  return out;
}

export interface CloseEntityInput {
  entityType: ClosureEntityType;
  entityId: string;
  closureType: ClosureType;
  basisId?: string;
  closureReason: string;
  learningCapture?: string;
  closedBy: string;
  agentIds?: ReadonlySet<string>;
  db?: Database;
}

export interface ClosureRecordRow {
  id: string;
  entity_type: ClosureEntityType;
  entity_id: string;
  closure_type: ClosureType;
  basis_table: string;
  basis_id: string | null;
  closure_reason: string;
  learning_capture: string | null;
  closed_by: string;
  closed_at: string;
}

export function closeEntity(input: CloseEntityInput): ClosureRecordRow {
  const db = input.db ?? getDb();
  const { entityType, entityId, closureType } = input;
  const reason = (input.closureReason ?? "").trim();
  const learning = (input.learningCapture ?? "").trim();

  if (!(CLOSURE_TYPES_BY_ENTITY[entityType] as readonly string[]).includes(closureType)) {
    throw new ClosureError(
      "invalid_type_for_entity",
      `closure type '${closureType}' is not valid for a ${entityType}.`,
    );
  }
  if (!input.closedBy?.trim() || input.agentIds?.has(input.closedBy)) {
    throw new ClosureError("agent_forbidden", "Closure is a human decision; an agent identity cannot close an entity.");
  }

  return db.transaction(() => {
    const now = new Date().toISOString();
    if (entityType === "project") {
      const p = db.query("SELECT id, status FROM md_project WHERE id = ?").get(entityId) as
        | { id: string; status: string }
        | undefined;
      if (!p) throw new ClosureError("not_found", `project '${entityId}' not found.`);
      if (p.status !== "open")
        throw new ClosureError("already_closed", `project '${entityId}' is already ${p.status}.`);
    } else {
      const o = db.query("SELECT id, status, project_id FROM opportunity WHERE id = ?").get(entityId) as
        | { id: string; status: string; project_id: string | null }
        | undefined;
      if (!o) throw new ClosureError("not_found", `opportunity '${entityId}' not found.`);
      if (o.status === "dropped")
        throw new ClosureError("already_closed", `opportunity '${entityId}' is already closed.`);
      if (o.project_id)
        throw new ClosureError("invalid_state", "The opportunity is promoted to a project; close the project instead.");
    }
    const active = db
      .query("SELECT id FROM closure_record WHERE entity_type = ? AND entity_id = ? AND reopened_at IS NULL")
      .get(entityType, entityId);
    if (active)
      throw new ClosureError("already_closed", `${entityType} '${entityId}' already has an active closure record.`);

    const pre = evaluateTypePreconditions(entityType, entityId, closureType, {
      agentIds: input.agentIds,
      basisId: input.basisId,
      db,
    });
    if (!pre.satisfied) {
      throw new ClosureError(
        "precondition_failed",
        `precondition_failed:${pre.missing.map((m) => m.record).join(",")}`,
        pre.missing.map((m) => m.record),
      );
    }
    if (reason.length < pre.min_reason_length) {
      throw new ClosureError(
        "invalid_input",
        pre.min_reason_length > 1
          ? `closureReason must be at least ${pre.min_reason_length} characters for '${closureType}'.`
          : "closureReason is required.",
      );
    }
    // killed_at_gate: the learning lives on the gate decision; grandfathered
    // pre-0123 kills have none and are not required to (ADR-0151 precedent).
    let learningOut = learning;
    if (closureType === "killed_at_gate" && !learningOut && pre.basis_id) {
      const g = db.query("SELECT learning_capture FROM gate_decision WHERE id = ?").get(pre.basis_id) as {
        learning_capture: string | null;
      };
      learningOut = (g.learning_capture ?? "").trim();
    }
    if (closureType === "killed_with_learning" && !learningOut && pre.basis_id) {
      const t = db.query("SELECT learning_capture FROM venture_transition_decision WHERE id = ?").get(pre.basis_id) as {
        learning_capture: string | null;
      };
      learningOut = (t.learning_capture ?? "").trim();
    }
    const grandfatheredKill = closureType === "killed_at_gate" && pre.basis_id && learningOut === "";
    if (LEARNING_REQUIRED.has(closureType) && learningOut === "" && !grandfatheredKill) {
      throw new ClosureError("invalid_input", `learningCapture is required for '${closureType}'.`);
    }

    const row: ClosureRecordRow = {
      id: ulid(),
      entity_type: entityType,
      entity_id: entityId,
      closure_type: closureType,
      basis_table: pre.basis_table,
      basis_id: pre.basis_id,
      closure_reason: reason,
      learning_capture: learningOut || null,
      closed_by: input.closedBy,
      closed_at: now,
    };
    db.run(
      `INSERT INTO closure_record (id, entity_type, entity_id, closure_type, basis_table, basis_id, closure_reason, learning_capture, closed_by, closed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        row.id,
        entityType,
        entityId,
        closureType,
        row.basis_table,
        row.basis_id,
        reason,
        row.learning_capture,
        input.closedBy,
        now,
      ],
    );

    const terminal = TERMINAL_RUN_STATUS[closureType];
    const fromStatuses =
      terminal === "completed" ? "'running','paused_for_human'" : "'running','paused_for_human','completed'";
    if (entityType === "project") {
      db.run(
        "UPDATE md_project SET status = 'closed', closed_at = COALESCE(closed_at, ?), closure_reason = ?, closure_type = ? WHERE id = ?",
        [now, reason, closureType, entityId],
      );
    } else {
      db.run("UPDATE opportunity SET status = 'dropped', decided_by = ?, decided_at = ? WHERE id = ?", [
        input.closedBy,
        now,
        entityId,
      ]);
    }
    db.run(
      `UPDATE pipeline_run SET status = ?, current_stage = COALESCE(current_stage, 'closed'), paused_reason = NULL, updated_at = ?
       WHERE entity_type = ? AND entity_id = ? AND status IN (${fromStatuses})`,
      [terminal, now, entityType, entityId],
    );
    appendAudit(db, {
      actor: input.closedBy,
      action: `${entityType}_closed`,
      target: `${entityId}:${closureType}`,
      now,
    });
    return row;
  })();
}
