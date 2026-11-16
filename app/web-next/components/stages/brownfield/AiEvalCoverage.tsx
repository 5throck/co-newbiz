"use client";

// Coverage markers for the S6 longlist scores (ADR-0199, 2026-11-16 user report): a score computed from only a few
// judged items must never read as "everything evaluated". Text, never color alone; nothing here changes ranking.
import { useTranslations } from "next-intl";
import { weightCoverage } from "./aiEvalActive.ts";
import type { TargetRow } from "./types.ts";

type Summary = NonNullable<TargetRow["eval_summary"]>;

const scoreClass = (score: number | null | undefined) =>
  score == null ? "status-not-started" : score >= 70 ? "status-green" : score >= 40 ? "status-amber" : "status-red";

/** The two confirmed score chips (`재무 50 · 평가 30/100`) plus one text marker per partially judged category. */
export function ConfirmedScoreChips({ summary }: { summary: Summary | undefined }) {
  const t = useTranslations("stages.s67.longlistSection");
  const tc = useTranslations("common");
  const ta = useTranslations("stages.s67.aiEval");
  const cats = [
    { key: "financial", label: tc("finance"), title: t("financialEvaluationWeightedScoreOut") },
    { key: "technical", label: t("technology"), title: t("technologyEvaluationWeightedScoreOut") },
  ] as const;
  return (
    <>
      <span className="flex flex-wrap items-center gap-1">
        {cats.map((c) => {
          const cov = weightCoverage(summary?.[c.key]);
          return (
            <span key={c.key} className={`status-chip ${scoreClass(summary?.[c.key].score)}`} title={c.title}>
              {c.label} {summary?.[c.key].score ?? "—"}
              {cov && ` · ${ta("coverageWeight", { scored: cov.scored, total: cov.total })}`}
            </span>
          );
        })}
      </span>
      {cats.map((c) => {
        const cov = weightCoverage(summary?.[c.key]);
        return cov?.partial ? (
          <span key={c.key} className="flex flex-wrap gap-1 mt-1">
            <span className="status-chip status-amber" title={ta("coveragePartialHint")}>
              <span aria-hidden="true">⚠ </span>
              {ta("coveragePartial", { category: c.label })}
            </span>
          </span>
        ) : null;
      })}
    </>
  );
}

/** Marker under the rank: a rank derived from scores that do not cover every item is provisional, not final. */
export function RankPartialMarker({ summary }: { summary: Summary | undefined }) {
  const ta = useTranslations("stages.s67.aiEval");
  if (summary?.combined == null || summary.complete !== false) return null;
  return (
    <span className="block text-[length:var(--fs-caption)] text-[color:var(--amber-fg)] font-normal">
      <span aria-hidden="true">⚠ </span>
      {ta("coverageRankPartial")}
    </span>
  );
}
