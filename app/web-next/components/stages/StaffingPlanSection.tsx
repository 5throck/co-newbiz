"use client";

// ADR-0175 slice 1 — S5 인력 운영 계획 (collapsible, above the investment item list). Controlled by
// GreenfieldStage; saved through the "인건비 항목 저장" button, which also saves the whole investment list. Decision support only: every rate is
// an editable assumption, rows without salary or 가산율 are excluded from cost with a flag.
// AI proposal is a later slice (see lib/staffing-plan.ts seam comment).
import { useMemo, useState } from "react";
import { KO_DATA } from "../../lib/ko-data-values.ts";
import { useLocale, useTranslations } from "next-intl";
import { newStaffingRow, staffingPlanView, MAX_STAFFING_ROWS, type StaffingDuplicateWarning, type StaffingPlanEntry, type StaffingRow } from "../../lib/staffing-plan.ts";
import { formatNumber } from "../../lib/format.ts";
import { ColGroup } from "../ui.tsx";
import { staffingColPct } from "./constants.ts";

const numOrNull = (raw: string): number | null => (raw === "" ? null : Number(raw));

export function StaffingPlanSection({ plan, horizon, canAct, masked, error, warnings, onChange, onDismiss }: {
  plan: StaffingPlanEntry;
  horizon: number;
  canAct: boolean;
  /** Read-only roles: salary / 가산율 / 인상률 cells render "***" (server already removed the values). */
  masked: boolean;
  error: string | null;
  warnings: StaffingDuplicateWarning[];
  onChange: (p: StaffingPlanEntry) => void;
  onDismiss: (w: StaffingDuplicateWarning) => void;
}) {const t = useTranslations("stages.s5.staffingPlan"); const tc = useTranslations("common");
  const locale = useLocale();
  const fmt = (n: number) => formatNumber(n, locale, { maximumFractionDigits: 2 });
  const [open, setOpen] = useState(plan.rows.length > 0);
  const view = useMemo(() => staffingPlanView(plan, horizon), [plan, horizon]);
  const years = Array.from({ length: horizon }, (_, i) => i + 1);
  const setRow = (id: string, patch: Partial<StaffingRow>) => onChange({ ...plan, rows: plan.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const setHc = (id: string, idx: number, v: number) => onChange({ ...plan, rows: plan.rows.map((r) => (r.id === id ? { ...r, headcountByYear: r.headcountByYear.map((h, i) => (i === idx ? v : h)) } : r)) });
  const disabled = !canAct;
  const mask = (
    <span className="status-chip status-not-started" data-testid="staffing-masked-cell"><span aria-hidden="true">🔒</span> ***<span className="sr-only"> {t("noViewPermission")}</span></span>
  );
  return (
    <div className="sizing-grade-card mb-3" data-testid="staffing-plan">
      <button type="button" className="btn-ghost btn-sm" aria-expanded={open} aria-controls="staffing-plan-body" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {t("staffingPlan")}{plan.rows.length}{t("row")}
      </button>
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> {tc("laborCost")} {fmt(view.totalKrwM)}{t("krwMillionsReviewPeriod")} {horizon}{t("yr")}</span>
      {open && (
        <div id="staffing-plan-body" className="mt-2">
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {t("computesLaborCostFromHeadcount")}
          </p>
          {masked && <p className="status-chip status-amber mb-2" role="status" data-testid="staffing-masked-note"><span aria-hidden="true">🔒</span> {t("salaryAndUpliftRatesAre")}</p>}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <label className="text-[length:var(--fs-caption)] flex items-center gap-1">{t("startYear")}
              <input aria-label={t("staffingPlanStartYear")} type="number" min={1} max={horizon} value={plan.startYear} disabled={disabled} className="sizing-new-input sizing-new-input-sm" style={{ width: "3.5rem" }}
                onChange={(e) => onChange({ ...plan, startYear: Number(e.target.value) })} />
            </label>
            <label className="text-[length:var(--fs-caption)] flex items-center gap-1">{t("endYear")}
              <input aria-label={t("staffingPlanEndYear")} type="number" min={1} max={horizon} value={plan.endYear} disabled={disabled} className="sizing-new-input sizing-new-input-sm" style={{ width: "3.5rem" }}
                onChange={(e) => onChange({ ...plan, endYear: Number(e.target.value) })} />
            </label>
          </div>
          {error && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2" data-testid="staffing-error">{error}</p>}
          {warnings.map((w) => (
            <div key={`${w.rowId}-${w.manualIndex}`} className="flex items-center gap-1 mb-1" data-testid="staffing-dup-warning">
              <span className="status-chip status-amber"><span aria-hidden="true">!</span> {t("checkManualLaborCost")}{w.manualLine}{t("mapsToTheStaffingPlan")}{w.rowLabel}{t("mayOverlap")}</span>
              {canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => onDismiss(w)}>{t("noOverlap")}</button>}
            </div>
          ))}
          <div className="table-scroll mb-1">
            <table className="data-table table-fixed-pct tmin-56" aria-label={t("staffingPlanTable")} data-testid="staffing-grid">
              <ColGroup widths={staffingColPct(years.length)} />
              <thead>
                <tr>
                  <th scope="col">{t("jobFamily")}</th>
                  <th scope="col">{t("jobTitle")}</th>
                  {years.map((y) => <th scope="col" key={y}>{t("headcountY")}{y}</th>)}
                  <th scope="col">{t("averageSalaryKrwMillions")}</th>
                  <th scope="col">{t("increaseRate")}</th>
                  <th scope="col">{t("upliftRate")}</th>
                  <th scope="col">{t("hiringCostKrwMillions")}</th>
                  <th scope="col">{tc("status")}</th>
                  <th scope="col">{tc("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, ri) => {
                  const flags = view.rows[ri]?.flags ?? [];
                  return (
                    <tr key={r.id} data-testid={`staffing-row-${ri}`}>
                      <td><input aria-label={t("jobFamily2")} value={r.roleFamily} maxLength={60} disabled={disabled} onChange={(e) => setRow(r.id, { roleFamily: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} /></td>
                      <td><input aria-label={t("jobTitle2")} value={r.grade} maxLength={60} disabled={disabled} onChange={(e) => setRow(r.id, { grade: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "5rem" }} /></td>
                      {years.map((y, yi) => (
                        <td key={y}><input aria-label={t("p1YP2Headcount", { p1: r.roleFamily || t("row"), p2: y })} type="number" min={0} step={1} value={r.headcountByYear[yi] ?? 0} disabled={disabled} onChange={(e) => setHc(r.id, yi, Number(e.target.value))} className="sizing-new-input sizing-new-input-sm" style={{ width: "3.5rem" }} /></td>
                      ))}
                      <td>{masked ? mask : <input aria-label={t("averageSalaryKrwMillions2")} type="number" min={0} value={r.avgAnnualBaseSalaryKrwM ?? ""} disabled={disabled} onChange={(e) => setRow(r.id, { avgAnnualBaseSalaryKrwM: numOrNull(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "5rem" }} />}</td>
                      <td>{masked ? mask : <input aria-label={t("annualIncreaseRate")} type="number" min={0} max={100} value={r.salaryIncreaseRatePct} disabled={disabled} onChange={(e) => setRow(r.id, { salaryIncreaseRatePct: Number(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "4rem" }} />}</td>
                      <td>{masked ? mask : <input aria-label={t("upliftRate2")} type="number" min={0} max={100} placeholder={t("hrCheck")} value={r.onCostRatePct ?? ""} disabled={disabled} onChange={(e) => setRow(r.id, { onCostRatePct: numOrNull(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "4rem" }} />}</td>
                      <td><input aria-label={t("hiringCostKrwMillions2")} type="number" min={0} value={r.recruitingOneOffKrwM} disabled={disabled} onChange={(e) => setRow(r.id, { recruitingOneOffKrwM: Number(e.target.value) || 0 })} className="sizing-new-input sizing-new-input-sm" style={{ width: "4.5rem" }} /></td>
                      <td>{flags.map((f) => <span key={f} className="status-chip status-amber" data-testid="staffing-flag"><span aria-hidden="true">!</span> {f === KO_DATA.staffingFlagSalaryMissing || f.startsWith(KO_DATA.staffingFlagUpliftPrefix) ? tc("needsCheck") : t("intentCheck")}<span className="sr-only"> {f}</span></span>)}</td>
                      <td>{canAct && <button type="button" className="btn-ghost btn-sm" aria-label={t("deleteP1", { p1: r.roleFamily || t("row") })} onClick={() => onChange({ ...plan, rows: plan.rows.filter((x) => x.id !== r.id) })}>✕</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canAct && (
            <button type="button" className="btn-ghost btn-sm mb-2" disabled={plan.rows.length >= MAX_STAFFING_ROWS} onClick={() => onChange({ ...plan, rows: [...plan.rows, newStaffingRow(horizon)] })}>{t("addRow")}</button>
          )}
          <div className="table-scroll" data-testid="staffing-result">
            <table className="data-table tmin-56" aria-label={t("staffingLaborCostResults")}>
              <thead>
                <tr><th scope="col">{t("categoryKrwMillionsPersons")}</th>{years.map((y) => <th scope="col" key={y}>Y{y}</th>)}<th scope="col">{tc("total")}</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">{tc("laborCost")}</th>{view.costByYear.map((c, i) => <td className="mono-num" key={i}>{fmt(c)}</td>)}<td className="mono-num">{fmt(view.totalKrwM)}</td></tr>
                <tr><th scope="row">{t("headcount")}</th>{view.headcountByYear.map((h, i) => <td className="mono-num" key={i}>{fmt(h)}</td>)}<td className="mono-num">{t("annualAverage")} {view.avgHeadcount === null ? "-" : fmt(view.avgHeadcount)}{tc("peopleUnit")}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-[length:var(--fs-caption)] mt-1" role="status" data-testid="staffing-summary">
            {t("totalLaborCost")} {fmt(view.totalKrwM)}{t("krwMillionsHiringCost")} {fmt(view.recruitingTotalKrwM)}{t("krwMillionsAnnualAverageHeadcount")} {view.avgHeadcount === null ? "-" : fmt(view.avgHeadcount)}{t("personSConfirmationNeeded")} {view.needConfirmCount}{t("rowsLaborCostNotAccrued")}
          </p>
        </div>
      )}
    </div>
  );
}
