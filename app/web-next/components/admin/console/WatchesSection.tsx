"use client";

// /admin/notifications — watch management panel (design 2026-10-29-scheduled-jobs-design
// §13.6, P4; admin-only this round). GET /api/admin/watches lists every watch with rule
// counts; the enabled state is DERIVED server-side (no watch.enabled column — enable/disable
// maps to all of the watch's rules). Row actions via RowMenu: manage rules (WatchRulesDialog),
// enable/stop (PATCH {enabled}), delete (the §13.6 soft delete = disable-all-rules, warned in
// the ConfirmDialog copy). Create dialog: project named by ID (the admin has no project
// visibility — the ReconfirmCreateForm precedent) + active-user picker from /api/admin/users.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type AdminUser, type RowList } from "../../../lib/api.ts";
import { ColGroup, useToast } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { RowMenu, useConfirm } from "../../crud.tsx";
import type { WatchListRow } from "./types.ts";
import { WatchRulesDialog } from "./WatchRulesDialog.tsx";

// 감시 7열 — 프로젝트·사용자·규칙 요약이 한 행에 들어가도록 고정 비율 유지.
const WATCHES_COL_PCT = [24, 16, 14, 10, 14, 12, 10] as const;

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
    api.get<RowList<WatchListRow>>("/api/admin/watches")
      .then((res) => { setWatches(res.data.rows); setLoadError(null); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : tc("errors.loadFailed")));
  }
  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

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
    confirm(t("deleteConfirmTitle"), () => {
      api.delete(`/api/admin/watches/${encodeURIComponent(watch.id)}`)
        .then(() => reload())
        .catch((err) => toast(err instanceof Error ? err.message : ta("watchDeleteFailed"), "alert"));
    }, { body: t("deleteConfirmBody"), confirmLabel: t("deleteWatch") });
  }

  return (
    <section aria-label={t("heading")}>
      {confirmDialog}
      <h2 className="mt-6 mb-2">{t("heading")}</h2>
      <p className="mb-3 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("note")}</p>
      <div className="mb-2">
        <button type="button" className="btn-ghost" aria-label={t("createAria")} onClick={() => setCreateOpen(true)}>{t("createButton")}</button>
      </div>
      {loadError && <p role="alert" className="mb-2 text-[color:var(--red-fg)]">{loadError}</p>}
      {watches === null ? (
        <p>{tc("loading")}</p>
      ) : watches.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">{t("emptyWatches")}</p>
      ) : (
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
                <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => (
                <tr key={w.id}>
                  <td className="cell-truncate">
                    {w.project ? (
                      <Link className="text-[color:var(--accent)] underline" href={`/projects/${w.project.id}`}>{w.project.project_no ?? w.project.id}</Link>
                    ) : "—"}
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
                  <td className="col-date cell-truncate">{w.last_checked_at ? formatDateTime(w.last_checked_at, locale) : "—"}</td>
                  <td className="sizing-actions-cell">
                    <RowMenu
                      label={t("menuAria", { p1: w.project?.project_no ?? w.id })}
                      items={[
                        { key: "rules", label: t("rulesManage"), onSelect: () => setRulesWatch(w) },
                        w.enabled
                          ? { key: "disable", label: t("disable"), onSelect: () => { void toggleEnabled(w, false); } }
                          : { key: "enable", label: t("enable"), onSelect: () => { void toggleEnabled(w, true); } },
                        { key: "delete", label: t("deleteWatch"), danger: true, separatorBefore: true, onSelect: () => deleteWatch(w) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {createOpen && <WatchCreateDialog onClose={() => { setCreateOpen(false); reload(); }} />}
      {rulesWatch !== null && (
        <WatchRulesDialog
          watch={{ id: rulesWatch.id, project: rulesWatch.project, user_id: rulesWatch.user_id }}
          onClose={() => { setRulesWatch(null); reload(); }}
        />
      )}
    </section>
  );
}

/** Create dialog — one watch per (project, user); the server 409 watch_exists renders inline. */
function WatchCreateDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("admin.watches");
  const ta = useTranslations("admin.actions");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [projectId, setProjectId] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<AdminUser[]>("/api/admin/users")
      .then((res) => { if (!cancelled) setUsers(res.data.filter((u) => u.status === "active")); })
      .catch(() => { if (!cancelled) setUsers([]); });
    return () => { cancelled = true; };
  }, []);

  const canSubmit = projectId.trim() !== "" && userId.trim() !== "" && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/watches", { project_id: projectId.trim(), user_id: userId.trim() });
      toast(ta("watchCreated"));
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "watch_exists") setError(t("createExists"));
      else setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("createAria")} onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" style={{ maxWidth: "30rem", width: "100%" }}>
        <div className="modal-head"><h2>{t("createAria")}</h2></div>
        <form onSubmit={(e) => { void submit(e); }} aria-label={t("createAria")} className="stack-form mt-2">
          <div className="stack-form-row">
            <label htmlFor="watchProject">{t("createProjectLabel")}</label>
            <input
              id="watchProject"
              className="sizing-new-input font-mono"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              autoComplete="off"
              aria-describedby="watchProjectHint"
              required
            />
            <p id="watchProjectHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("createProjectHint")}</p>
          </div>
          <div className="stack-form-row">
            <label htmlFor="watchUser">{t("createUserLabel")}</label>
            <select id="watchUser" value={userId} onChange={(e) => setUserId(e.target.value)} aria-describedby="watchUserHint" required>
              <option value="" disabled>—</option>
              {(users ?? []).map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.user_id}{u.display_name ? ` (${u.display_name})` : ""}</option>
              ))}
            </select>
            <p id="watchUserHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("createUserHint")}</p>
          </div>
          {error !== null && <p role="alert" className="m-0 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>{tc("cancel")}</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>{busy ? tc("saving") : tc("register")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
