// @version 1.0.0
/**
 * claim-acks — the three-stage review's interim "사람 확인" ledger (2026-10-21,
 * migration 0165; amends ADR-0182 §5). Until now the needs_judgement checkboxes
 * lived only in React state and were persisted solely as a sidecar snapshot of
 * the gate decision — navigating away lost the review work. Append-only rows
 * per (entity, gate, claim); the latest row is the current state. The decision
 * record keeps its own confirmation snapshot, unchanged.
 */
import type { getDb } from "../../../../db/client.ts";
import { appendAudit } from "../../../../db/lib/access-control.ts";
import { ulid } from "../../../../db/lib/ulid.ts";
import { isReviewGate } from "./gate-artifacts.ts";
import { parseStageArtifactKey, stageArtifactDef } from "./stage-artifacts.ts";

export type AckEntityType = "opportunity" | "project";
export const CLAIM_MAX_LENGTH = 300;

/**
 * The gate column stores either a review gate ("dd", "entity_ic", …) or a
 * stage-artifact key ("stage:S9:1") — the review tabs carry both, and a claim
 * is acknowledged under whichever tab produced it. Anything else is rejected.
 */
export function isValidAckGate(gate: string): boolean {
  if (isReviewGate(gate)) return true;
  const parsed = parseStageArtifactKey(gate);
  return parsed !== null && stageArtifactDef(parsed.stageId, parsed.index) !== null;
}

type Db = ReturnType<typeof getDb>;

export interface ClaimAck {
  claim: string;
  acked: boolean;
  note: string | null;
  by: string;
  at: string;
}

export interface RecordClaimAckInput {
  entityType: AckEntityType;
  entityId: string;
  gate: string;
  claim: string;
  acked: boolean;
  note?: string | null;
  by: string;
  at?: string;
}

export function listClaimAcks(db: Db, entityType: AckEntityType, entityId: string, gate: string): ClaimAck[] {
  const rows = db
    .query(
      `SELECT claim, acked, note, acked_by, acked_at FROM review_claim_ack
       WHERE entity_type = ? AND entity_id = ? AND gate = ?
       ORDER BY acked_at ASC, id ASC`,
    )
    .all(entityType, entityId, gate) as Array<{ claim: string; acked: number; note: string | null; acked_by: string; acked_at: string }>;
  const latest = new Map<string, ClaimAck>();
  for (const r of rows) latest.set(r.claim, { claim: r.claim, acked: r.acked === 1, note: r.note, by: r.acked_by, at: r.acked_at });
  return [...latest.values()];
}

export function recordClaimAck(db: Db, input: RecordClaimAckInput): ClaimAck {
  const claim = input.claim.trim().slice(0, CLAIM_MAX_LENGTH);
  if (!claim) throw new Error("review_claim_ack_rejected: claim is mandatory.");
  const at = input.at ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO review_claim_ack (id, entity_type, entity_id, gate, claim, acked, note, acked_by, acked_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, input.entityType, input.entityId, input.gate, claim, input.acked ? 1 : 0, input.note?.trim() || null, input.by, at],
    );
    appendAudit(db, {
      actor: input.by,
      action: "review_claim_ack.recorded",
      target: `${input.entityType}:${input.entityId}:${input.gate}:${input.acked ? "acked" : "unacked"}`,
      now: at,
    });
  })();
  return { claim, acked: input.acked, note: input.note?.trim() || null, by: input.by, at };
}
