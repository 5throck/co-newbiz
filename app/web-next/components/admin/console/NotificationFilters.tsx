"use client";

// Filter bar of the /admin/notifications history panel (design 2026-10-29-scheduled-jobs-design
// §13.5, P4) — extracted from NotificationSection.tsx (2026-11 coverage-gate file-length split).
// Presentational only: the filter state (filters, debounced q, page, custom-ID fallback,
// observed projects) and the debounced server query stay in the section, and every change flows
// back through patchFilters / pickProject / onQInput — behavior is identical to the pre-split bar.
import { useTranslations } from "next-intl";
import { useAdminLabel } from "./admin-ui.tsx";

/** The notification CHECK's 11 trigger values (0185) — the filter's option set. */
const TRIGGER_TYPES = [
  "rag_upgrade",
  "rag_downgrade",
  "kill_criteria",
  "regulation_change",
  "threshold_breach",
  "staleness",
  "batch_failure",
  "pipeline_paused",
  "establishment_step_reopened",
  "establishment_step_assigned",
  "test",
] as const;
const SEVERITIES = ["opportunity", "warning", "urgent", "info", "ops"] as const;
const CHANNELS = ["in_app", "email", "webhook"] as const; // bound-inclusive server matching
const READ_STATES = ["read", "unread"] as const;
const DELIVERY_STATUSES = ["pending", "retry", "sent", "failed", "skipped", "deferred"] as const;
const PERIODS = ["24h", "7d", "30d", "90d", "all", "custom"] as const;
type Period = (typeof PERIODS)[number];

export interface Filters {
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

export const EMPTY_FILTERS: Filters = {
  period: "30d",
  from: "",
  to: "",
  trigger_type: "",
  severity: "",
  channel: "",
  read: "",
  delivery_status: "",
  project_id: "",
};

/** Period preset → `from` bound (ISO); `all`/`custom` return null (custom uses the date inputs). */
export function periodFrom(period: Period, from: string, to: string): { from: string | null; to: string | null } {
  if (period === "all") return { from: null, to: null };
  if (period === "custom") return { from: from || null, to: to || null };
  const hours = period === "24h" ? 24 : period === "7d" ? 24 * 7 : period === "30d" ? 24 * 30 : 24 * 90;
  return { from: new Date(Date.now() - hours * 3_600_000).toISOString(), to: null };
}

export interface NotificationFiltersProps {
  filters: Filters;
  patchFilters: (patch: Partial<Filters>) => void;
  customProject: boolean;
  pickProject: (value: string) => void;
  observed: Array<{ id: string; project_no: string | null }>;
  qInput: string;
  onQInput: (value: string) => void;
  onOpenTestSend: () => void;
}

export function NotificationFilters({
  filters,
  patchFilters,
  customProject,
  pickProject,
  observed,
  qInput,
  onQInput,
  onOpenTestSend,
}: NotificationFiltersProps) {
  const t = useTranslations("admin.ops");
  const label = useAdminLabel();
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
        {t("filterPeriod")}
        <select
          aria-label={t("filterPeriod")}
          className="sizing-new-input sizing-new-input-sm"
          value={filters.period}
          onChange={(e) => patchFilters({ period: e.target.value as Period })}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`period_${p}`)}
            </option>
          ))}
        </select>
      </label>
      {filters.period === "custom" && (
        <>
          <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
            {t("filterFrom")}
            <input
              type="date"
              aria-label={t("filterFrom")}
              className="sizing-new-input sizing-new-input-sm"
              value={filters.from}
              onChange={(e) => patchFilters({ from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
            {t("filterTo")}
            <input
              type="date"
              aria-label={t("filterTo")}
              className="sizing-new-input sizing-new-input-sm"
              value={filters.to}
              onChange={(e) => patchFilters({ to: e.target.value })}
            />
          </label>
        </>
      )}
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
        {t("filterTrigger")}
        <select
          aria-label={t("filterTrigger")}
          className="sizing-new-input sizing-new-input-sm"
          value={filters.trigger_type}
          onChange={(e) => patchFilters({ trigger_type: e.target.value })}
        >
          <option value="">{t("filterAll")}</option>
          {TRIGGER_TYPES.map((v) => (
            <option key={v} value={v}>
              {label("trigger", v)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
        {t("filterSeverity")}
        <select
          aria-label={t("filterSeverity")}
          className="sizing-new-input sizing-new-input-sm"
          value={filters.severity}
          onChange={(e) => patchFilters({ severity: e.target.value })}
        >
          <option value="">{t("filterAll")}</option>
          {SEVERITIES.map((v) => (
            <option key={v} value={v}>
              {label("severity", v)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
        {t("filterChannel")}
        <select
          aria-label={t("filterChannel")}
          className="sizing-new-input sizing-new-input-sm"
          value={filters.channel}
          onChange={(e) => patchFilters({ channel: e.target.value })}
        >
          <option value="">{t("filterAll")}</option>
          {CHANNELS.map((v) => (
            <option key={v} value={v}>
              {label("channel", v)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
        {t("filterRead")}
        <select
          aria-label={t("filterRead")}
          className="sizing-new-input sizing-new-input-sm"
          value={filters.read}
          onChange={(e) => patchFilters({ read: e.target.value })}
        >
          <option value="">{t("filterAll")}</option>
          {READ_STATES.map((v) => (
            <option key={v} value={v}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap">
        {t("filterDeliveryStatus")}
        <select
          aria-label={t("filterDeliveryStatus")}
          className="sizing-new-input sizing-new-input-sm"
          value={filters.delivery_status}
          onChange={(e) => patchFilters({ delivery_status: e.target.value })}
        >
          <option value="">{t("filterAll")}</option>
          {DELIVERY_STATUSES.map((v) => (
            <option key={v} value={v}>
              {label("deliveryStatus", v)}
            </option>
          ))}
        </select>
      </label>
      <label
        className="flex items-center gap-1 text-[length:var(--fs-caption)] whitespace-nowrap"
        title={t("filterProjectHint")}
      >
        {t("filterProject")}
        {/* project_no(관리자 화면에서 프로젝트를 부르는 유일한 이름)가 5rem 하한에 잘리지 않도록
            넓은 min-width를 둔다(2026-11 사용자 결함 보고 2). UUID 폴백은 드롭다운 목록에서 완전히 읽힌다. */}
        <select
          aria-label={t("filterProject")}
          className="sizing-new-input sizing-new-input-sm"
          style={{ minWidth: "12rem" }}
          value={customProject ? "__custom__" : filters.project_id}
          onChange={(e) => pickProject(e.target.value)}
        >
          <option value="">{t("filterAll")}</option>
          {observed.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_no ?? p.id}
            </option>
          ))}
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
        onChange={(e) => onQInput(e.target.value)}
      />
      <span className="flex-1" />
      <button type="button" className="btn-ghost btn-sm" onClick={onOpenTestSend}>
        {t("testSend")}
      </button>
    </div>
  );
}
