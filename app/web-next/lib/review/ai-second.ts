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
  type ProvenanceItem,
  type ReviewBuckets,
  type ReviewEntityType,
  type ReviewItem,
  type ReviewStageRecord,
} from "../../../../db/repositories/review.repository.ts";
import { complete, completeStructured, getProviderConfig, isLlmConfigured, type LlmMessage } from "../llm.ts";
import { estimateTokens as estimateTokensFallback, totalTokens } from "../llm-usage.ts";
import { artifactTypeFor, selectReviewer } from "./domains.ts";
import { canonicalJson, sanitizeContentForReview } from "./gate-artifacts.ts";
import {
  PROVENANCE_CODES,
  SOURCES_NOT_INSPECTED_ITEM,
  ensureCouldNotVerify,
  filterInternalItems,
  reclassifyLegacyProvenance,
} from "./internal-item-filter.ts";
import type { ReviewArtifact } from "./stage-artifacts.ts";
import { hasStructuralGaps } from "./ai-first.ts";
import { Ai2ndOutputSchema, type Ai2ndOutput } from "./schema.ts";
import { REVIEW_ITEM_KEYS } from "./review-item-keys.ts";

/** Tag LLM free-text items with the locale key; stored English stays the audit record. */
const tagFreeText = (b: ReviewBuckets): ReviewBuckets => {
  const tag = (items: ReviewItem[]): ReviewItem[] =>
    items.map((i) => (i.key ? i : { ...i, key: REVIEW_ITEM_KEYS.ai2FreeText }));
  return {
    verified: tag(b.verified),
    could_not_verify: tag(b.could_not_verify),
    needs_judgement: tag(b.needs_judgement),
  };
};

export const DEFAULT_REVIEW_MONTHLY_TOKEN_CAP = 200_000;

/** Per-project (entity) monthly AI 2nd token cap — env REVIEW_MONTHLY_TOKEN_CAP, default 200k. */
export function monthlyTokenCap(): number {
  const raw = Number(process.env.REVIEW_MONTHLY_TOKEN_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_REVIEW_MONTHLY_TOKEN_CAP;
}

/** chars/4 fallback — used only when the provider response carries no usage (Wave B B-1). */
export const estimateTokens = estimateTokensFallback;

export interface Ai2ndDeps {
  complete: (
    messages: LlmMessage[],
    opts?: { temperature?: number; maxTokens?: number; reviewerAgent?: string },
  ) => Promise<string>;
  /** Preferred path (schema-validated, repaired once, real usage). Absent → legacy text path via `complete`. */
  completeStructured?: (
    messages: LlmMessage[],
    opts: { temperature: number; maxTokens: number; reviewerAgent: string },
  ) => Promise<{ value: Ai2ndOutput; tokens: number | null } | null>;
  isConfigured: () => boolean;
  modelId: () => string | null;
}
export const defaultAi2ndDeps: Ai2ndDeps = {
  // 런 장부 agent_key는 agents/ 로스터의 키여야 한다(ADR-0183 D2 관문 검증) —
  // 가상 키 "ai-second-reviewer" 대신 실제 선정된 도메인 리드 리뷰어로 귀속한다.
  complete: (messages, opts = {}) =>
    complete(messages, {
      ...opts,
      agent: {
        key: opts.reviewerAgent ?? "pm",
        purpose: "AI 2nd cross-domain review",
        functionName: "review.ai_second",
      },
    }),
  completeStructured: async (messages, opts) => {
    const r = await completeStructured({
      messages,
      schema: Ai2ndOutputSchema,
      schemaName: "ai_second_review",
      cache: { system: true },
      agent: { key: opts.reviewerAgent, purpose: "AI 2nd cross-domain review", functionName: "review.ai_second" },
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });
    if (r.source !== "llm") return null;
    // Real provider usage; an estimated record falls back to chars/4 by construction.
    return { value: r.value, tokens: totalTokens(r.usage) };
  },
  isConfigured: isLlmConfigured,
  modelId: () => getProviderConfig()?.model ?? null,
};

export interface Ai2ndRequest {
  artifact: ReviewArtifact;
  ai1stBuckets: ReviewBuckets;
  userId: string;
  /** Advisory BCP-47 locale from the UI; items are written in it when set. */
  locale?: string;
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
  'Each item is {"claim": string, "reason": string, "evidence_ref": string (optional)}. Use only the artifact provided; do not invent facts. ' +
  "Stages the entity has not reached yet are omitted from the artifact and are out of scope: do not grade, list or speculate about them. " +
  "Do not raise items about system identifiers (entity ids, ULIDs, run ids), schema or plumbing fields, data-model nullability that an annotation in the artifact already explains (for example a field marked 'not yet decided'), or reviewer routing and agent assignment. " +
  "Raise only matters about the deal's substance and its evidence.";

/**
 * Artifact content as sent to the reviewer: opaque identifiers omitted, a null
 * owned by a stage that has not run yet (track before the S4 route decision)
 * annotated, and stages the entity has not reached dropped. The stored
 * artifact (and its content hash) is untouched.
 */
export function ai2ndPayloadContent(content: Record<string, unknown>): Record<string, unknown> {
  const clean = sanitizeContentForReview(content);
  const stages = clean.stages;
  if (!Array.isArray(stages)) return clean;
  return {
    ...clean,
    stages: stages.filter(
      (s) => !(s && typeof s === "object" && (s as { not_reached?: unknown }).not_reached === true),
    ),
  };
}

export function buildAi2ndMessages(
  artifact: ReviewArtifact,
  reviewerAgent: string,
  reviewerDomain: string,
  authorDomain: string,
  locale?: string,
): LlmMessage[] {
  const system = locale
    ? `${SYSTEM_PROMPT}\nWrite the claim and reason text of every item in ${locale} (BCP-47). Keep evidence_ref values and JSON keys exactly as specified.`
    : SYSTEM_PROMPT;
  return [
    { role: "system", content: system },
    {
      role: "user",
      content:
        `Reviewer persona: ${reviewerAgent} (${reviewerDomain} domain). Author domain: ${authorDomain}.\n` +
        `Artifact key: ${artifact.artifactKey}\nArtifact:\n${canonicalJson(ai2ndPayloadContent(artifact.content))}`,
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
  const stored: ReviewBuckets = row.buckets_json
    ? (JSON.parse(row.buckets_json) as ReviewBuckets)
    : { verified: [], could_not_verify: JSON.parse(row.unverified_items_json) as ReviewItem[], needs_judgement: [] };
  // Legacy rows keep routing claims in could_not_verify; split them out at read time.
  return reclassifyLegacyProvenance(stored);
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
        {
          claim: "AI 2nd cross-domain review was not performed",
          reason: opts.reason ?? "unspecified",
          key: REVIEW_ITEM_KEYS.ai2NotPerformed,
          params: { reason: opts.reason ?? "unspecified" },
        },
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

  // Every stage of the gate is still ahead of the entity: after dropping the
  // not-reached stages the reviewer would receive an empty artifact (and spend
  // tokens on nothing). Recorded as not performed, never as a pass.
  if (artifact.stages.length > 0 && artifact.stages.every((s) => s.not_reached === true)) {
    return record({
      performed: false,
      reviewerAgent: "none",
      reviewerDomain: null,
      authorDomain: null,
      reason: "No stage of this gate has been reached yet; there is nothing to review cross-domain",
    });
  }

  // ADR-0187 P4: stage artifacts route by their matrix artifact type; gate
  // bundles span several types and use the matrix "bundle" row.
  const sel = selectReviewer(
    artifact.authorAgents,
    "kind" in artifact && artifact.kind === "stage"
      ? { artifactType: artifactTypeFor(artifact.stageId, artifact.artifactName) }
      : {},
  );
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

  const messages = buildAi2ndMessages(artifact, sel.reviewerAgent, sel.reviewerDomain, sel.authorDomain, req.locale);
  const promptTokens = estimateTokens(messages.map((m) => m.content).join("\n"));
  const cap = monthlyTokenCap();
  const used = monthlyTokensUsed(entityType, artifact.entityId, now, db);
  if (used + promptTokens > cap) {
    return record({ ...base, performed: false, reason: `monthly token cap reached (used ${used} of ${cap})` });
  }

  let spent = 0;
  let parsed: Ai2ndOutput | null = null;
  if (deps.completeStructured) {
    try {
      const r = await deps.completeStructured(messages, {
        temperature: 0,
        maxTokens: 1500,
        reviewerAgent: sel.reviewerAgent,
      });
      if (r) {
        parsed = r.value;
        spent = r.tokens ?? promptTokens;
      }
    } catch (err) {
      return record({
        ...base,
        performed: false,
        reason: `LLM call failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  } else {
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      let text: string;
      try {
        text = await deps.complete(messages, { temperature: 0, maxTokens: 1500, reviewerAgent: sel.reviewerAgent });
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

  // Conservative post-filter: LLM items that are pure plumbing (identifiers,
  // null-field or routing talk with no deal content) leave the decision
  // buckets; each is kept verbatim as provenance so the audit trail is intact.
  const filtered = filterInternalItems({ ...parsed });
  const buckets: ReviewBuckets = tagFreeText(filtered.buckets);
  // could_not_verify is never empty — a filter that empties it must declare a real scope gap.
  buckets.could_not_verify = ensureCouldNotVerify(buckets.could_not_verify, SOURCES_NOT_INSPECTED_ITEM);

  // How the review was ROUTED is provenance, not a deal gap: it goes to
  // `provenance`, never into the human decision buckets.
  const provenance: ProvenanceItem[] = [];
  if (sel.fallbackUsed) {
    provenance.push({
      code: PROVENANCE_CODES.fallbackReviewer,
      params: {
        fallbackReason: sel.fallbackReason,
        reviewerAgent: sel.reviewerAgent,
        specialist: sel.firstStageSpecialist ?? null,
      },
    });
  }
  if (sel.exemptAgents.length > 0) {
    provenance.push({ code: PROVENANCE_CODES.orchestratorExempt, params: { agents: sel.exemptAgents.join(", ") } });
  }
  if (sel.unresolvedAgents.length > 0) {
    provenance.push({ code: PROVENANCE_CODES.unresolvedAgent, params: { agents: sel.unresolvedAgents.join(", ") } });
  }
  buckets.provenance = [...provenance, ...filtered.dropped];
  return record({ ...base, performed: true, buckets, modelId: deps.modelId(), costTokens: spent });
}
