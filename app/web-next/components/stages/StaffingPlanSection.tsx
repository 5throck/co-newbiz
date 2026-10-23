"use client";

// ADR-0175 slice 1 — S5 인력 운영 계획 (collapsible, above the investment item list). Controlled by
// GreenfieldStage; saved through the "인건비 항목 저장" button, which also saves the whole investment list. Decision support only: every rate is
// an editable assumption, rows without salary or 가산율 are excluded from cost with a flag.
// AI proposal is a later slice (see lib/staffing-plan.ts seam comment).
import { useMemo, useState } from "react";
import { newStaffingRow, staffingPlanView, MAX_STAFFING_ROWS, type StaffingDuplicateWarning, type StaffingPlanEntry, type StaffingRow } from "../../lib/staffing-plan.ts";
import { ColGroup } from "../ui.tsx";
import { staffingColPct } from "./constants.ts";

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
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
}) {
  const [open, setOpen] = useState(plan.rows.length > 0);
  const view = useMemo(() => staffingPlanView(plan, horizon), [plan, horizon]);
  const years = Array.from({ length: horizon }, (_, i) => i + 1);
  const setRow = (id: string, patch: Partial<StaffingRow>) => onChange({ ...plan, rows: plan.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const setHc = (id: string, idx: number, v: number) => onChange({ ...plan, rows: plan.rows.map((r) => (r.id === id ? { ...r, headcountByYear: r.headcountByYear.map((h, i) => (i === idx ? v : h)) } : r)) });
  const disabled = !canAct;
  const mask = (
    <span className="status-chip status-not-started" data-testid="staffing-masked-cell"><span aria-hidden="true">🔒</span> ***<span className="sr-only"> 열람 권한 없음</span></span>
  );
  return (
    <div className="sizing-grade-card mb-3" data-testid="staffing-plan">
      <button type="button" className="btn-ghost btn-sm" aria-expanded={open} aria-controls="staffing-plan-body" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} 인력 운영 계획 ({plan.rows.length}행)
      </button>
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> 인건비 {fmt(view.totalKrwM)}백만원 (검토 기간 {horizon}년)</span>
      {open && (
        <div id="staffing-plan-body" className="mt-2">
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            직무군·직급별 인원과 평균 연봉(집계값, 개인 정보 입력 금지)으로 인건비를 산정합니다. 인상률·가산율은 가정값이며 HR·법무 확인이 필요합니다 — 급여나 가산율이 비어 있는 행은 인건비에서 제외되고 "확인 필요"로 표시됩니다.
          </p>
          {masked && <p className="status-chip status-amber mb-2" role="status" data-testid="staffing-masked-note"><span aria-hidden="true">🔒</span> 급여·가산율은 analyst 권한만 볼 수 있습니다</p>}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <label className="text-[length:var(--fs-caption)] flex items-center gap-1">시작 연차
              <input aria-label="인력 운영 계획 시작 연차" type="number" min={1} max={horizon} value={plan.startYear} disabled={disabled} className="sizing-new-input sizing-new-input-sm" style={{ width: "3.5rem" }}
                onChange={(e) => onChange({ ...plan, startYear: Number(e.target.value) })} />
            </label>
            <label className="text-[length:var(--fs-caption)] flex items-center gap-1">종료 연차
              <input aria-label="인력 운영 계획 종료 연차" type="number" min={1} max={horizon} value={plan.endYear} disabled={disabled} className="sizing-new-input sizing-new-input-sm" style={{ width: "3.5rem" }}
                onChange={(e) => onChange({ ...plan, endYear: Number(e.target.value) })} />
            </label>
          </div>
          {error && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2" data-testid="staffing-error">{error}</p>}
          {warnings.map((w) => (
            <div key={`${w.rowId}-${w.manualIndex}`} className="flex items-center gap-1 mb-1" data-testid="staffing-dup-warning">
              <span className="status-chip status-amber"><span aria-hidden="true">!</span> 이중 계상 확인 — 수동 인건비 "{w.manualLine}"이(가) 인력 운영 계획 "{w.rowLabel}"과 겹칠 수 있습니다</span>
              {canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => onDismiss(w)}>겹치지 않음</button>}
            </div>
          ))}
          <div className="table-scroll mb-1">
            <table className="data-table table-fixed-pct tmin-56" aria-label="인력 운영 계획 표" data-testid="staffing-grid">
              <ColGroup widths={staffingColPct(years.length)} />
              <thead>
                <tr>
                  <th scope="col">직무군</th>
                  <th scope="col">직급</th>
                  {years.map((y) => <th scope="col" key={y}>인원 Y{y}</th>)}
                  <th scope="col">평균 연봉(백만원)</th>
                  <th scope="col">인상률(%)</th>
                  <th scope="col">가산율(%)</th>
                  <th scope="col">채용 일회비(백만원)</th>
                  <th scope="col">상태</th>
                  <th scope="col">작업</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, ri) => {
                  const flags = view.rows[ri]?.flags ?? [];
                  return (
                    <tr key={r.id} data-testid={`staffing-row-${ri}`}>
                      <td><input aria-label="직무군" value={r.roleFamily} maxLength={60} disabled={disabled} onChange={(e) => setRow(r.id, { roleFamily: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} /></td>
                      <td><input aria-label="직급" value={r.grade} maxLength={60} disabled={disabled} onChange={(e) => setRow(r.id, { grade: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "5rem" }} /></td>
                      {years.map((y, yi) => (
                        <td key={y}><input aria-label={`${r.roleFamily || "행"} Y${y} 인원`} type="number" min={0} step={1} value={r.headcountByYear[yi] ?? 0} disabled={disabled} onChange={(e) => setHc(r.id, yi, Number(e.target.value))} className="sizing-new-input sizing-new-input-sm" style={{ width: "3.5rem" }} /></td>
                      ))}
                      <td>{masked ? mask : <input aria-label="평균 연봉(백만원)" type="number" min={0} value={r.avgAnnualBaseSalaryKrwM ?? ""} disabled={disabled} onChange={(e) => setRow(r.id, { avgAnnualBaseSalaryKrwM: numOrNull(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "5rem" }} />}</td>
                      <td>{masked ? mask : <input aria-label="연 인상률(%)" type="number" min={0} max={100} value={r.salaryIncreaseRatePct} disabled={disabled} onChange={(e) => setRow(r.id, { salaryIncreaseRatePct: Number(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "4rem" }} />}</td>
                      <td>{masked ? mask : <input aria-label="가산율(%)" type="number" min={0} max={100} placeholder="HR 확인" value={r.onCostRatePct ?? ""} disabled={disabled} onChange={(e) => setRow(r.id, { onCostRatePct: numOrNull(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "4rem" }} />}</td>
                      <td><input aria-label="채용 일회비(백만원)" type="number" min={0} value={r.recruitingOneOffKrwM} disabled={disabled} onChange={(e) => setRow(r.id, { recruitingOneOffKrwM: Number(e.target.value) || 0 })} className="sizing-new-input sizing-new-input-sm" style={{ width: "4.5rem" }} /></td>
                      <td>{flags.map((f) => <span key={f} className="status-chip status-amber" data-testid="staffing-flag"><span aria-hidden="true">!</span> {f === "급여 미입력 — 인건비 미계상" || f.startsWith("가산율") ? "확인 필요" : "의도 확인"}<span className="sr-only"> {f}</span></span>)}</td>
                      <td>{canAct && <button type="button" className="btn-ghost btn-sm" aria-label={`${r.roleFamily || "행"} 삭제`} onClick={() => onChange({ ...plan, rows: plan.rows.filter((x) => x.id !== r.id) })}>✕</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canAct && (
            <button type="button" className="btn-ghost btn-sm mb-2" disabled={plan.rows.length >= MAX_STAFFING_ROWS} onClick={() => onChange({ ...plan, rows: [...plan.rows, newStaffingRow(horizon)] })}>+ 행 추가</button>
          )}
          <div className="table-scroll" data-testid="staffing-result">
            <table className="data-table tmin-56" aria-label="인력 인건비 결과">
              <thead>
                <tr><th scope="col">구분 (백만원 / 명)</th>{years.map((y) => <th scope="col" key={y}>Y{y}</th>)}<th scope="col">합계</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">인건비</th>{view.costByYear.map((c, i) => <td className="mono-num" key={i}>{fmt(c)}</td>)}<td className="mono-num">{fmt(view.totalKrwM)}</td></tr>
                <tr><th scope="row">인원</th>{view.headcountByYear.map((h, i) => <td className="mono-num" key={i}>{fmt(h)}</td>)}<td className="mono-num">연평균 {view.avgHeadcount === null ? "-" : fmt(view.avgHeadcount)}명</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-[length:var(--fs-caption)] mt-1" role="status" data-testid="staffing-summary">
            총 인건비 {fmt(view.totalKrwM)}백만원 · 채용 일회비 {fmt(view.recruitingTotalKrwM)}백만원 · 연평균 인원 {view.avgHeadcount === null ? "-" : fmt(view.avgHeadcount)}명 · 확인 필요 {view.needConfirmCount}행 (인건비 미계상) · 투자비 요약의 인건비에 "인력 운영 계획 연동"으로 반영됩니다
          </p>
        </div>
      )}
    </div>
  );
}
