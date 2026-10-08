// AI 2nd stage — LLM reviewer from a DIFFERENT domain than the author
// (ADR-0153 §4.3-4.5). Contract:
//   - Output is Zod-validated into verified / could_not_verify /
//     needs_judgement; could_not_verify can never be empty.
//   - NO silent fallback: a missing/unresolvable reviewer, an unconfigured
//     LLM, a hit token cap, structural gaps from AI 1st or unusable model
//     output are each recorded as a review that was NOT PERFORMED — never as a
//     pass, never as a same-domain or synthesized review. (lib/llm
//     completeOrFallback is deliberately not used.)
//   - Cost control: content-hash cache (a hit makes no LLM call), AI 1st must
//     have no structural gaps, on-demand trigger, per-entity monthly token cap.
//   - The module can write review_stage rows ONLY (boundary #2); it has no
//     import path to the gate / approval / transition writers.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../../db/client.ts";
import {
  findReview,
  insertAiReview,
  monthlyTokensUsed,
  type ReviewBuckets,
  type ReviewEntityType,
  type ReviewItem,
  type ReviewStageRecord,
} from "../../../../db/repositories/review.repository.ts";
import { complete, getProviderConfig, isLlmConfigured, type LlmMessage } from "../llm.ts";
import { selectReviewer } from "./domains.ts";
import { canonicalJson, type GateArtifact } from "./gate-artifacts.ts";
import { hasStructuralGaps } from "./ai-first.ts";
import { Ai2ndOutputSchema, type Ai2ndOutput } from "./schema.ts";

export const DEFAULT_REVIEW_MONTHLY_TOKEN_CAP = 200_000;

/** Per-project (entity) monthly AI 2nd token cap — env REVIEW_MONTHLY_TOKEN_CAP, default 200k. */
export function monthlyTokenCap(): number {
  const raw = Number(process.env.REVIEW_MONTHLY_TOKEN_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_REVIEW_MONTHLY_TOKEN_CAP;
}

/** Rough token estimate (≈4 chars/token); the provider call returns text only. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface Ai2ndDeps {
  complete: (messages: LlmMessage[], opts?: { temperature?: number; maxTokens?: number }) => Promise<string>;
  isConfigured: () => boolean;
  modelId: () => string | null;
}
export const defaultAi2ndDeps: Ai2ndDeps = {
  complete,
  isConfigured: isLlmConfigured,
  modelId: () => getProviderConfig()?.model ?? null,
};

export interface Ai2ndRequest {
  artifact: GateArtifact;
  ai1stBuckets: ReviewBuckets;
  userId: string;
  db?: Database;
  now?: string;
}

export interface Ai2ndResult {
  id: string;
  cached: boolean;
  performed: boolean;
  notPerformedReason: string | null;
  buckets: ReviewBuckets;
}

const SYSTEM_PROMPT =
  "You are a reviewer for a new-business investment review team. You review a gate-proposal artifact written by agents from another domain. " +
  "You produce decision SUPPORT only: you never approve, pass, score, or recommend go/hold/kill — a person decides. " +
  "Respond with ONE JSON object and nothing else, with exactly these keys: " +
  '"verified" (claims you could confirm from the artifact text itself), ' +
  '"could_not_verify" (everything you could NOT check — source accuracy, missing evidence, anything outside the artifact; you MUST list at least one, because no reviewer checks everything), ' +
  '"needs_judgement" (points where a human must weigh trade-offs). ' +
  'Each item is {"claim": string, "reason": string, "evidence_ref": string (optional)}. Use only the artifact provided; do not invent facts.';

export function buildAi2ndMessages(
  artifact: GateArtifact,
  reviewerAgent: string,
  reviewerDomain: string,
  authorDomain: string,
): LlmMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Reviewer persona: ${reviewerAgent} (${reviewerDomain} domain). Author domain: ${authorDomain}.\n` +
        `Artifact key: ${artifact.artifactKey}\nArtifact:\n${canonicalJson(artifact.content)}`,
    },
  ];
}

/** Extract + validate the JSON object from a model reply; null when unusable. */
export function parseAi2ndOutput(text: string): Ai2ndOutput | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = Ai2ndOutputSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toRecordBuckets(row: ReviewStageRecord): ReviewBuckets {
  return row.buckets_json
    ? (JSON.parse(row.buckets_json) as ReviewBuckets)
    : { verified: [], could_not_verify: JSON.parse(row.unverified_items_json) as ReviewItem[], needs_judgement: [] };
}

export async function runAiSecond(req: Ai2ndRequest, deps: Ai2ndDeps = defaultAi2ndDeps): Promise<Ai2ndResult> {
  const { artifact } = req;
  const db = req.db ?? getDb();
  const now = req.now ?? new Date().toISOString();
  const entityType: ReviewEntityType = artifact.entityType;

  // Content-hash cache: an unchanged artifact is never re-reviewed.
  const hit = findReview("ai_2nd", entityType, artifact.entityId, artifact.artifactKey, artifact.contentHash, db);
  if (hit && hit.performed === 1) {
    return { id: hit.id, cached: true, performed: true, notPerformedReason: null, buckets: toRecordBuckets(hit) };
  }

  const record = (opts: {
    performed: boolean;
    reason?: string;
    buckets?: ReviewBuckets;
    reviewerAgent: string;
    reviewerDomain: string | null;
    authorDomain: string | null;
    modelId?: string | null;
    costTokens?: number;
  }): Ai2ndResult => {
    const buckets: ReviewBuckets = opts.buckets ?? {
      verified: [],
      could_not_verify: [
        { claim: "AI 2nd cross-domain review was not performed", reason: opts.reason ?? "unspecified" },
      ],
      needs_judgement: [],
    };
    // A repeated identical "not performed" outcome reuses its row (no spam).
    if (!opts.performed && hit && hit.performed === 0 && hit.not_performed_reason === opts.reason) {
      return {
        id: hit.id,
        cached: true,
        performed: false,
        notPerformedReason: opts.reason ?? null,
        buckets: toRecordBuckets(hit),
      };
    }
    const id = insertAiReview({
      stage: "ai_2nd",
      artifactKey: artifact.artifactKey,
      entityType,
      entityId: artifact.entityId,
      stageId: artifact.stageId,
      contentHash: artifact.contentHash,
      buckets,
      authorDomain: opts.authorDomain,
      reviewerAgent: opts.reviewerAgent,
      reviewerDomain: opts.reviewerDomain,
      modelId: opts.modelId ?? null,
      costTokens: opts.costTokens ?? 0,
      performed: opts.performed,
      notPerformedReason: opts.reason ?? null,
      requestedBy: req.userId,
      db,
      now,
    });
    return {
      id,
      cached: false,
      performed: opts.performed,
      notPerformedReason: opts.performed ? null : (opts.reason ?? null),
      buckets,
    };
  };

  // AI 1st must be structurally clean — missing data is not worth reviewing.
  if (hasStructuralGaps(req.ai1stBuckets)) {
    return record({
      performed: false,
      reviewerAgent: "none",
      reviewerDomain: null,
      authorDomain: null,
      reason: "AI 1st found structural gaps (incomplete or locked stages); nothing worth cross-domain review yet",
    });
  }

  const sel = selectReviewer(artifact.authorAgents);
  if (!sel.ok) {
    return record({
      performed: false,
      reviewerAgent: "none",
      reviewerDomain: null,
      authorDomain: sel.authorDomain,
      reason: sel.reason,
    });
  }
  const base = { reviewerAgent: sel.reviewerAgent, reviewerDomain: sel.reviewerDomain, authorDomain: sel.authorDomain };

  if (!deps.isConfigured()) {
    return record({ ...base, performed: false, reason: "LLM provider is not configured" });
  }

  const messages = buildAi2ndMessages(artifact, sel.reviewerAgent, sel.reviewerDomain, sel.authorDomain);
  const promptTokens = estimateTokens(messages.map((m) => m.content).join("\n"));
  const cap = monthlyTokenCap();
  const used = monthlyTokensUsed(entityType, artifact.entityId, now, db);
  if (used + promptTokens > cap) {
    return record({ ...base, performed: false, reason: `monthly token cap reached (used ${used} of ${cap})` });
  }

  let spent = 0;
  let parsed: Ai2ndOutput | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    let text: string;
    try {
      text = await deps.complete(messages, { temperature: 0, maxTokens: 1500 });
    } catch (err) {
      return record({
        ...base,
        performed: false,
        costTokens: spent,
        reason: `LLM call failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
    spent += promptTokens + estimateTokens(text);
    parsed = parseAi2ndOutput(text);
  }
  if (!parsed) {
    return record({
      ...base,
      performed: false,
      costTokens: spent,
      modelId: deps.modelId(),
      reason: "reviewer output was not valid after one retry",
    });
  }

  const buckets: ReviewBuckets = { ...parsed };
  if (sel.unresolvedAgents.length > 0) {
    buckets.could_not_verify = [
      ...buckets.could_not_verify,
      {
        claim: "Domain of some authoring agents could not be resolved",
        reason: `Excluded from the cross-domain check: ${sel.unresolvedAgents.join(", ")}.`,
      },
    ];
  }
  return record({ ...base, performed: true, buckets, modelId: deps.modelId(), costTokens: spent });
}
