// Gate decision write contract - ADR-0186 D1 / D9, design 3.1 and 3.15.
//
// The decision request carries (all optional on the wire, required on a GO
// when the recomputed snapshot lists items that need them):
//   snapshot_hash     the hash of the snapshot the recorder saw
//   acknowledgements  [{ key, kind?, reason, covers? }]   - a HUMAN act
//   brief_id          the AI brief decided against (D9)
//   divergence_reason why a GO departs from the AI recommendation (D9)
//   kill_override_id  the Group IC override the recorder relies on (D1)
// The server recomputes the snapshot inside the write transaction (never
// trusting the client), then applies, in the design's order: kill binding
// (HB), divergence (HB), snapshot_stale (409), ack_required (422). HOLD and
// KILL are never blocked: they only store the snapshot (principle 5).
//
// Every rule runs through applyFamilyFailure, so off / shadow / enforce behave
// uniformly (shadow = would-block audit row, request proceeds). The contract
// functions run INSIDE the caller's transaction and signal a refusal by
// throwing ContractRejection, which unwinds the run, ledger and decision rows.
import type { Database } from "bun:sqlite";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { getBriefRecord, insertGateSnapshot, GATE_SNAPSHOT_SCHEMA_VERSION, type Acknowledgement } from "../../../db/repositories/gate-snapshot.repository.ts";
import { badRequest } from "./envelope.ts";
import { applyFamilyFailure, recordWouldBlock, type IntegrityContext, type IntegrityFailure } from "./gate-integrity.ts";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";
import { buildGateSnapshot, type BuiltSnapshot, type GateSnapshot, type RequiredAck, type SnapshotEntity } from "./gate-snapshot.ts";
import { validateRationale } from "./rationale-check.ts";

export interface ProvidedAck { key: string; kind?: string; reason: string; covers?: string[] }

export interface DecisionExtras {
  snapshotHash: string | null;
  acknowledgements: ProvidedAck[];
  briefId: string | null;
  divergenceReason: string | null;
  killOverrideId: string | null;
}

export const MAX_ACKS = 200;
const MAX_REASON = 2000;

/** True when any family that needs the snapshot is on; otherwise the decision write is the legacy path, byte for byte. */
export function integrityActive(): boolean {
  return (["snapshot_ack", "kill_binding", "divergence"] as const).some((f) => gateIntegrityMode(f) !== "off");
}

/** Shape validation of the new body fields. A malformed field is a 400 whatever the flag mode (it is not a policy rule). */
export function parseDecisionExtras(body: Record<string, unknown>): { ok: true; extras: DecisionExtras } | { ok: false; response: Response } {
  const str = (v: unknown, field: string): string | null | undefined => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") return undefined;
    void field;
    return v.trim() || null;
  };
  const bad = (message: string) => ({ ok: false as const, response: badRequest("invalid_request", message) });
  const snapshotHash = str(body.snapshot_hash, "snapshot_hash");
  const briefId = str(body.brief_id, "brief_id");
  const divergence = str(body.divergence_reason, "divergence_reason");
  const overrideId = str(body.kill_override_id, "kill_override_id");
  if (snapshotHash === undefined) return bad("snapshot_hash must be a string.");
  if (briefId === undefined) return bad("brief_id must be a string.");
  if (divergence === undefined) return bad("divergence_reason must be a string.");
  if (overrideId === undefined) return bad("kill_override_id must be a string.");
  const acks: ProvidedAck[] = [];
  if (body.acknowledgements !== undefined && body.acknowledgements !== null) {
    if (!Array.isArray(body.acknowledgements) || body.acknowledgements.length > MAX_ACKS) return bad(`acknowledgements must be an array of at most ${MAX_ACKS} entries.`);
    for (const raw of body.acknowledgements as unknown[]) {
      const a = raw as Record<string, unknown> | null;
      if (!a || typeof a !== "object" || typeof a.key !== "string" || !a.key.trim() || typeof a.reason !== "string") {
        return bad("each acknowledgement must be { key: string, reason: string, kind?: string, covers?: string[] }.");
      }
      if (a.kind !== undefined && typeof a.kind !== "string") return bad("acknowledgement kind must be a string.");
      if (a.covers !== undefined && (!Array.isArray(a.covers) || a.covers.length > MAX_ACKS || a.covers.some((c) => typeof c !== "string"))) {
        return bad("acknowledgement covers must be an array of keys.");
      }
      acks.push({ key: a.key.trim(), kind: a.kind as string | undefined, reason: a.reason.trim().slice(0, MAX_REASON), covers: (a.covers as string[] | undefined)?.map((c) => c.trim()) });
    }
  }
  return { ok: true, extras: { snapshotHash, acknowledgements: acks, briefId, divergenceReason: divergence ? divergence.slice(0, MAX_REASON) : null, killOverrideId: overrideId } };
}

/** brief_id and kill_override_id must reference records of THIS entity (and gate, for a brief). 400 otherwise, whatever the mode. */
export function checkExtrasReferences(db: Database, entityType: SnapshotEntity, entityId: string, gate: string, extras: DecisionExtras): Response | null {
  if (extras.briefId) {
    const b = getBriefRecord(db, extras.briefId);
    if (!b || b.entity_type !== entityType || b.entity_id !== entityId || b.gate !== gate) {
      return badRequest("invalid_request", "brief_id does not reference a gate brief generated for this entity and gate.");
    }
  }
  if (extras.killOverrideId) {
    const o = db.query("SELECT id FROM kill_criteria_override WHERE id = ? AND entity_type = ? AND entity_id = ? AND revoked_at IS NULL").get(extras.killOverrideId, entityType, entityId);
    if (!o) return badRequest("invalid_request", "kill_override_id does not reference an active kill-criteria override of this entity.");
  }
  return null;
}

/** Thrown inside the write transaction to unwind it; the route turns it into the error response. */
export class ContractRejection extends Error {
  constructor(readonly failure: IntegrityFailure, readonly built: BuiltSnapshot | null) {
    super(failure.code);
  }
}

export interface AckOutcome {
  covered: Acknowledgement[];
  missing: string[];
  unknown: string[];
  invalid: Array<{ key: string; problem: string }>;
  weak: Array<{ key: string; reason: string }>;
}

/** Match the provided acknowledgements against the required set (pure). One stored entry per covered key. */
export function processAcknowledgements(required: readonly RequiredAck[], provided: readonly ProvidedAck[]): AckOutcome {
  const reqByKey = new Map(required.map((r) => [r.key, r]));
  const covered = new Map<string, Acknowledgement>();
  const weakKeys = new Set<string>();
  const unknown = new Set<string>();
  const invalid: AckOutcome["invalid"] = [];
  const weak: AckOutcome["weak"] = [];
  for (const p of provided) {
    const req = reqByKey.get(p.key);
    if (!req) { unknown.add(p.key); continue; }
    if (p.kind && p.kind !== req.kind) { invalid.push({ key: p.key, problem: "kind_mismatch" }); continue; }
    const check = validateRationale(p.reason, "ack");
    if (!check.ok) {
      weak.push({ key: p.key, reason: check.reason });
      weakKeys.add(p.key);
      continue;
    }
    covered.set(p.key, { key: p.key, kind: req.kind, reason: p.reason });
    for (const ck of p.covers ?? []) {
      const c = reqByKey.get(ck);
      if (!c) { unknown.add(ck); continue; }
      // One reason may cover several unassessed items of the SAME procedure (D1); nothing else is shareable.
      if (req.kind !== "kill_unassessed" || c.kind !== "kill_unassessed" || c.procedure !== req.procedure) {
        invalid.push({ key: ck, problem: "cover_not_allowed" });
        continue;
      }
      covered.set(ck, { key: ck, kind: c.kind, reason: p.reason });
    }
  }
  const missing = required.map((r) => r.key).filter((k) => !covered.has(k) && !weakKeys.has(k));
  return { covered: [...covered.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), missing, unknown: [...unknown].sort(), invalid, weak };
}

function freshSnapshotView(built: BuiltSnapshot): GateSnapshot {
  return { ...built.snapshot, kill: { ...built.snapshot.kill, eval_run_id: null } };
}

export interface ContractResult {
  built: BuiltSnapshot;
  acknowledgements: Acknowledgement[];
  submittedHash: string | null;
  aiRecommended: string | null;
  aiBriefId: string | null;
  divergenceReason: string | null;
}

/**
 * Compute the snapshot and apply the contract. Runs INSIDE the write transaction (the builder opens the
 * project evaluation run and writes its ledger). Throws ContractRejection to unwind.
 */
export function runDecisionContract(
  db: Database,
  input: { entityType: SnapshotEntity; entityId: string; gate: string; decision: "go" | "hold" | "kill"; actor: string; extras: DecisionExtras; now: string },
): ContractResult {
  const ctx: IntegrityContext = { entityType: input.entityType, entityId: input.entityId, gate: input.gate, actor: input.actor };
  const built = buildGateSnapshot({ entityType: input.entityType, entityId: input.entityId, gate: input.gate, actor: input.actor, event: "decision", briefId: input.extras.briefId, now: input.now, db });
  const { snapshot } = built;
  const reject = (failure: IntegrityFailure | null) => {
    if (failure) throw new ContractRejection(failure, built);
  };
  const aiRecommended = built.brief?.recommended ?? null;
  const acks = processAcknowledgements(snapshot.required_acks, input.extras.acknowledgements);

  if (input.decision === "go") {
    // 1. kill binding (HB): a triggered halt criterion needs an active Group IC override that its issuer did not
    //    use on their own decision (the issuer is not the recorder of the decision it unblocks - design 3.6).
    reject(
      applyFamilyFailure("kill_binding", ctx, () => {
        const unblocked: string[] = [];
        const selfIssued: string[] = [];
        for (const t of snapshot.kill.triggered) {
          if (!t.binding) continue;
          if (t.override_id === null) { unblocked.push(t.key); continue; }
          const issuer = (db.query("SELECT issued_by FROM kill_criteria_override WHERE id = ?").get(t.override_id) as { issued_by: string } | null)?.issued_by;
          if (issuer === input.actor) { unblocked.push(t.key); selfIssued.push(t.key); }
        }
        if (unblocked.length === 0) return null;
        return {
          status: 409 as const,
          code: "kill_binding_unoverridden",
          message: `A triggered halt kill criterion is binding (neb-policy 2.5) and has no Group Investment Committee override: ${unblocked.join(", ")}. HOLD or KILL can be recorded at any time.`,
          details: { keys: unblocked, self_issued: selfIssued },
        };
      }, db),
    );

    // 2. AI-versus-human divergence (D9): a GO against a different AI recommendation carries the recorder's reason.
    reject(
      applyFamilyFailure("divergence", ctx, () => {
        if (!aiRecommended || aiRecommended === "go") return null;
        const reason = input.extras.divergenceReason;
        if (!reason) {
          return { status: 422 as const, code: "divergence_reason_required", message: `The AI brief recommended ${aiRecommended.toUpperCase()}; a GO needs divergence_reason explaining why.`, details: { ai_recommended: aiRecommended, brief_id: built.brief?.id ?? null } };
        }
        const check = validateRationale(reason, "decision");
        if (check.ok) return null;
        return { status: 422 as const, code: "rationale_insufficient", message: `The divergence_reason does not meet the minimum substance profile (${check.reason}).`, details: { field: "divergence_reason", reason: check.reason, profile: "decision" } };
      }, db),
    );

    // 3. stale snapshot (409): the state changed between viewing and recording, or no hash was sent.
    reject(
      applyFamilyFailure("snapshot_ack", ctx, () => {
        const sent = input.extras.snapshotHash;
        if (sent === built.hash) return null;
        return {
          status: 409 as const,
          code: "snapshot_stale",
          message: sent ? "The gate state changed since the snapshot you reviewed; review the fresh snapshot and acknowledge again." : "snapshot_hash is required on a GO; load the gate snapshot first.",
          details: { reason: sent ? "mismatch" : "missing", snapshot_hash: built.hash, snapshot: freshSnapshotView(built) },
        };
      }, db),
    );

    // 4. acknowledgements (422): exact missing keys; reasons use the ack rationale profile.
    reject(
      applyFamilyFailure("snapshot_ack", ctx, () => {
        if (acks.missing.length > 0 || acks.unknown.length > 0 || acks.invalid.length > 0) {
          return {
            status: 422 as const,
            code: "ack_required",
            message: `This GO needs an explicit acknowledgement with a reason for: ${acks.missing.join(", ") || "(none)"}.`,
            details: { missing: acks.missing, unknown: acks.unknown, invalid: acks.invalid },
          };
        }
        if (acks.weak.length > 0) {
          return { status: 422 as const, code: "rationale_insufficient", message: "An acknowledgement reason does not meet the minimum substance profile.", details: { field: "acknowledgements", profile: "ack", items: acks.weak } };
        }
        return null;
      }, db),
    );
  }

  return {
    built,
    acknowledgements: acks.covered,
    submittedHash: input.extras.snapshotHash,
    aiRecommended,
    aiBriefId: built.brief?.id ?? null,
    divergenceReason: input.extras.divergenceReason,
  };
}

export interface DecisionRecordInput {
  entityType: SnapshotEntity;
  entityId: string;
  gate: string;
  decision: "go" | "hold" | "kill";
  storedRationale: string;
  missingArtifactsJson: string | null;
  actor: string;
  gateEvaluationId: string | null;
  learningCapture: string | null;
  judgementConfirmationsJson: string | null;
  /** null = legacy path (every integrity family that needs a snapshot is off). */
  extras: DecisionExtras | null;
  now: string;
}

export type DecisionRecordResult =
  | { ok: true; id: string; snapshotHash: string | null; acknowledgements: Acknowledgement[] }
  | { ok: false; failure: IntegrityFailure; built: BuiltSnapshot | null };

/**
 * Insert the decision. Legacy path (extras null): the original single INSERT plus its audit row. Contract
 * path: ONE BEGIN IMMEDIATE transaction holding the evaluation run + ledger, the recomputation and checks, the
 * gate_decision row, its snapshot and the audit rows - a fault anywhere unwinds all of them (design 3.15).
 */
export function recordGateDecisionRow(db: Database, input: DecisionRecordInput): DecisionRecordResult {
  const id = ulid();
  const insertRow = (extra: { aiRecommended: string | null; aiBriefId: string | null; divergenceReason: string | null } | null) => {
    db.run(
      `INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at, gate_evaluation_id, learning_capture, judgement_confirmations_json${extra ? ", ai_recommended_decision, ai_brief_id, divergence_reason" : ""})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?${extra ? ",?,?,?" : ""})`,
      [
        id, input.entityType, input.entityId, input.gate, input.decision, input.storedRationale, input.missingArtifactsJson, input.actor, input.now,
        input.gateEvaluationId, input.learningCapture, input.judgementConfirmationsJson,
        ...(extra ? [extra.aiRecommended, extra.aiBriefId, extra.divergenceReason] : []),
      ],
    );
    appendAudit(db, { actor: input.actor, action: "gate_decision.record", target: `${input.entityId}:${input.gate}:${input.decision}`, now: input.now });
  };

  if (!input.extras) {
    insertRow(null);
    return { ok: true, id, snapshotHash: null, acknowledgements: [] };
  }
  const extras = input.extras;
  try {
    return db
      .transaction((): DecisionRecordResult => {
        const c = runDecisionContract(db, { entityType: input.entityType, entityId: input.entityId, gate: input.gate, decision: input.decision, actor: input.actor, extras, now: input.now });
        insertRow({ aiRecommended: c.aiRecommended, aiBriefId: c.aiBriefId, divergenceReason: c.divergenceReason });
        insertGateSnapshot(db, {
          decisionId: id,
          schemaVersion: GATE_SNAPSHOT_SCHEMA_VERSION,
          snapshotJson: JSON.stringify(c.built.snapshot),
          snapshotHash: c.built.hash,
          submittedHash: c.submittedHash,
          acknowledgements: c.acknowledgements,
          computedAt: c.built.snapshot.computed_at,
          engineVersionsJson: JSON.stringify(c.built.snapshot.engine_versions),
          evalRunId: c.built.evalRunId,
          briefId: c.aiBriefId,
        });
        appendAudit(db, { actor: input.actor, action: "gate_snapshot.record", target: `${input.entityId}:${input.gate}:${input.decision}:${c.built.hash.slice(0, 12)}`, now: input.now });
        return { ok: true, id, snapshotHash: c.built.hash, acknowledgements: c.acknowledgements };
      })
      .immediate();
  } catch (e) {
    if (e instanceof ContractRejection) return { ok: false, failure: e.failure, built: e.built };
    // Shadow must never break recording: when no family enforces, a snapshot-building fault degrades to the
    // legacy write (the transaction above already unwound) and is audited as a would-block `snapshot_error`.
    if (!anyEnforce()) {
      console.error(`[gate-integrity] snapshot build failed for ${input.entityType}:${input.entityId}:${input.gate}; recording without a snapshot:`, e);
      try {
        recordWouldBlock(db, { entityType: input.entityType, entityId: input.entityId, gate: input.gate, actor: input.actor }, "snapshot_error");
      } catch { /* the audit is best effort here */ }
      insertRow(null);
      return { ok: true, id, snapshotHash: null, acknowledgements: [] };
    }
    throw e;
  }
}

function anyEnforce(): boolean {
  return (["snapshot_ack", "kill_binding", "divergence"] as const).some((f) => gateIntegrityMode(f) === "enforce");
}
