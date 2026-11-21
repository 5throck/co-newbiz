"use client";

// Short List promotion with the unreviewed-verdict warning (ADR-0200 §5.2): promotion stays a person's click and is
// never blocked. With no unreviewed AI / rule verdicts the button promotes directly (as before); otherwise a
// confirmation dialog shows the counts, offers 항목 검토, and promotes on the person's click.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { summaryMarkers } from "./aiEvalActive.ts";
import { AiEvalModal } from "./AiEvalDialogs.tsx";
import type { TargetRow } from "./types.ts";

export interface UnreviewedCounts {
  total: number;
  financial: number;
  technical: number;
}

/** Counts from an `eval_summary` (S6 longlist). */
export const unreviewedOf = (summary: TargetRow["eval_summary"]): UnreviewedCounts => {
  const m = summaryMarkers(summary);
  return { total: m.unreviewed, financial: m.byCategory.financial, technical: m.byCategory.technical };
};

/** Candidate detail screen, evaluation tab (항목 검토 target). */
export const reviewItemsHref = (targetId: string) => `/brownfield/targets/${encodeURIComponent(targetId)}?tab=eval`;

export function PromoteButton({
  companyName,
  targetId,
  unreviewed,
  gaps = [],
  busy,
  onPromote,
  label,
  title,
  className = "btn-ghost btn-sm",
}: {
  companyName: string;
  targetId: string;
  unreviewed: UnreviewedCounts;
  /** design 2026-11-21-s67-completion-visibility — open S6 gaps (attributes/source). Promotion is never
   * blocked (ADR-0200 Q3), but the confirm modal warns that the row does not count toward S6 coverage. */
  gaps?: Array<"attributes" | "source">;
  busy: boolean;
  onPromote: () => void;
  /** Button text / tooltip / class: the candidate detail screen has its own wording and primary style. */
  label?: string;
  title?: string;
  className?: string;
}) {
  const t = useTranslations("stages.s67.longlistSection");
  const ta = useTranslations("stages.s67.aiEval");
  const [open, setOpen] = useState(false);
  const m = unreviewed;
  const hasGaps = gaps.length > 0;
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        title={title ?? t("financialAndTechnologyEvaluationComplete")}
        aria-label={t("promoteP1ToTheShortlist", { p1: companyName })}
        onClick={() => (m.total > 0 || hasGaps ? setOpen(true) : onPromote())}
      >
        {label ?? t("promote")}
      </button>
      {open && (
        <AiEvalModal title={ta("promoteTitle", { company: companyName })} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3 mt-2">
            <p role="alert" className="m-0 text-[length:var(--fs-body)] text-[color:var(--amber-fg)]">
              <span aria-hidden="true">⚠ </span>
              {ta("promoteUnreviewed", { n: m.total })}
            </p>
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {ta("unreviewedSplit", { fin: m.financial, tech: m.technical })}
            </p>
            {hasGaps && (
              <p role="alert" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]">
                <span aria-hidden="true">⚠ </span>
                {ta("promoteQualificationWarning")}
                {" — "}
                <a href={`/brownfield/targets/${encodeURIComponent(targetId)}?edit=1`}>{ta("cureLink")}</a>
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <a className="btn-ghost btn-sm" href={reviewItemsHref(targetId)}>
                {ta("reviewItems")}
              </a>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
                {ta("promoteCancel")}
              </button>
              <button
                type="button"
                className="btn-premium btn-sm"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onPromote();
                }}
              >
                {ta("promoteAnyway")}
              </button>
            </div>
          </div>
        </AiEvalModal>
      )}
    </>
  );
}
