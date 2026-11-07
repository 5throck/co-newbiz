"use client";

// ADR-0193 (risk-officer E): the IC package lists, BY NAME, the kill criteria carried from earlier gates that were
// evaluated but are still unassessed (closure "open") and the S12 criteria that stay open_monitoring. Read-only.
// `null` means the server could not compute it - shown as such, never as "none". `undefined` (an older response) renders nothing.
import { useTranslations } from "next-intl";
import { closureView, isNamedGate, type KillClosure } from "../lib/gate-ack-view.ts";
import { useKillCriteriaLabels } from "../lib/use-kill-criteria-labels.ts";

export interface KillCarryRow {
  key: string;
  title: string;
  action: string;
  outcome: string;
  closure: KillClosure | string;
  reason?: string | null;
  evaluable_from: string;
  reevaluate_at: string;
  from_decision_id?: string | null;
}
export interface KillCarriesView {
  /** The IC gate the preview was computed for. */
  gate: string;
  open: KillCarryRow[];
  open_monitoring: KillCarryRow[];
}

export function KillCarriesPanel({ carries }: { carries: KillCarriesView | null | undefined }) {
  const t = useTranslations("components.killCarries");
  const tg = useTranslations("common.gate");
  const ts = useTranslations("components.gateSnapshot");
  const kc = useKillCriteriaLabels();
  if (carries === undefined) return null;
  const gate = (g: string) => (isNamedGate(g) ? tg(g as never) : g);
  const row = (c: KillCarryRow) => {
    const cv = closureView(c.closure);
    return (
      <li key={c.key} data-closure={cv.id}>
        <span className="font-semibold">{kc.titleOfKey(c.key, c.title)}</span>{" "}
        <span className={`status-chip ${cv.tone === "amber" ? "status-amber" : cv.tone === "green" ? "status-green" : "status-not-started"}`}>
          <span aria-hidden="true">{cv.icon}</span> {ts(`closure.${cv.id}` as never)}
        </span>
        {c.action && <span className="text-[color:var(--muted-fg)]"> · {ts("actionLabel", { action: kc.action(c.action) })}</span>}
        <span className="block text-[color:var(--muted-fg)]">
          {cv.id === "open_monitoring" ? ts("carryMonitoring") : isNamedGate(c.reevaluate_at) ? ts("carryReevaluated", { stage: c.evaluable_from, gate: gate(c.reevaluate_at) }) : ""}
        </span>
      </li>
    );
  };
  return (
    <section aria-label={t("heading")} data-testid="ic-kill-carries">
      <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">{t("heading")}</h4>
      {carries === null ? (
        <p role="note" className="text-[length:var(--fs-caption)]" data-testid="ic-kill-carries-unavailable">
          <span aria-hidden="true">⚠</span> {t("unavailable")}
        </p>
      ) : carries.open.length === 0 && carries.open_monitoring.length === 0 ? (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="ic-kill-carries-none">
          <span aria-hidden="true">✓</span> {t("none", { gate: gate(carries.gate) })}
        </p>
      ) : (
        <div className="grid gap-2 text-[length:var(--fs-caption)]">
          {carries.open.length > 0 && (
            <div>
              <p className="font-semibold m-0">{t("openHeading", { count: carries.open.length })}</p>
              <ul className="sizing-note-list">{carries.open.map(row)}</ul>
            </div>
          )}
          {carries.open_monitoring.length > 0 && (
            <div>
              <p className="font-semibold m-0">{t("monitoringHeading", { count: carries.open_monitoring.length })}</p>
              <ul className="sizing-note-list">{carries.open_monitoring.map(row)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
