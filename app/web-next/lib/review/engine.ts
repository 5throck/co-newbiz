// Review engine façade (ADR-0153): AI 1st + AI 2nd over the gate-proposal
// artifacts, plus the read view the gate panel renders. Writes review_stage
// rows only — never gate_decision / approvals / transitions (boundary #2).
import type { Database } from "bun:sqlite";
import { getDb } from "../../../../db/client.ts";
import {
  findReview,
  insertAiReview,
  latestReviews,
  monthlyTokensUsed,
  type ReviewBuckets,
  type ReviewItem,
  type ReviewStageRecord,
} from "../../../../db/repositories/review.repository.ts";
import { runAiFirstChecks } from "./ai-first.ts";
import { defaultAi2ndDeps, monthlyTokenCap, runAiSecond, type Ai2ndDeps, type Ai2ndResult } from "./ai-second.ts";
import { buildGateArtifact, type GateArtifact, type ReviewGate } from "./gate-artifacts.ts";

export interface ReviewRunContext {
  gate: ReviewGate;
  entityId: string;
  /** The calling user (boundary #1: no agent service account). */
  userId: string;
  db?: Database;
  now?: string;
}

export interface Ai1stResult {
  artifact: GateArtifact;
  id: string;
  cached: boolean;
  buckets: ReviewBuckets;
}

/** AI 1st: deterministic; unchanged content reuses the stored row. */
export function runAiFirst(
  ctx: ReviewRunContext,
  artifact: GateArtifact = buildGateArtifact(ctx.gate, ctx.entityId),
): Ai1stResult {
  const db = ctx.db ?? getDb();
  const hit = findReview(
    "ai_1st",
    artifact.entityType,
    artifact.entityId,
    artifact.artifactKey,
    artifact.contentHash,
    db,
  );
  if (hit?.buckets_json) {
    return { artifact, id: hit.id, cached: true, buckets: JSON.parse(hit.buckets_json) as ReviewBuckets };
  }
  const buckets = runAiFirstChecks(artifact);
  const id = insertAiReview({
    stage: "ai_1st",
    artifactKey: artifact.artifactKey,
    entityType: artifact.entityType,
    entityId: artifact.entityId,
    stageId: artifact.stageId,
    contentHash: artifact.contentHash,
    buckets,
    authorDomain: null,
    reviewerAgent: "deterministic-checks",
    reviewerDomain: null,
    performed: true,
    requestedBy: ctx.userId,
    db,
    now: ctx.now,
  });
  return { artifact, id, cached: false, buckets };
}

/** AI 1st then AI 2nd (on demand). */
export async function runReview(
  ctx: ReviewRunContext,
  deps: Ai2ndDeps = defaultAi2ndDeps,
): Promise<{ ai1st: Ai1stResult; ai2nd: Ai2ndResult }> {
  const ai1st = runAiFirst(ctx);
  const ai2nd = await runAiSecond(
    { artifact: ai1st.artifact, ai1stBuckets: ai1st.buckets, userId: ctx.userId, db: ctx.db, now: ctx.now },
    deps,
  );
  return { ai1st, ai2nd };
}

export interface ReviewView {
  gate: ReviewGate;
  artifact_key: string;
  content_hash: string;
  /** Latest rows per stage; `current` = reviewed the artifact as it is now. */
  stages: Array<{ stage: ReviewStageRecord["stage"]; id: string; current: boolean; created_at: string }>;
  ai_1st: ReviewStageView | null;
  ai_2nd: ReviewStageView | null;
  token_cap: { used: number; cap: number };
}

export interface ReviewStageView {
  id: string;
  origin: string;
  reviewer_agent: string;
  reviewer_domain: string | null;
  author_domain: string | null;
  performed: boolean;
  not_performed_reason: string | null;
  current: boolean;
  created_at: string;
  verified: ReviewItem[];
  could_not_verify: ReviewItem[];
  needs_judgement: ReviewItem[];
}

function toView(row: ReviewStageRecord, currentHash: string): ReviewStageView {
  const buckets = row.buckets_json
    ? (JSON.parse(row.buckets_json) as ReviewBuckets)
    : { verified: [], could_not_verify: JSON.parse(row.unverified_items_json) as ReviewItem[], needs_judgement: [] };
  return {
    id: row.id,
    origin: row.stage === "ai_1st" ? "AI 1st" : "AI 2nd",
    reviewer_agent: row.reviewer_agent_or_user,
    reviewer_domain: row.reviewer_domain,
    author_domain: row.author_domain,
    performed: row.performed === 1,
    not_performed_reason: row.not_performed_reason,
    current: row.content_hash === currentHash,
    created_at: row.created_at,
    ...buckets,
  };
}

export function getReviewView(
  gate: ReviewGate,
  entityId: string,
  db: Database = getDb(),
  now = new Date().toISOString(),
): ReviewView {
  const artifact = buildGateArtifact(gate, entityId);
  const rows = latestReviews(artifact.entityType, entityId, artifact.artifactKey, db);
  const by = (s: ReviewStageRecord["stage"]) => rows.find((r) => r.stage === s) ?? null;
  const first = by("ai_1st");
  const second = by("ai_2nd");
  return {
    gate,
    artifact_key: artifact.artifactKey,
    content_hash: artifact.contentHash,
    stages: rows.map((r) => ({
      stage: r.stage,
      id: r.id,
      current: r.content_hash === artifact.contentHash,
      created_at: r.created_at,
    })),
    ai_1st: first ? toView(first, artifact.contentHash) : null,
    ai_2nd: second ? toView(second, artifact.contentHash) : null,
    token_cap: { used: monthlyTokensUsed(artifact.entityType, entityId, now, db), cap: monthlyTokenCap() },
  };
}
