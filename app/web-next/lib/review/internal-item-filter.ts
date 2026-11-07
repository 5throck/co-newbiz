// Keeps system-internal items off the human decision surface (design
// 2026-11-07-review-internal-items). Pure module: no server imports, so the
// client may import it too.
//
// Three jobs, all conservative ("when in doubt, keep the item"):
//   1. filterInternalItems  — drop AI 2nd LLM items that are pure plumbing
//      (identifier / null-field / routing talk with NO deal content) and record
//      each dropped item as `filtered_internal_item` provenance (audit intact).
//   2. ensureCouldNotVerify — could_not_verify is never empty; silence is never
//      approval.
//   3. reclassifyLegacyProvenance — stored reviews are not migrated; at read
//      time the routing claims older rows kept in could_not_verify move into
//      `provenance`.
// Provenance is persisted INSIDE the existing buckets_json column (no schema
// change) and is never counted as a bucket item.
import type { ProvenanceItem, ReviewBuckets, ReviewItem } from "../../../../db/repositories/review.repository.ts";
import { REVIEW_ITEM_KEYS } from "./review-item-keys.ts";
import KO from "./internal-item-patterns.json";

/** Append the Korean vocabulary fragment (internal-item-patterns.json) to an English pattern. */
const withKo = (en: RegExp, ko: string): RegExp => new RegExp(`${en.source}|${ko}`, "i");

export const PROVENANCE_CODES = {
  fallbackReviewer: "fallback_reviewer",
  orchestratorExempt: "orchestrator_exempt",
  unresolvedAgent: "unresolved_agent",
  filteredInternalItem: "filtered_internal_item",
} as const;

type ThreeBuckets = Pick<ReviewBuckets, "verified" | "could_not_verify" | "needs_judgement">;

// ---------------------------------------------------------------------------
// Identifier tokens
// ---------------------------------------------------------------------------

const ULID_SRC = "\\b[0-9A-HJKMNP-TV-Z]{26}\\b";
const UUID_SRC = "\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b";
// Upper-case + digits, 8+ chars: a (possibly truncated) base32 id. Currency-led
// tokens (KRW1000000) are amounts, not ids.
const MIXED_ID_SRC = "\\b(?!(?:KRW|USD|EUR|JPY|CNY))(?=[0-9A-Z]*\\d)(?=[0-9A-Z]*[A-Z])[0-9A-Z]{8,}\\b";
// An id cut off with an ellipsis ("01M6...") — only tokens that contain a digit.
const TRUNC_ID_SRC = "\\b(?=[0-9A-Za-z]*\\d)[0-9A-Za-z]{3,}(?:\\.{2,}|…)";

const idRes = (): RegExp[] => [ULID_SRC, UUID_SRC, MIXED_ID_SRC, TRUNC_ID_SRC].map((s) => new RegExp(s, "g"));
const ID_FIELD_RE = /\b[a-z][a-z0-9]*_id\b/i;
const INTERNAL_FIELD_RE =
  /\b(?:entity_type|agent_key|stage_id|artifact_key|artifact_index|content_hash|review_stage|run_input)\b/i;
// `track` is also an ordinary word ("track record"), so it only counts when it
// is clearly used as a field: quoted, followed by field/value wording, or
// directly described as null/unset.
const TRACK_FIELD_RE = withKo(
  /[`"']track[`"']|\btrack\s*(?:field|value|attribute|property|column|=|:)|\btrack\s+(?:is\s+|was\s+)?(?:null|unset|empty|missing|undefined|not\s+set|blank)\b/i,
  KO.trackField,
);
const ROUTING_TERM_RE = withKo(
  /\b(?:orchestrat\w*|coordinating|coordination)\s+agents?\b|\bauthor(?:ing)?[- ](?:domain|agents?)\b|\breviewer\s+(?:routing|assignment)\b|\bfallback\s+routing\b|\bagent\s+assignment\b|\bunresolved\s+agents?\b/i,
  KO.routingTerm,
);

/** Does the text reference a system identifier, internal field or routing subject? */
export function referencesInternalToken(text: string): boolean {
  if (idRes().some((re) => re.test(text))) return true;
  return (
    ID_FIELD_RE.test(text) || INTERNAL_FIELD_RE.test(text) || TRACK_FIELD_RE.test(text) || ROUTING_TERM_RE.test(text)
  );
}

/** Remove identifier tokens and stage references (S1..S12) so what is left is the item's substance. */
export function stripIdentifierTokens(text: string): string {
  let out = text;
  for (const re of idRes()) out = out.replace(re, " ");
  return out
    .replace(/\bS(?:1[0-2]|[1-9])\b/g, " ")
    .replace(new RegExp(ID_FIELD_RE.source, "gi"), " ")
    .replace(new RegExp(INTERNAL_FIELD_RE.source, "gi"), " ");
}

// ---------------------------------------------------------------------------
// Deal content vs plumbing patterns
// ---------------------------------------------------------------------------

const DEAL_TERM_RE = withKo(
  /\b(?:evidence|findings?|risks?|market|revenue|sales|margin|profit|costs?|capex|opex|prices?|pricing|financ\w*|regulat\w*|licen[cs]\w*|permit\w*|certif\w*|customers?|competit\w*|valuation|npv|irr|wacc|demand|supply|contracts?|legal|tax\w*|complian\w*|synerg\w*|forecast\w*|assumption\w*|source\s+documents?|investment|target|capacity|growth|budget|kill)\b/i,
  KO.dealTerm,
);

const NULLISH_RE = withKo(/\b(?:null|unset|undefined|not\s+set|empty|missing|blank|absent)\b/i, KO.nullish);
const INTENDED_RE = withKo(
  /\b(?:intended|intentional(?:ly)?|by\s+design|data[- ]entry|missing[- ]data|data\s+error|input\s+error)\b/i,
  KO.intended,
);
const PROCEED_RE = withKo(
  /\b(?:allow|permit|let)\b[^.?!]{0,40}\bproceed\b|\bproceed\w*\s+with\b[^.?!]{0,30}\b(?:unset|null|missing|empty)\b/i,
  KO.proceed,
);
const FIELD_RE = withKo(/\b(?:fields?|schema|attributes?)\b/i, KO.schemaField);
const IDENTITY_RE = withKo(/\b(?:match(?:es)?|correspond\w*|reconcil\w*|ledger)\b/i, KO.identityMatch);
const ROUTING_RE = withKo(/\b(?:exclu\w+|exempt\w*|omitted|unresolved|assign\w*|rout\w+)\b/i, KO.routing);

const MAX_PLUMBING_LENGTH = 400;

/**
 * True only when ALL hold (design 3.4): the item references an internal token,
 * no deal-content term or number remains once identifiers are stripped, and it
 * matches a plumbing pattern. Anything else is kept.
 */
export function isInternalPlumbingItem(item: Pick<ReviewItem, "claim" | "reason">): boolean {
  const raw = `${item.claim}\n${item.reason}`;
  if (!referencesInternalToken(raw)) return false;
  const rest = stripIdentifierTokens(raw);
  if (rest.length > MAX_PLUMBING_LENGTH) return false;
  if (/\d/.test(rest)) return false;
  if (DEAL_TERM_RE.test(rest)) return false;
  return (
    NULLISH_RE.test(rest) ||
    INTENDED_RE.test(rest) ||
    PROCEED_RE.test(rest) ||
    ROUTING_RE.test(rest) ||
    FIELD_RE.test(rest) ||
    IDENTITY_RE.test(rest)
  );
}

export type FilterableBucket = "verified" | "could_not_verify" | "needs_judgement";

/**
 * Drop plumbing items from all three buckets. A `verified` item is dropped only
 * when it is purely about identifiers / schema fields (same predicate: it names
 * an internal token and carries no deal content), so nothing about the deal is
 * lost. Every dropped item is returned as `filtered_internal_item` provenance
 * carrying its original text.
 */
export function filterInternalItems<B extends ThreeBuckets>(buckets: B): { buckets: B; dropped: ProvenanceItem[] } {
  const dropped: ProvenanceItem[] = [];
  const run = (items: ReviewItem[], bucket: FilterableBucket): ReviewItem[] =>
    items.filter((it) => {
      if (!isInternalPlumbingItem(it)) return true;
      dropped.push({
        code: PROVENANCE_CODES.filteredInternalItem,
        params: {
          bucket,
          claim: it.claim,
          reason: it.reason,
          ...(it.evidence_ref ? { evidence_ref: it.evidence_ref } : {}),
        },
      });
      return false;
    });
  return {
    buckets: {
      ...buckets,
      verified: run(buckets.verified, "verified"),
      could_not_verify: run(buckets.could_not_verify, "could_not_verify"),
      needs_judgement: run(buckets.needs_judgement, "needs_judgement"),
    },
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Never-empty could_not_verify
// ---------------------------------------------------------------------------

/** Standing scope declaration used when filtering empties could_not_verify. */
export const SOURCES_NOT_INSPECTED_ITEM: ReviewItem = {
  claim: "Source documents behind the artifact were not inspected",
  key: REVIEW_ITEM_KEYS.ai2SourcesNotInspected,
  reason:
    "This review read only the artifact snapshot; the documents, data and records it refers to were not opened or verified.",
};

/** Declared for a legacy review whose could_not_verify held nothing but routing notes. */
export const LEGACY_SCOPE_NOT_DECLARED_ITEM: ReviewItem = {
  claim: "Scope not declared in this legacy review",
  key: REVIEW_ITEM_KEYS.ai2LegacyScopeNotDeclared,
  reason:
    "This review was recorded before reviewer-routing notes were separated from the could-not-verify list and declared no other gap. Treat the documents behind the artifact as not inspected.",
};

export function ensureCouldNotVerify(items: ReviewItem[], standing: ReviewItem): ReviewItem[] {
  return items.length > 0 ? items : [{ ...standing }];
}

// ---------------------------------------------------------------------------
// Legacy reclassification (read time)
// ---------------------------------------------------------------------------

const FALLBACK_CLAIMS = new Set([
  "Reviewer chosen by fallback routing, not by a cross-validation matrix entry",
  KO.legacyClaims.fallback,
]);
const EXEMPT_CLAIMS = new Set([
  "Orchestrator agents excluded from the author-domain check",
  KO.legacyClaims.exempt,
]);
const UNRESOLVED_CLAIMS = new Set([
  "Domain of some authoring agents could not be resolved",
  KO.legacyClaims.unresolved,
]);

type LegacyKind = "fallback" | "exempt" | "unresolved";

function legacyKind(it: ReviewItem): LegacyKind | null {
  if (it.key === REVIEW_ITEM_KEYS.ai2FallbackReviewer) return "fallback";
  if (it.key === REVIEW_ITEM_KEYS.ai2ExemptAgents) return "exempt";
  if (it.key === REVIEW_ITEM_KEYS.ai2UnresolvedAgents) return "unresolved";
  if (FALLBACK_CLAIMS.has(it.claim)) return "fallback";
  if (EXEMPT_CLAIMS.has(it.claim)) return "exempt";
  if (UNRESOLVED_CLAIMS.has(it.claim)) return "unresolved";
  return null;
}

const asStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function legacyToProvenance(kind: LegacyKind, it: ReviewItem): ProvenanceItem {
  const p = it.params ?? {};
  if (kind === "fallback") {
    const m = it.reason.match(
      /^(.*); default cross-domain lead (\S+) reviewed\.(?: Specialist (\S+) is same-domain \(first stage only\)\.)?$/s,
    );
    return {
      code: PROVENANCE_CODES.fallbackReviewer,
      params: {
        fallbackReason: asStr(p.fallbackReason) ?? m?.[1] ?? null,
        reviewerAgent: asStr(p.reviewerAgent) ?? m?.[2] ?? null,
        specialist: asStr(p.specialist) ?? m?.[3] ?? null,
        legacy: true,
      },
    };
  }
  if (kind === "exempt") {
    const m = it.reason.match(/^(.*): no review domain by explicit matrix exemption/s);
    return {
      code: PROVENANCE_CODES.orchestratorExempt,
      params: { agents: asStr(p.agents) ?? m?.[1] ?? null, legacy: true },
    };
  }
  const m = it.reason.match(/^Excluded from the cross-domain check: (.*)\.$/s);
  return {
    code: PROVENANCE_CODES.unresolvedAgent,
    params: { agents: asStr(p.agents) ?? m?.[1] ?? null, legacy: true },
  };
}

/**
 * Move known routing claims out of could_not_verify into provenance. Stored
 * rows are untouched; needs_judgement / verified are left exactly as stored.
 * Rows without any routing claim come back unchanged apart from `provenance`.
 * The never-empty rule is applied after reclassification.
 */
export function reclassifyLegacyProvenance(b: ReviewBuckets): ReviewBuckets {
  const moved: ProvenanceItem[] = [];
  const kept: ReviewItem[] = [];
  for (const it of b.could_not_verify) {
    const kind = legacyKind(it);
    if (kind) moved.push(legacyToProvenance(kind, it));
    else kept.push(it);
  }
  // Stored LLM items go through the same conservative filter as new reviews
  // (read time only; the stored row is never mutated). Idempotent for rows that
  // were already filtered at write time.
  const filtered = filterInternalItems({ ...b, could_not_verify: kept });
  const dropped = filtered.dropped.map((d) => ({ ...d, params: { ...d.params, legacy: true } }));
  if (moved.length === 0 && dropped.length === 0) return { ...b, provenance: b.provenance ?? [] };
  return {
    ...b,
    could_not_verify: ensureCouldNotVerify(filtered.buckets.could_not_verify, LEGACY_SCOPE_NOT_DECLARED_ITEM),
    verified: filtered.buckets.verified,
    needs_judgement: filtered.buckets.needs_judgement,
    provenance: [...(b.provenance ?? []), ...moved, ...dropped],
  };
}
