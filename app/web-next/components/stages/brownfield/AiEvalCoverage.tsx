"use client";

// Score and marker surfaces for the S6 longlist (ADR-0199, ADR-0200 §7.1): ONE chip per category showing the live
// score with judged coverage; ONE marker line per row (⚠ 일부 항목 미평가, AI 판정 n건 미검토, 갱신 권장); a short
// 잠정 tag on the rank cell (the row marker already says why). Text and icon, never color alone; nothing here changes ranking.
import { useTranslations } from "next-intl";
import { draftIsStale, summaryMarkers } from "./aiEvalActive.ts";
import type { EvalDraftView } from "./aiEvalTypes.ts";
import type { TargetRow } from "./types.ts";

type Summary = NonNullable<TargetRow["eval_summary"]>;

const scoreClass = (score: number | null | undefined) =>
  score == null ? "status-not-started" : score >= 70 ? "status-green" : score >= 40 ? "status-amber" : "status-red";

/** The two score chips: `재무 72 · 평가 40/100` and `기술 50 · 평가 30/100` (judged weight over total weight). */
export function ScoreChips({ summary }: { summary: Summary | undefined }) {
  const t = useTranslations("stages.s67.longlistSection");
  const tc = useTranslations("common");
  const ta = useTranslations("stages.s67.aiEval");
  const cats = [
    { key: "financial", label: tc("finance"), title: t("financialEvaluationWeightedScoreOut") },
    { key: "technical", label: t("technology"), title: t("technologyEvaluationWeightedScoreOut") },
  ] as const;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {cats.map((c) => {
        const cs = summary?.[c.key];
        const cov = cs?.totalCount ? { scored: cs.judgedCount ?? 0, total: cs.totalCount } : null;
        return (
          <span
            key={c.key}
            className={`status-chip ${scoreClass(summary?.[c.key].score)}`}
            title={cov ? `${c.title} · ${ta("coverageWeight", { scored: cov.scored, total: cov.total })}` : c.title}
          >
            {c.label} {summary?.[c.key].score ?? "—"}
          </span>
        );
      })}
    </span>
  );
}

/** One marker line under the score chips; null when there is nothing to flag. */
export function RowMarkers({ summary, draft }: { summary: Summary | undefined; draft: EvalDraftView | undefined }) {
  const ta = useTranslations("stages.s67.aiEval");
  const m = summaryMarkers(summary);
  const stale = draftIsStale(draft);
  if (!m.partial && m.unreviewed === 0 && !stale) return null;
  return (
    <span className="flex flex-wrap gap-1 mt-1">
      {m.partial && (
        <span className="status-chip status-amber" title={ta("coveragePartialHint")}>
          <span aria-hidden="true">⚠ </span>
          {ta("partialMarker")}
        </span>
      )}
      {m.unreviewed > 0 && (
        <span
          className="status-chip status-not-started"
          title={ta("unreviewedSplit", { fin: m.byCategory.financial, tech: m.byCategory.technical })}
        >
          <span aria-hidden="true">◔ </span>
          {ta("unreviewed", { n: m.unreviewed })}
        </span>
      )}
      {stale && (
        <span className="status-chip status-amber" title={ta("staleHint")}>
          <span aria-hidden="true">⟳ </span>
          {ta("stale")}
        </span>
      )}
    </span>
  );
}

/** Rank cell marker: a rank derived from partial scores or unreviewed AI / rule verdicts is provisional, not final. */
export function RankMarkers({ summary }: { summary: Summary | undefined }) {
  const ta = useTranslations("stages.s67.aiEval");
  const m = summaryMarkers(summary);
  if (summary?.combined == null || (!m.partial && m.unreviewed === 0)) return null;
  return (
    <span className="block text-[length:var(--fs-caption)] text-[color:var(--amber-fg)] font-normal">
      <span aria-hidden="true">⚠ </span>
      {ta("rankProvisional")}
    </span>
  );
}
