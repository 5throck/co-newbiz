"use client";

// /admin/notifications — watch management panel (design 2026-10-29-scheduled-jobs-design
// §13.6, P4; admin-only this round). GET /api/admin/watches lists every watch with rule
// counts; the enabled state is DERIVED server-side (no watch.enabled column — enable/disable
// maps to all of the watch's rules). Row actions via RowMenu: manage rules (WatchRulesDialog),
// enable/stop (PATCH {enabled}), delete (the §13.6 soft delete = disable-all-rules, warned in
// the ConfirmDialog copy). The create dialog (project picker + active-user picker) lives in
// WatchCreateDialog.tsx (2026-11 coverage-gate file-length split).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api, type RowList } from "../../../lib/api.ts";
import { ColGroup, useToast } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { RowMenu, useConfirm } from "../../crud.tsx";
import type { WatchListRow } from "./types.ts";
import { WatchCreateDialog } from "./WatchCreateDialog.tsx";
import { WatchRulesDialog } from "./WatchRulesDialog.tsx";

// 감시 7열 — 프로젝트 열을 28%로 넓혀 project_no(관리자가 볼 수 있는 프로젝트 표기)가 잘리지 않게
// 하고, 사용자·규칙 열에서 2%씩 가져온다(2026-11 사용자 결함 보고 2: 프로젝트 표기 절단 수정).
const WATCHES_COL_PCT = [28, 14, 12, 10, 14, 12, 10] as const;

export function WatchesSection() {
  const t = useTranslations("admin.watches");
  const ta = useTranslations("admin.actions");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [watches, setWatches] = useState<WatchListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rulesWatch, setRulesWatch] = useState<WatchListRow | null>(null);

  function reload() {
    // {rows} list envelope (lib/api.ts RowList) — the compiler-enforced path to res.data.rows.
    api
      .get<RowList<WatchListRow>>("/api/admin/watches")
      .then((res) => {
        setWatches(res.data.rows);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : tc("errors.loadFailed")));
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial load; reload is re-invoked explicitly by the handlers below.
  useEffect(() => {
    reload();
  }, []);

  async function toggleEnabled(watch: WatchListRow, next: boolean) {
    try {
      await api.patch(`/api/admin/watches/${encodeURIComponent(watch.id)}`, { enabled: next });
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : ta("watchToggleFailed"), "alert");
    }
  }

  function deleteWatch(watch: WatchListRow) {
    // §13.6 soft delete: DELETE disables ALL the watch's rules and the row stays — the
    // ConfirmDialog copy states exactly that ("모든 규칙이 비활성화됩니다").
    confirm(
      t("deleteConfirmTitle"),
      () => {
        api
          .delete(`/api/admin/watches/${encodeURIComponent(watch.id)}`)
          .then(() => reload())
          .catch((err) => toast(err instanceof Error ? err.message : ta("watchDeleteFailed"), "alert"));
      },
      { body: t("deleteConfirmBody"), confirmLabel: t("deleteWatch") },
    );
  }

  return (
    <section aria-label={t("heading")}>
      {confirmDialog}
      <h2 className="mt-6 mb-2">{t("heading")}</h2>
      <p className="mb-3 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("note")}</p>
      <div className="mb-2">
        <button type="button" className="btn-ghost" aria-label={t("createAria")} onClick={() => setCreateOpen(true)}>
          {t("createButton")}
        </button>
      </div>
      {loadError && (
        <p role="alert" className="mb-2 text-[color:var(--red-fg)]">
          {loadError}
        </p>
      )}
      {watches === null ? (
        <p>{tc("loading")}</p>
      ) : watches.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">{t("emptyWatches")}</p>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: scrollable-region-focusable (axe) needs the focusable scroll region; a <section> landmark per table is not wanted here.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: same axe rule — keyboard users must be able to scroll the table region.
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table list-table table-fixed-pct tmin-48">
            <caption className="sr-only">{t("heading")}</caption>
            <ColGroup widths={WATCHES_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colProject")}</th>
                <th scope="col">{t("colUser")}</th>
                <th scope="col">{t("colRules")}</th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colCreated")}</th>
                <th scope="col">{t("colLastChecked")}</th>
                <th scope="col">
                  <span className="sr-only">{tc("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => (
                <tr key={w.id}>
                  {/* 프로젝트 셀은 절단하지 않는다 — project_no가 전부 읽히고, project_no가 없는
                      드문 UUID 폴백은 셀 안에서 줄바꿈된다(table-fixed-pct td의 overflow-wrap: anywhere). */}
                  <td>
                    {w.project ? (
                      <Link className="text-[color:var(--accent)] underline" href={`/projects/${w.project.id}`}>
                        {w.project.project_no ?? w.project.id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="cell-truncate">{w.user_id}</td>
                  <td>{t("rulesCount", { p1: w.enabled_rule_count, p2: w.rule_count })}</td>
                  <td>
                    {w.enabled ? (
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--green-bg)] text-[color:var(--green-fg)]">
                        <span aria-hidden="true">●</span> {t("stateEnabled")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]">
                        <span aria-hidden="true">○</span> {t("stateDisabled")}
                      </span>
                    )}
                  </td>
                  <td className="col-date cell-truncate">{formatDateTime(w.created_at, locale)}</td>
                  <td className="col-date cell-truncate">
                    {w.last_checked_at ? formatDateTime(w.last_checked_at, locale) : "—"}
                  </td>
                  <td className="sizing-actions-cell">
                    <RowMenu
                      label={t("menuAria", { p1: w.project?.project_no ?? w.id })}
                      items={[
                        { key: "rules", label: t("rulesManage"), onSelect: () => setRulesWatch(w) },
                        w.enabled
                          ? {
                              key: "disable",
                              label: t("disable"),
                              onSelect: () => {
                                void toggleEnabled(w, false);
                              },
                            }
                          : {
                              key: "enable",
                              label: t("enable"),
                              onSelect: () => {
                                void toggleEnabled(w, true);
                              },
                            },
                        {
                          key: "delete",
                          label: t("deleteWatch"),
                          danger: true,
                          separatorBefore: true,
                          onSelect: () => deleteWatch(w),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {createOpen && (
        <WatchCreateDialog
          onClose={() => {
            setCreateOpen(false);
            reload();
          }}
        />
      )}
      {rulesWatch !== null && (
        <WatchRulesDialog
          watch={{ id: rulesWatch.id, project: rulesWatch.project, user_id: rulesWatch.user_id }}
          onClose={() => {
            setRulesWatch(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
