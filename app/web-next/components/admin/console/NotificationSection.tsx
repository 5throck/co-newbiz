"use client";

// /admin/notifications — notification history panel (design 2026-10-29-scheduled-jobs-design
// §13.5, P4). Replaces the old capped list: server-side filters (period presets + from/to on
// sent_at, trigger_type, severity, channel, read, delivery_status, project_id, q) with debounced
// queries and page/page_size paging from the list meta (the old count/unread_count meta is gone).
// Rows carry per-channel delivery STATUS COUNTS rendered as compact chips; {} means in-app only
// (the notification row IS the in-app delivery, §13.2). Row click opens the detail drawer
// (NotificationDetailDrawer) and the panel header hosts the §13.7 test-send dialog.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { api, type RowList } from "../../../lib/api.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import type { AdminNotificationListRow, DeliverySummary, PageMeta } from "./types.ts";
import { Pager, useAdminLabel } from "./admin-ui.tsx";
import { NotificationDetailDrawer } from "./NotificationDetailDrawer.tsx";
import { TestSendDialog } from "./TestSendDialog.tsx";

// 알림 7열 — 제목과 전송 배지가 넓은 텍스트라 고정 비율 유지.
const NOTIFICATIONS_COL_PCT = [13, 9, 13, 13, 22, 20, 10] as const;
const PAGE_SIZE = 50; // server default; the cap is 100 (§13.5)
const Q_DEBOUNCE_MS = 300;

/** The notification CHECK's 11 trigger values (0185) — the filter's option set. */
const TRIGGER_TYPES = [
  "rag_upgrade", "rag_downgrade", "kill_criteria", "regulation_change", "threshold_breach",
  "staleness", "batch_failure", "pipeline_paused", "establishment_step_reopened",
  "establishment_step_assigned", "test",
] as const;
const SEVERITIES = ["opportunity", "warning", "urgent", "info", "ops"] as const;
const CHANNELS = ["in_app", "email", "webhook"] as const; // bound-inclusive server matching
const READ_STATES = ["read", "unread"] as const;
const DELIVERY_STATUSES = ["pending", "retry", "sent", "failed", "skipped", "deferred"] as const;
const PERIODS = ["24h", "7d", "30d", "90d", "all", "custom"] as const;
type Period = (typeof PERIODS)[number];

interface Filters {
  period: Period;
  from: string; // date input value (custom period only)
  to: string;
  trigger_type: string;
  severity: string;
  channel: string;
  read: string;
  delivery_status: string;
  project_id: string;
}

const EMPTY_FILTERS: Filters = { period: "30d", from: "", to: "", trigger_type: "", severity: "", channel: "", read: "", delivery_status: "", project_id: "" };

/** Period preset → `from` bound (ISO); `all`/`custom` return null (custom uses the date inputs). */
function periodFrom(period: Period, from: string, to: string): { from: string | null; to: string | null } {
  if (period === "all") return { from: null, to: null };
  if (period === "custom") return { from: from || null, to: to || null };
  const hours = period === "24h" ? 24 : period === "7d" ? 24 * 7 : period === "30d" ? 24 * 30 : 24 * 90;
  return { from: new Date(Date.now() - hours * 3_600_000).toISOString(), to: null };
}

/** Delivery-status chip tone — status is never encoded by color alone (the label text carries it). */
function deliveryChipCls(status: string): string {
  if (status === "sent") return "status-chip status-green";
  if (status === "failed") return "status-chip status-red";
  if (status === "pending" || status === "retry") return "status-chip status-amber";
  return "status-chip status-gray";
}

function DeliveryBadges({ delivery }: { delivery: DeliverySummary }) {
  const t = useTranslations("admin.ops");
  const label = useAdminLabel();
  const chips = useMemo(
    () =>
      Object.entries(delivery).flatMap(([channel, statuses]) =>
        Object.entries(statuses).map(([status, count]) => ({ channel, status, count })),
      ),
    [delivery],
  );
  if (chips.length === 0) {
    return <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("deliveryInAppOnly")}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={`${c.channel}:${c.status}`} className={deliveryChipCls(c.status)}>
          {label("channel", c.channel)} · {label("deliveryStatus", c.status)} ×{c.count}
        </span>
      ))}
    </span>
  );
}

/** Severity chip — text + icon glyph, never color alone (FR-SYS-05). */
export function SeverityChip({ severity }: { severity: string }) {
  const label = useAdminLabel();
  const glyph = severity === "opportunity" ? "↗" : severity === "warning" ? "▲" : severity === "urgent" ? "!" : severity === "ops" ? "⚙" : "i";
  const cls =
    severity === "opportunity" ? "bg-[color:var(--green-bg)] text-[color:var(--green-fg)]"
    : severity === "warning" ? "bg-[color:var(--amber-bg)] text-[color:var(--amber-fg)]"
    : severity === "urgent" ? "bg-[color:var(--red-bg)] text-[color:var(--red-fg)]"
    : "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]";
  return (
    <span className={`inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] ${cls}`}>
      <span aria-hidden="true">{glyph}</span> {label("severity", severity)}
    </span>
  );
}

export function NotificationSection() {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAdminLabel();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [customProject, setCustomProject] = useState(false);
  const [rows, setRows] = useState<AdminNotificationListRow[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  // Projects seen on loaded pages — the only project identities the admin console may name
  // (FR-SEC-02: no admin bypass on /api/projects, so there is no full project picker here).
  const [observed, setObserved] = useState<Array<{ id: string; project_no: string | null }>>([]);

  // q debounce — the search box updates input state immediately, filters after the quiet period.
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput), Q_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput]);

  // Debounced server query — rebuilt and re-run on any filter/page change; stale responses drop.
  useEffect(() => {
    const bounds = periodFrom(filters.period, filters.from, filters.to);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    if (bounds.from) params.set("from", bounds.from);
    if (bounds.to) params.set("to", bounds.to);
    for (const key of ["trigger_type", "severity", "channel", "read", "delivery_status", "project_id"] as const) {
      if (filters[key]) params.set(key, filters[key]);
    }
    if (q.trim() !== "") params.set("q", q.trim());
    let cancelled = false;
    const timer = setTimeout(() => {
      // {rows} list envelope (lib/api.ts RowList) — paging meta arrives on res.meta.
      api.get<RowList<AdminNotificationListRow>>(`/api/admin/notifications?${params.toString()}`)
        .then((res) => {
          if (cancelled) return;
          setRows(res.data.rows);
          setMeta({ page: Number(res.meta.page ?? 1), page_size: Number(res.meta.page_size ?? PAGE_SIZE), total: Number(res.meta.total ?? 0), total_pages: Number(res.meta.total_pages ?? 1) });
          setLoadError(null);
          const seen = new Set(observed.map((p) => p.id));
          const fresh = res.data.rows.map((r) => r.project).filter((p): p is { id: string; project_no: string | null } => p !== null && !seen.has(p.id));
          if (fresh.length > 0) setObserved((prev) => [...prev, ...fresh.filter((f) => !prev.some((p) => p.id === f.id))]);
        })
        .catch((err) => {
          if (!cancelled) { setRows([]); setLoadError(err instanceof Error ? err.message : tc("errors.loadFailed")); }
        });
    }, Q_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, q, page]);

  function patchFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1); // any filter change resets paging
  }

  function pickProject(value: string) {
    if (value === "__custom__") { setCustomProject(true); patchFilters({ project_id: "" }); return; }
    setCustomProject(false);
    patchFilters({ project_id: value });
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
          {t("filterPeriod")}
          <select aria-label={t("filterPeriod")} className="sizing-new-input sizing-new-input-sm" value={filters.period} onChange={(e) => patchFilters({ period: e.target.value as Period })}>
            {PERIODS.map((p) => <option key={p} value={p}>{t(`period_${p}`)}</option>)}
          </select>
        </label>
        {filters.period === "custom" && (
          <>
            <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
              {t("filterFrom")}
              <input type="date" aria-label={t("filterFrom")} className="sizing-new-input sizing-new-input-sm" value={filters.from} onChange={(e) => patchFilters({ from: e.target.value })} />
            </label>
            <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
              {t("filterTo")}
              <input type="date" aria-label={t("filterTo")} className="sizing-new-input sizing-new-input-sm" value={filters.to} onChange={(e) => patchFilters({ to: e.target.value })} />
            </label>
          </>
        )}
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
          {t("filterTrigger")}
          <select aria-label={t("filterTrigger")} className="sizing-new-input sizing-new-input-sm" value={filters.trigger_type} onChange={(e) => patchFilters({ trigger_type: e.target.value })}>
            <option value="">{t("filterAll")}</option>
            {TRIGGER_TYPES.map((v) => <option key={v} value={v}>{label("trigger", v)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
          {t("filterSeverity")}
          <select aria-label={t("filterSeverity")} className="sizing-new-input sizing-new-input-sm" value={filters.severity} onChange={(e) => patchFilters({ severity: e.target.value })}>
            <option value="">{t("filterAll")}</option>
            {SEVERITIES.map((v) => <option key={v} value={v}>{label("severity", v)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
          {t("filterChannel")}
          <select aria-label={t("filterChannel")} className="sizing-new-input sizing-new-input-sm" value={filters.channel} onChange={(e) => patchFilters({ channel: e.target.value })}>
            <option value="">{t("filterAll")}</option>
            {CHANNELS.map((v) => <option key={v} value={v}>{label("channel", v)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
          {t("filterRead")}
          <select aria-label={t("filterRead")} className="sizing-new-input sizing-new-input-sm" value={filters.read} onChange={(e) => patchFilters({ read: e.target.value })}>
            <option value="">{t("filterAll")}</option>
            {READ_STATES.map((v) => <option key={v} value={v}>{t(v)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
          {t("filterDeliveryStatus")}
          <select aria-label={t("filterDeliveryStatus")} className="sizing-new-input sizing-new-input-sm" value={filters.delivery_status} onChange={(e) => patchFilters({ delivery_status: e.target.value })}>
            <option value="">{t("filterAll")}</option>
            {DELIVERY_STATUSES.map((v) => <option key={v} value={v}>{label("deliveryStatus", v)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]" title={t("filterProjectHint")}>
          {t("filterProject")}
          <select aria-label={t("filterProject")} className="sizing-new-input sizing-new-input-sm" value={customProject ? "__custom__" : filters.project_id} onChange={(e) => pickProject(e.target.value)}>
            <option value="">{t("filterAll")}</option>
            {observed.map((p) => <option key={p.id} value={p.id}>{p.project_no ?? p.id}</option>)}
            <option value="__custom__">{t("filterProjectCustom")}</option>
          </select>
        </label>
        {customProject && (
          <input
            aria-label={t("filterProjectAria")}
            placeholder="project id"
            className="sizing-new-input sizing-new-input-sm font-mono"
            style={{ width: "16rem" }}
            value={filters.project_id}
            onChange={(e) => patchFilters({ project_id: e.target.value })}
          />
        )}
        <input
          type="search"
          aria-label={t("filterQAria")}
          placeholder={t("filterQPlaceholder")}
          className="sizing-new-input sizing-new-input-sm"
          style={{ width: "14rem" }}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <span className="flex-1" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setTestOpen(true)}>{t("testSend")}</button>
      </div>
      {loadError && <p role="alert" className="mb-2 text-[color:var(--red-fg)]">{loadError}</p>}
      {rows === null ? (
        <p>{tc("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">{t("emptyNotifications")}</p>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table list-table table-fixed-pct tmin-56">
              <caption className="sr-only">{t("notificationsCaption")}</caption>
              <ColGroup widths={NOTIFICATIONS_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{t("colTime")}</th>
                  <th scope="col">{t("colSeverity")}</th>
                  <th scope="col">{t("colTrigger")}</th>
                  <th scope="col">{t("colProject")}</th>
                  <th scope="col">{t("colTitle")}</th>
                  <th scope="col">{t("colDelivery")}</th>
                  <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id} className="cursor-pointer" onClick={() => setDetailId(n.id)}>
                    <td className="col-date cell-truncate">{formatDateTime(n.sent_at, locale)}</td>
                    <td><SeverityChip severity={n.severity} /></td>
                    <td>{label("trigger", n.trigger_type)}</td>
                    <td className="cell-truncate">
                      {n.project ? (
                        <Link className="text-[color:var(--accent)] underline" href={`/projects/${n.project.id}`} onClick={(e) => e.stopPropagation()}>{n.project.project_no ?? n.project.id}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="cell-truncate">{n.title ?? t("titleNone")}</td>
                    <td><DeliveryBadges delivery={n.delivery} /></td>
                    <td className="sizing-actions-cell">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        aria-label={`${t("drawerAria")} — ${n.title ?? t("titleNone")}`}
                        onClick={(e) => { e.stopPropagation(); setDetailId(n.id); }}
                      >
                        {t("detailAction")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={meta?.page ?? page} pages={meta?.total_pages ?? 1} total={meta?.total ?? rows.length} onPage={setPage} />
        </>
      )}
      {detailId !== null && <NotificationDetailDrawer id={detailId} onClose={() => setDetailId(null)} />}
      {testOpen && <TestSendDialog onClose={() => setTestOpen(false)} />}
    </>
  );
}
