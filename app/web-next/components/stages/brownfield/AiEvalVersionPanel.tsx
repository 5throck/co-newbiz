"use client";

// Expandable per-candidate version history (ADR-0199 §10, read-only since ADR-0200): criteria rows x last 5 versions.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.ts";
import { rubricChanged, rubricLine } from "./aiEvalRules.ts";
import { buildComparison, type CompareCell, type DraftCategory, type VersionRow } from "./aiEvalTypes.ts";

const CATEGORIES: DraftCategory[] = ["financial", "technical"];

function Cell({ cell, category }: { cell: CompareCell; category: DraftCategory }) {
  const t = useTranslations("stages.s67.aiEval");
  if (cell.kind === "absent") return <span className="text-[color:var(--muted-fg)]">—</span>;
  const text =
    cell.kind === "unverified"
      ? t("unverified")
      : cell.kind === "human"
        ? `${t("originHuman")} · ${t(`verdict.${cell.status}`)}`
        : // a proposal in a version is rule-derived for financial items and AI-derived for technical ones
          `${t(category === "financial" ? "originRule" : "originAi")} · ${t(`verdict.${cell.status}`)}`;
  return (
    <span>
      {text}
      {cell.kind === "unverified" && cell.reasonDetail && (
        <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t(`reasonDetail.${cell.reasonDetail}`)}
        </span>
      )}
      {cell.changed && (
        <span className="ai-changed-mark" title={t("changedHint")}>
          {" "}
          <span aria-hidden="true">△</span> {t("changed")}
        </span>
      )}
    </span>
  );
}

/** Pure table: `versions` newest first, each carrying its payload. Exported for render tests. */
export function VersionTable({ category, versions }: { category: DraftCategory; versions: VersionRow[] }) {
  const t = useTranslations("stages.s67.aiEval");
  const { columns, rows, scores } = buildComparison(versions);
  if (columns.length === 0) return null;
  return (
    <table className="data-table mt-1" aria-label={t("versionTableLabel", { category: t(`category.${category}`) })}>
      <thead>
        <tr>
          <th scope="col">{t(`category.${category}`)}</th>
          {columns.map((v) => (
            <th key={v.id} scope="col">
              v{v.version_no}
              <span className="block text-[length:var(--fs-caption)] font-normal">
                {t("appliedReviewed", { k: v.applied_count, r: v.reviewed_count })}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">{t("versionScore")}</th>
          {scores.map((s) => (
            <td key={s.version_no} className="tabular-nums">
              {s.score ?? "—"}
              {s.delta !== null && s.delta !== 0 && (
                <span className="text-[color:var(--muted-fg)]">
                  {" "}
                  ({s.delta > 0 ? "+" : ""}
                  {s.delta})
                </span>
              )}
              {(() => {
                const v = columns.find((c) => c.version_no === s.version_no);
                const total = v ? v.proposed_count + v.unverified_count : 0;
                return v && total > 0 ? (
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {t("versionCoverage", { judged: v.proposed_count, total, k: v.unverified_count })}
                  </span>
                ) : null;
              })()}
            </td>
          ))}
        </tr>
        {rows.map((r) => (
          <tr key={r.criterion_id}>
            <th scope="row">{r.label}</th>
            {r.cells.map((c, i) => {
              const snap = (v: VersionRow | undefined) =>
                v?.payload?.criteria_snapshot.find((s) => s.criterion_id === r.criterion_id)?.rubric ?? null;
              const line = rubricLine(snap(columns[i]));
              const older = columns[i + 1];
              const ruleChanged = !!line && !!older?.payload && rubricChanged(snap(columns[i]), snap(older));
              return (
                <td key={columns[i].id}>
                  <Cell cell={c} category={category} />
                  {line && (
                    <span
                      className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"
                      title={t("thresholdsUsed")}
                    >
                      {line}
                      {ruleChanged && (
                        <span className="ai-changed-mark">
                          {" "}
                          <span aria-hidden="true">△</span> {t("rubricChanged")}
                        </span>
                      )}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Read-only audit history of one candidate's AI evaluation versions (ADR-0200 §7.1): per-version score, coverage,
 * per-item verdict changes with their origin, and the thresholds used. There is no confirm control: verdicts are
 * applied directly and a person reviews them on the candidate detail screen (항목 검토). */
export function AiEvalVersionPanel({ oppId, targetId }: { oppId: string; targetId: string }) {
  const t = useTranslations("stages.s67.aiEval");
  const [byCat, setByCat] = useState<Record<DraftCategory, VersionRow[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const base = `/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-draft-versions`;
      const [fin, tech] = await Promise.all(
        CATEGORIES.map((c) => api.get<{ versions: VersionRow[] }>(`${base}?category=${c}&limit=5&include=payload`)),
      );
      setByCat({ financial: fin.data.versions, technical: tech.data.versions });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("callErrors.unknown"));
    }
  }, [oppId, targetId, t]);
  useEffect(() => {
    void load();
  }, [load]);

  if (loadError)
    return (
      <p role="alert" className="text-[color:var(--red-fg)] m-0">
        {loadError}
      </p>
    );
  if (!byCat) return <p className="m-0 text-[color:var(--muted-fg)]">{t("loading")}</p>;
  if (CATEGORIES.every((c) => byCat[c].length === 0))
    return <p className="m-0 text-[color:var(--muted-fg)]">{t("noVersions")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {CATEGORIES.map((c) =>
        byCat[c].length === 0 ? null : (
          <section key={c} aria-label={t(`category.${c}`)}>
            <VersionTable category={c} versions={byCat[c]} />
          </section>
        ),
      )}
    </div>
  );
}
