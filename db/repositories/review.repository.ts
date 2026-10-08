// review_stage store (ADR-0153, Wave F PR F-2).
//
// The ONLY writer of review_stage. It deliberately has no import path to
// gate_decision / approval / venture_transition_decision writers (boundary #2):
// the review runtime produces proposals and gaps, never decisions.
//
//   - insertAiReview   : ai_1st / ai_2nd rows. `result` is not even a
//                        parameter — AI stages carry NO PASS STAMP (the 0124
//                        CHECK backs this up at the table).
//   - insertHumanFinal : the only stage whose `result` holds a decision word,
//                        and it is the human's. Written as a side effect of a
//                        human gate / transition POST; an agent id as the
//                        reviewer is refused (boundary #1/#2).
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

export type ReviewEntityType = "project" | "opportunity";
export type AiReviewStage = "ai_1st" | "ai_2nd";

export interface ReviewItem {
  claim: string;
  reason: string;
  evidence_ref?: string;
  /** AI 1st only: a structural gap (missing/incomplete) that gates AI 2nd. */
  structural?: boolean;
}
export interface ReviewBuckets {
  verified: ReviewItem[];
  could_not_verify: ReviewItem[];
  needs_judgement: ReviewItem[];
}

export interface ReviewStageRecord {
  id: string;
  stage: "ai_1st" | "ai_2nd" | "human_final";
  reviewer_agent_or_user: string;
  reviewer_domain: string | null;
  unverified_items_json: string;
  result: string | null;
  created_at: string;
  artifact_key: string | null;
  entity_type: ReviewEntityType | null;
  entity_id: string | null;
  stage_id: string | null;
  content_hash: string | null;
  buckets_json: string | null;
  author_domain: string | null;
  model_id: string | null;
  cost_tokens: number;
  performed: number;
  not_performed_reason: string | null;
  requested_by: string | null;
  reviewed_refs_json: string | null;
}

export class ReviewWriteError extends Error {
  constructor(
    public code: "invalid_stage" | "agent_forbidden" | "invalid_input",
    message: string,
  ) {
    super(message);
  }
}

export interface InsertAiReviewInput {
  stage: AiReviewStage;
  artifactKey: string;
  entityType: ReviewEntityType;
  entityId: string;
  stageId: string;
  contentHash: string;
  buckets: ReviewBuckets;
  authorDomain: string | null;
  /** The persona that performed the review (e.g. platform-lead); never a user. */
  reviewerAgent: string;
  reviewerDomain: string | null;
  modelId?: string | null;
  costTokens?: number;
  /** false => the review was NOT performed; the reason is recorded. */
  performed: boolean;
  notPerformedReason?: string | null;
  /** The calling user (boundary #1: agents run with the caller's permissions). */
  requestedBy: string;
  db?: Database;
  now?: string;
}

export function insertAiReview(input: InsertAiReviewInput): string {
  // Defensive: callers are typed, but a JS/any caller must still not be able
  // to write a human stage through the AI path.
  if ((input.stage as string) !== "ai_1st" && (input.stage as string) !== "ai_2nd") {
    throw new ReviewWriteError("invalid_stage", `insertAiReview cannot write stage '${String(input.stage)}'.`);
  }
  if (!input.performed && !input.notPerformedReason) {
    throw new ReviewWriteError("invalid_input", "A review that was not performed must record why.");
  }
  if (input.buckets.could_not_verify.length === 0) {
    throw new ReviewWriteError(
      "invalid_input",
      "could_not_verify must never be empty — a reviewer that checked everything is not credible.",
    );
  }
  const db = input.db ?? getDb();
  const id = ulid();
  db.run(
    `INSERT INTO review_stage
       (id, run_id, stage, reviewer_agent_or_user, reviewer_domain, unverified_items_json, result, created_at,
        artifact_key, entity_type, entity_id, stage_id, content_hash, buckets_json, author_domain, model_id,
        cost_tokens, performed, not_performed_reason, requested_by, reviewed_refs_json)
     VALUES (?,NULL,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
    [
      id,
      input.stage,
      input.reviewerAgent,
      input.reviewerDomain,
      JSON.stringify(input.buckets.could_not_verify),
      input.now ?? new Date().toISOString(),
      input.artifactKey,
      input.entityType,
      input.entityId,
      input.stageId,
      input.contentHash,
      JSON.stringify(input.buckets),
      input.authorDomain,
      input.modelId ?? null,
      input.costTokens ?? 0,
      input.performed ? 1 : 0,
      input.performed ? null : (input.notPerformedReason ?? null),
      input.requestedBy,
    ],
  );
  return id;
}

export interface InsertHumanFinalInput {
  artifactKey: string;
  entityType: ReviewEntityType;
  entityId: string;
  stageId: string;
  contentHash: string | null;
  /** The session user who recorded the gate / transition decision. */
  reviewerUser: string;
  /** The human's decision word (go|hold|kill or a transition decision). */
  result: string;
  /** AI-declared items still unverified at the moment the human decided. */
  unverifiedItems: ReviewItem[];
  /** AI review rows + artifact hash the human saw. */
  reviewedRefs: { ai_1st_id?: string | null; ai_2nd_id?: string | null; content_hash?: string | null };
  /** Agent persona ids — never a valid human reviewer (boundary #1/#2). */
  agentIds: ReadonlySet<string>;
  db?: Database;
  now?: string;
}

export function insertHumanFinal(input: InsertHumanFinalInput): string {
  if (!input.reviewerUser.trim() || input.agentIds.has(input.reviewerUser)) {
    throw new ReviewWriteError(
      "agent_forbidden",
      "human_final must be written for a human user, never an agent id (boundary #1/#2).",
    );
  }
  if (!input.result.trim()) {
    throw new ReviewWriteError("invalid_input", "human_final requires the human's decision word.");
  }
  const db = input.db ?? getDb();
  const id = ulid();
  db.run(
    `INSERT INTO review_stage
       (id, run_id, stage, reviewer_agent_or_user, reviewer_domain, unverified_items_json, result, created_at,
        artifact_key, entity_type, entity_id, stage_id, content_hash, buckets_json, author_domain, model_id,
        cost_tokens, performed, not_performed_reason, requested_by, reviewed_refs_json)
     VALUES (?,NULL,'human_final',?,NULL,?,?,?,?,?,?,?,?,NULL,NULL,NULL,0,1,NULL,?,?)`,
    [
      id,
      input.reviewerUser,
      JSON.stringify(input.unverifiedItems),
      input.result,
      input.now ?? new Date().toISOString(),
      input.artifactKey,
      input.entityType,
      input.entityId,
      input.stageId,
      input.contentHash,
      input.reviewerUser,
      JSON.stringify(input.reviewedRefs),
    ],
  );
  return id;
}

/** Latest row of one stage for the exact artifact content (the cache lookup). */
export function findReview(
  stage: "ai_1st" | "ai_2nd" | "human_final",
  entityType: ReviewEntityType,
  entityId: string,
  artifactKey: string,
  contentHash: string | null,
  db: Database = getDb(),
): ReviewStageRecord | null {
  const row =
    contentHash === null
      ? db
          .query(
            `SELECT * FROM review_stage WHERE stage = ? AND entity_type = ? AND entity_id = ? AND artifact_key = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
          )
          .get(stage, entityType, entityId, artifactKey)
      : db
          .query(
            `SELECT * FROM review_stage WHERE stage = ? AND entity_type = ? AND entity_id = ? AND artifact_key = ? AND content_hash = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
          )
          .get(stage, entityType, entityId, artifactKey, contentHash);
  return (row as ReviewStageRecord | null) ?? null;
}

/** Latest row per stage for an artifact, any content hash (history view). */
export function latestReviews(
  entityType: ReviewEntityType,
  entityId: string,
  artifactKey: string,
  db: Database = getDb(),
): ReviewStageRecord[] {
  return db
    .query(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY stage ORDER BY created_at DESC, id DESC) AS rn
         FROM review_stage WHERE entity_type = ? AND entity_id = ? AND artifact_key = ?
       ) WHERE rn = 1 ORDER BY created_at ASC`,
    )
    .all(entityType, entityId, artifactKey) as ReviewStageRecord[];
}

/** Tokens spent on ai_2nd reviews of one entity in the calendar month of `at` (UTC). */
export function monthlyTokensUsed(
  entityType: ReviewEntityType,
  entityId: string,
  at: string,
  db: Database = getDb(),
): number {
  const row = db
    .query(
      `SELECT COALESCE(SUM(cost_tokens), 0) AS used FROM review_stage
       WHERE entity_type = ? AND entity_id = ? AND stage = 'ai_2nd' AND substr(created_at, 1, 7) = ?`,
    )
    .get(entityType, entityId, at.slice(0, 7)) as { used: number };
  return row.used;
}
