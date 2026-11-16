"use client";

// Expandable per-candidate version comparison (ADR-0199 §10): criteria rows x last 5 versions, with the per-candidate
// confirm-from-version action. Confirmation is human-only (the route denies non-human callers) and per candidate:
// there is deliberately no longlist-wide confirm-all.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api.ts";
import { AiEvalConfirmBody, AiEvalModal } from "./AiEvalDialogs.tsx";
import { rubricChanged, rubricLine } from "./aiEvalRules.ts";
import {
  KNOWN_CALL_ERRORS,
  buildComparison,
  buildConfirmPlan,
  type CompareCell,
  type DraftCategory,
  type VersionRow,
} from "./aiEvalTypes.ts";

const CATEGORIES: DraftCategory[] = ["financial", "technical"];

function Cell({ cell }: { cell: CompareCell }) {
  const t = useTranslations("stages.s67.aiEval");
  if (cell.kind === "absent") return <span className="text-[color:var(--muted-fg)]">—</span>;
  const text =
    cell.kind === "unverified"
      ? t("unverified")
      : cell.kind === "human"
        ? `${t("humanJudged")} · ${t(`verdict.${cell.status}`)}`
        : t(`verdict.${cell.status}`);
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
              {v.confirmed_count > 0 && (
                <span className="block text-[length:var(--fs-caption)] font-normal">
                  {t("confirmedBasis", { k: v.confirmed_count })}
                </span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">{t("provisionalScore")}</th>
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
                  <Cell cell={c} />
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

export function AiEvalVersionPanel({
  oppId,
  targetId,
  companyName,
  canAct,
  onConfirmed,
}: {
  oppId: string;
  targetId: string;
  companyName: string;
  canAct: boolean;
  onConfirmed: () => void;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const [byCat, setByCat] = useState<Record<DraftCategory, VersionRow[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<VersionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function confirm(v: VersionRow) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ confirmed: number; skipped: unknown[] }>(
        `/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-draft-versions/${encodeURIComponent(v.id)}/confirm`,
        {},
      );
      setNotice(t("confirmResult", { confirmed: r.data.confirmed, skipped: r.data.skipped.length }));
      setConfirming(null);
      await load();
      onConfirmed();
    } catch (e) {
      setConfirming(null);
      setNotice(
        e instanceof ApiError && (KNOWN_CALL_ERRORS as readonly string[]).includes(e.code)
          ? t(`callErrors.${e.code}`)
          : e instanceof Error
            ? e.message
            : t("callErrors.unknown"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="text-[color:var(--red-fg)] m-0">
        {loadError}
      </p>
    );
  if (!byCat) return <p className="m-0 text-[color:var(--muted-fg)]">{t("loading")}</p>;
  const none = CATEGORIES.every((c) => byCat[c].length === 0);
  if (none) return <p className="m-0 text-[color:var(--muted-fg)]">{t("noVersions")}</p>;
  const plan = confirming?.payload ? buildConfirmPlan(confirming.payload) : null;
  return (
    <div className="flex flex-col gap-3">
      {CATEGORIES.map((c) => {
        const versions = byCat[c];
        const latest = versions[0];
        if (!latest) return null;
        const pending = latest.payload ? buildConfirmPlan(latest.payload).write.length : 0;
        return (
          <section key={c} aria-label={t(`category.${c}`)}>
            <VersionTable category={c} versions={versions} />
            {canAct && (
              <button
                type="button"
                className="btn-ghost btn-sm mt-1"
                disabled={busy || pending === 0}
                onClick={() => setConfirming(latest)}
              >
                {t("confirmVersion", { n: latest.version_no, k: pending })}
              </button>
            )}
          </section>
        );
      })}
      {notice && (
        <p role="status" className="m-0 text-[length:var(--fs-caption)]">
          {notice}
        </p>
      )}
      {confirming && plan && (
        <AiEvalModal
          title={t("confirmTitle", { company: companyName, n: confirming.version_no })}
          onClose={() => setConfirming(null)}
        >
          <AiEvalConfirmBody
            versionNo={confirming.version_no}
            plan={plan}
            statusLabel={(s) => t(`verdict.${s}`)}
            busy={busy}
            onSubmit={() => void confirm(confirming)}
            onCancel={() => setConfirming(null)}
          />
        </AiEvalModal>
      )}
    </div>
  );
}
