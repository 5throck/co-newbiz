"use client";

// /admin/connected-apps — the connected OAuth client fleet panel (design
// 2026-11-27-admin-oauth-client-stop-start, P2 Report). Self-contained data
// fetching like NotificationSection.tsx (the P4 precedent for sections that
// own their state; the shared useAdminData hook does not grow another
// domain). GET /api/admin/oauth-clients lists every registered client —
// stopped ones included — with server-derived stats; PUT …/[clientId]
// {action:"stop"|"start"} is the fleet kill switch and its re-open.
//
// 중단 semantics (the design's ruling): stamping stopped_at revokes ALL
// users' live oauth tokens in the same transaction, so a later 시작 clears
// the marker but does NOT resurrect connections — both confirm dialogs carry
// that consequence. Any 409 (concurrent-admin race) reloads the list and
// toasts the catalog error — the self-healing acceptance item. Metadata and
// counts only: no token values, no redirect_uri contents (ADR-0091;
// FR-SEC-02).
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import { Button, ColGroup, FilterChip, PageState, useToast } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useConfirm } from "../../crud.tsx";
import type { AdminConnectedAppRow } from "./types.ts";

// 연결 앱 7열 — 이름·client_id가 긴 값이라 넉넉히(17·16%) 잡고, client_id는
// 모노스페이스 잘림+title로 표시한다. 넘치는 분은 표 가로 스크롤(.table-scroll)이
// 흡수한다(NotificationSection과 같은 표준).
const CONNECTED_APPS_COL_PCT = [17, 16, 12, 9, 12, 16, 18] as const;

type StatusFilter = "all" | "operating" | "stopped";

export function ConnectedAppsSection() {
  const t = useTranslations("admin.connectedApps");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [apps, setApps] = useState<AdminConnectedAppRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  function reload() {
    api
      .get<{ clients: AdminConnectedAppRow[] }>("/api/admin/oauth-clients")
      .then((res) => {
        setApps(res.data.clients);
        setLoadError(null);
      })
      .catch(() => {
        setApps([]);
        setLoadError(t("errLoad"));
      });
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial load; reload is re-invoked explicitly by the handlers below.
  useEffect(() => {
    reload();
  }, []);

  async function act(app: AdminConnectedAppRow, action: "stop" | "start") {
    try {
      const res = await api.put<{ ok: true; status: string; revoked?: number }>(
        `/api/admin/oauth-clients/${encodeURIComponent(app.client_id)}`,
        { action },
      );
      if (action === "stop") toast(t("stoppedToast", { p1: app.name, p2: res.data.revoked ?? 0 }));
      else toast(t("startedToast", { p1: app.name }));
      reload();
    } catch (err) {
      // Concurrent-admin race: the truthful 409 answers with the current
      // state — the list reloads so no stale row survives (self-healing).
      if (err instanceof ApiError && err.code === "oauth_client_already_stopped") {
        toast(t("errAlreadyStopped"), "alert");
        reload();
      } else if (err instanceof ApiError && err.code === "oauth_client_already_running") {
        toast(t("errAlreadyRunning"), "alert");
        reload();
      } else if (err instanceof ApiError && err.code === "not_found") {
        toast(t("errNotFound"), "alert");
      } else {
        toast(err instanceof Error ? err.message : t("errLoad"), "alert");
      }
    }
  }

  // 중단 — the destructive direction: the danger confirm label is the
  // ConfirmDialog default tone; the body names both consequences.
  function stopApp(app: AdminConnectedAppRow) {
    confirm(
      t("stopConfirmTitle", { p1: app.name }),
      () => {
        void act(app, "stop");
      },
      { body: t("stopConfirmBody"), confirmLabel: t("stopButton") },
    );
  }

  // 시작 — restoring is the safe-side, ordinary confirmation (neutral tone).
  function startApp(app: AdminConnectedAppRow) {
    confirm(
      t("startConfirmTitle", { p1: app.name }),
      () => {
        void act(app, "start");
      },
      { body: t("startConfirmBody"), confirmLabel: t("startButton"), tone: "neutral" },
    );
  }

  // Client-side search (name·client_id substring) + status filter — the server
  // already returns the whole fleet; no query round-trip to debounce.
  const q = qInput.trim().toLowerCase();
  const visible = (apps ?? []).filter((a) => {
    if (statusFilter === "operating" && a.stopped_at !== null) return false;
    if (statusFilter === "stopped" && a.stopped_at === null) return false;
    if (q !== "" && !`${a.name} ${a.client_id}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const countBy = (stopped: boolean) => (apps ?? []).filter((a) => (a.stopped_at !== null) === stopped).length;

  return (
    <>
      {confirmDialog}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label={t("searchAria")}
          placeholder={t("searchAria")}
          className="sizing-new-input sizing-new-input-sm"
          style={{ width: "14rem" }}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would drag in UA form styling that alters the filter-chip visual contract; the group role + aria-label is the deliberate a11y shape (settings page precedent) */}
        <div role="group" aria-label={t("colStatus")} className="flex items-center gap-1">
          <span className="text-[length:var(--fs-caption)] whitespace-nowrap">{t("colStatus")}</span>
          <FilterChip selected={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
            {t("filterAll", { p1: apps?.length ?? 0 })}
          </FilterChip>
          <FilterChip selected={statusFilter === "operating"} onClick={() => setStatusFilter("operating")}>
            {t("filterOperating", { p1: countBy(false) })}
          </FilterChip>
          <FilterChip selected={statusFilter === "stopped"} onClick={() => setStatusFilter("stopped")}>
            {t("filterStopped", { p1: countBy(true) })}
          </FilterChip>
        </div>
      </div>
      {loadError && (
        <p role="alert" className="mb-2 text-[color:var(--red-fg)]">
          {loadError}
        </p>
      )}
      {apps === null ? (
        <p>{tc("loading")}</p>
      ) : apps.length === 0 ? (
        // True-empty fleet (no clients registered at all) — PageState empty per the design layout.
        <PageState state="empty" emptyText={t("emptyClients")} />
      ) : visible.length === 0 ? (
        // The fleet has rows but the search/filter matches none — the fleet
        // empty text would lie here, so the generic catalog empty line shows.
        <p className="text-[color:var(--muted-fg)] italic">{tc("emptyState")}</p>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: scrollable-region-focusable (axe) needs the focusable scroll region; a <section> landmark per table is not wanted here.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: same axe rule — keyboard users must be able to scroll the table region.
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table list-table table-fixed-pct tmin-56" aria-label={t("tableCaption")}>
            <caption className="sr-only">{t("tableCaption")}</caption>
            <ColGroup widths={CONNECTED_APPS_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colApp")}</th>
                <th scope="col">{t("colClientId")}</th>
                <th scope="col">{t("colVerified")}</th>
                <th scope="col">{t("colUsers")}</th>
                <th scope="col">{t("colStatus")}</th>
                <th scope="col">{t("colStoppedAt")}</th>
                <th scope="col">
                  <span className="sr-only">{tc("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.client_id}>
                  <td className="cell-truncate" title={a.name}>
                    {a.name}
                  </td>
                  <td className="cell-truncate" title={a.client_id}>
                    <code className="font-mono text-[length:var(--fs-caption)]">{a.client_id}</code>
                  </td>
                  <td>
                    <span className={`status-chip ${a.verified ? "status-green" : "status-amber"}`}>
                      <span aria-hidden="true">{a.verified ? "●" : "⚠"}</span>{" "}
                      {a.verified ? t("verifiedChip") : t("unverifiedChip")}
                    </span>
                  </td>
                  <td className="tabular-nums">{t("userCount", { p1: a.authorized_users })}</td>
                  <td>
                    {a.stopped_at === null ? (
                      // 운영 중 — pass family (§3.2): green chip, icon + label, never color-only.
                      <span className="status-chip status-green">
                        <span aria-hidden="true">●</span> {t("statusOperating")}
                      </span>
                    ) : (
                      // 중단 — kill family (§3.2): red chip; amber "hold" would understate a kill switch.
                      <span className="status-chip status-red">
                        <span aria-hidden="true">✕</span> {t("statusStopped")}
                      </span>
                    )}
                  </td>
                  <td className="col-date whitespace-nowrap">
                    {a.stopped_at !== null ? formatDateTime(a.stopped_at, locale) : "—"}
                  </td>
                  <td className="sizing-actions-cell">
                    {/* One action per row, state-dependent: the danger styling
                        is reserved for 중단 — a one-click fleet event. */}
                    {a.stopped_at === null ? (
                      <Button
                        variant="danger"
                        size="sm"
                        aria-label={t("stopButtonAria", { p1: a.name })}
                        onClick={() => stopApp(a)}
                      >
                        {t("stopButton")}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("startButtonAria", { p1: a.name })}
                        onClick={() => startApp(a)}
                      >
                        {t("startButton")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
