"use client";

// ReviewProvenance — "검토 경위": how a review was routed and which AI items were
// kept off the decision surface (design 2026-11-07-review-internal-items §3.3/§5).
// Deliberately NOT a bucket: never counted in the three bucket counts and never
// part of any gate-blocking logic. A native <details> keeps it collapsed and
// keyboard operable; the summary carries the count in text.
import { useLocale, useTranslations } from "next-intl";
import { localizeNotPerformedReason } from "../lib/review/review-display.ts";

export interface ProvenanceItemView {
  code: string;
  params: Record<string, string | number | boolean | null>;
}

const BUCKET_TITLE_KEY: Record<string, string> = {
  verified: "review.buckets.verified",
  could_not_verify: "review.buckets.couldNotVerify",
  needs_judgement: "review.buckets.needsJudgement",
};

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

function ProvenanceEntry({ item }: { item: ProvenanceItemView }) {
  const tr = useTranslations();
  const locale = useLocale();
  const p = item.params ?? {};
  const legacy = p.legacy === true;
  const unknownName = tr("review.provenance.unknownName");
  let body: string;
  let original: string | null = null;
  switch (item.code) {
    case "fallback_reviewer": {
      // The stored reason is an English template; only Korean has a translator.
      const raw = str(p.fallbackReason);
      const reason = raw ? (locale === "ko" ? localizeNotPerformedReason(raw) : raw) : unknownName;
      const specialist = str(p.specialist);
      body = specialist
        ? tr("review.provenance.fallbackReviewerWithSpecialist", {
            reviewer: str(p.reviewerAgent) || unknownName,
            reason,
            specialist,
          })
        : tr("review.provenance.fallbackReviewer", { reviewer: str(p.reviewerAgent) || unknownName, reason });
      break;
    }
    case "orchestrator_exempt":
      body = tr("review.provenance.orchestratorExempt", { agents: str(p.agents) || unknownName });
      break;
    case "unresolved_agent":
      body = tr("review.provenance.unresolvedAgent", { agents: str(p.agents) || unknownName });
      break;
    case "filtered_internal_item": {
      body = tr("review.provenance.filteredInternalItem");
      const bucketKey = BUCKET_TITLE_KEY[str(p.bucket)];
      const where = bucketKey ? tr(bucketKey) : str(p.bucket);
      const claim = str(p.claim);
      const reason = str(p.reason);
      original = tr("review.provenance.originalText", {
        bucket: where,
        text: [claim, reason].filter(Boolean).join(" — "),
      });
      break;
    }
    default:
      body = tr("review.provenance.unknownCode", { code: item.code });
  }
  return (
    <li data-provenance-code={item.code}>
      <span>{body}</span>
      {legacy && <span className="block text-[color:var(--muted-fg)]">{tr("review.provenance.legacyNote")}</span>}
      {original && (
        <span className="block text-[color:var(--muted-fg)]" data-testid="review-provenance-original">
          {original}
        </span>
      )}
    </li>
  );
}

export function ReviewProvenance({ items }: { items: readonly ProvenanceItemView[] | undefined }) {
  const tr = useTranslations();
  if (!items || items.length === 0) return null;
  return (
    <details className="review-dev" data-testid="review-provenance">
      <summary>{tr("review.provenance.summary", { count: items.length })}</summary>
      <p className="review-dev-note">{tr("review.provenance.note")}</p>
      <ul aria-label={tr("review.provenance.listLabel")}>
        {items.map((it, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: provenance entries have no id and the list is static per review view
          <ProvenanceEntry key={`${it.code}-${i}`} item={it} />
        ))}
      </ul>
    </details>
  );
}
