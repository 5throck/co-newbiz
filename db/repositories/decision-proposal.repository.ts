// @version 1.0.0
// decision_proposal store (ADR-0154 §5, Wave M PR M-2).
//
// The ONLY writer of decision_proposal. It deliberately has no import path to
// gate_decision / route_decision / venture_transition_decision / closure
// writers (boundary #2, ADR-0153 pattern): a proposal records what an agent
// suggests; the decision itself is written by the existing decision route,
// executed from the confirming human's own web session.
//
// Lifecycle: pending -> confirmed | rejected | expired | superseded.
// Expiry is derived lazily (a pending row past expires_at is flipped on
// access), so no scheduler is needed.
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

export const PROPOSAL_KINDS = [
  "gate_decision",
  "route_decision",
  "case_adoption",
  "target_selection",
  "transition_decision",
  "approval",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalEntityType = "opportunity" | "project";
export type ProposalStatus = "pending" | "confirmed" | "rejected" | "expired" | "superseded";

/** Proposals stay confirmable for 72 hours (design §6.2). */
export const PROPOSAL_TTL_MS = 72 * 60 * 60 * 1000;

export interface DecisionProposal {
  id: string;
  kind: ProposalKind;
  entity_type: ProposalEntityType;
  entity_id: string;
  stage_id: string | null;
  payload: Record<string, unknown>;
  rationale: string;
  evidence_refs: string[];
  proposed_by_user_id: string;
  via_client_id: string | null;
  status: ProposalStatus;
  expires_at: string;
  confirmed_by_user_id: string | null;
  confirmed_at: string | null;
  confirmed_payload: Record<string, unknown> | null;
  resulting_record_id: string | null;
  created_at: string;
}

interface ProposalRow {
  id: string;
  kind: ProposalKind;
  entity_type: ProposalEntityType;
  entity_id: string;
  stage_id: string | null;
  payload_json: string;
  rationale: string;
  evidence_refs_json: string | null;
  proposed_by_user_id: string;
  via_client_id: string | null;
  status: ProposalStatus;
  expires_at: string;
  confirmed_by_user_id: string | null;
  confirmed_at: string | null;
  confirmed_payload_json: string | null;
  resulting_record_id: string | null;
  created_at: string;
}

function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function toProposal(row: ProposalRow): DecisionProposal {
  return {
    id: row.id,
    kind: row.kind,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    stage_id: row.stage_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    rationale: row.rationale,
    evidence_refs: row.evidence_refs_json ? (JSON.parse(row.evidence_refs_json) as string[]) : [],
    proposed_by_user_id: row.proposed_by_user_id,
    via_client_id: row.via_client_id,
    status: row.status,
    expires_at: row.expires_at,
    confirmed_by_user_id: row.confirmed_by_user_id,
    confirmed_at: row.confirmed_at,
    confirmed_payload: row.confirmed_payload_json ? (JSON.parse(row.confirmed_payload_json) as Record<string, unknown>) : null,
    resulting_record_id: row.resulting_record_id,
    created_at: row.created_at,
  };
}

export interface CreateProposalInput {
  kind: ProposalKind;
  entityType: ProposalEntityType;
  entityId: string;
  stageId?: string | null;
  payload: Record<string, unknown>;
  rationale: string;
  evidenceRefs?: string[];
  proposedByUserId: string;
  viaClientId?: string | null;
  /** Match key inside the payload that distinguishes parallel proposals of one kind (e.g. the gate). */
  supersedeKey?: string | null;
  db?: Database;
  now?: string;
}

export function createProposal(input: CreateProposalInput): DecisionProposal {
  const db = input.db ?? getDb();
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  const expiresAt = new Date(Date.parse(now) + PROPOSAL_TTL_MS).toISOString();
  // A newer proposal of the same kind/entity/key from the same proposer
  // replaces the older pending one; other users' proposals are never touched.
  const olds = db
    .query(
      `SELECT id, payload_json FROM decision_proposal
       WHERE kind = ? AND entity_type = ? AND entity_id = ? AND proposed_by_user_id = ? AND status = 'pending'`,
    )
    .all(input.kind, input.entityType, input.entityId, input.proposedByUserId) as Array<{ id: string; payload_json: string }>;
  for (const old of olds) {
    if (input.supersedeKey) {
      const key = (JSON.parse(old.payload_json) as Record<string, unknown>).gate;
      if (key !== input.supersedeKey) continue;
    }
    db.run("UPDATE decision_proposal SET status = 'superseded', confirm_token_hash = NULL WHERE id = ? AND status = 'pending'", [old.id]);
  }
  db.run(
    `INSERT INTO decision_proposal
       (id, kind, entity_type, entity_id, stage_id, payload_json, rationale, evidence_refs_json,
        proposed_by_user_id, via_client_id, status, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    [
      id, input.kind, input.entityType, input.entityId, input.stageId ?? null, JSON.stringify(input.payload),
      input.rationale, JSON.stringify(input.evidenceRefs ?? []), input.proposedByUserId, input.viaClientId ?? null,
      expiresAt, now,
    ],
  );
  return getProposal(id, db, now) as DecisionProposal;
}

/** Fetch one proposal, flipping a lapsed pending row to 'expired' first. */
export function getProposal(id: string, db: Database = getDb(), now: string = new Date().toISOString()): DecisionProposal | null {
  db.run(
    "UPDATE decision_proposal SET status = 'expired', confirm_token_hash = NULL WHERE id = ? AND status = 'pending' AND expires_at <= ?",
    [id, now],
  );
  const row = db.query("SELECT * FROM decision_proposal WHERE id = ?").get(id) as ProposalRow | null;
  return row ? toProposal(row) : null;
}

export function listProposalsFor(userId: string, opts: { status?: ProposalStatus; limit?: number } = {}, db: Database = getDb()): DecisionProposal[] {
  const now = new Date().toISOString();
  db.run("UPDATE decision_proposal SET status = 'expired', confirm_token_hash = NULL WHERE status = 'pending' AND expires_at <= ?", [now]);
  const rows = db
    .query(
      `SELECT * FROM decision_proposal
       WHERE proposed_by_user_id = ? AND (? IS NULL OR status = ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, opts.status ?? null, opts.status ?? null, Math.min(opts.limit ?? 50, 200)) as ProposalRow[];
  return rows.map(toProposal);
}

/** Issue (and rotate) the single-use confirm nonce for a pending proposal. Returns null unless pending. */
export function issueConfirmNonce(id: string, db: Database = getDb()): string | null {
  const nonce = randomBytes(24).toString("base64url");
  const res = db.run("UPDATE decision_proposal SET confirm_token_hash = ? WHERE id = ? AND status = 'pending'", [hashNonce(nonce), id]);
  return res.changes === 1 ? nonce : null;
}

/**
 * Atomically consume the confirm nonce. Only one caller can win, so two
 * concurrent confirms cannot both execute the decision route.
 */
export function claimConfirmNonce(id: string, nonce: string, db: Database = getDb()): boolean {
  const res = db.run(
    "UPDATE decision_proposal SET confirm_token_hash = NULL WHERE id = ? AND status = 'pending' AND confirm_token_hash = ?",
    [id, hashNonce(nonce)],
  );
  return res.changes === 1;
}

export function markConfirmed(
  id: string,
  input: { confirmedByUserId: string; confirmedPayload: Record<string, unknown>; resultingRecordId: string | null; now?: string },
  db: Database = getDb(),
): boolean {
  const res = db.run(
    `UPDATE decision_proposal
     SET status = 'confirmed', confirmed_by_user_id = ?, confirmed_at = ?, confirmed_payload_json = ?, resulting_record_id = ?, confirm_token_hash = NULL
     WHERE id = ? AND status = 'pending'`,
    [input.confirmedByUserId, input.now ?? new Date().toISOString(), JSON.stringify(input.confirmedPayload), input.resultingRecordId, id],
  );
  return res.changes === 1;
}

export function markRejected(id: string, db: Database = getDb()): boolean {
  const res = db.run("UPDATE decision_proposal SET status = 'rejected', confirm_token_hash = NULL WHERE id = ? AND status = 'pending'", [id]);
  return res.changes === 1;
}
