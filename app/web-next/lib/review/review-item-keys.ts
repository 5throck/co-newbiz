// Locale-key catalog for review items (Fix 3, design 2026-11-06 PR3).
//
// Every synthesized review item carries one of these keys plus its params; the
// frontend resolves them via next-intl (ADR-0184). The stored English
// `claim`/`reason` stay canonical for audit and MCP consumers — keys are
// ADDITIVE metadata, never a replacement.
//
// Key naming: `review.ai1.*` for deterministic AI 1st templates (lib/review/
// ai-first.ts), `review.ai2.*` for AI 2nd synthesized/free-text items
// (lib/review/ai-second.ts). Message ids in messages/ko.json and en.json use
// the same dotted names, so a catalog entry IS its next-intl message id.

export const REVIEW_ITEM_KEYS = {
  ai1StageComplete: "review.ai1.stageComplete",
  ai1StageSubstance: "review.ai1.stageSubstance",
  ai1StageSkipped: "review.ai1.stageSkipped",
  ai1StageTerminated: "review.ai1.stageTerminated",
  ai1StageIncomplete: "review.ai1.stageIncomplete",
  ai1StageNotReached: "review.ai1.stageNotReached",
  ai1StageLocked: "review.ai1.stageLocked",
  ai1GateVerdict: "review.ai1.gateVerdict",
  ai1StageAcceptance: "review.ai1.stageAcceptance",
  ai1ContentAccuracy: "review.ai1.contentAccuracy",
  ai2NotPerformed: "review.ai2.notPerformed",
  ai2FallbackReviewer: "review.ai2.fallbackReviewer",
  ai2ExemptAgents: "review.ai2.exemptAgents",
  ai2UnresolvedAgents: "review.ai2.unresolvedAgents",
  /** Standing scope declarations (internal-item-filter.ts): never-empty could_not_verify. */
  ai2SourcesNotInspected: "review.ai2.sourcesNotInspected",
  ai2LegacyScopeNotDeclared: "review.ai2.legacyScopeNotDeclared",
  /** Free LLM text: stored English is the audit record; kept as authored. */
  ai2FreeText: "review.ai2.freeText",
} as const;

export type ReviewItemKey = (typeof REVIEW_ITEM_KEYS)[keyof typeof REVIEW_ITEM_KEYS];

/** All catalog keys as a plain string array (tests and the frontend enumerate this). */
export const REVIEW_ITEM_KEY_LIST: ReviewItemKey[] = Object.values(REVIEW_ITEM_KEYS);

export const isReviewItemKey = (k: string): k is ReviewItemKey => (REVIEW_ITEM_KEY_LIST as string[]).includes(k);
