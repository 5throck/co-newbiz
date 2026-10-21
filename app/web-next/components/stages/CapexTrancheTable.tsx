"use client";

// S10 greenfield capex tranche table (ADR-0160 addendum, capex_tranche, migration 0136).
// Phased capex with release conditions. Every write is the human-only
// POST /api/projects/:id/capex-tranches route (create | update | set_status | retire); a released
// tranche is immutable. The table uses the shared fixed-percentage column system and the RowMenu
// overflow menu; status changes and retirement ask for a written reason.

import { useId, useState } from "react";
import { api } from "../../lib/api.ts";
import { ColGroup } from "../ui.tsx";
import { RowMenu, type RowMenuItem } from "../crud.tsx";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { TRANCHE_STATUS_LABEL } from "../../lib/labels.ts";
import {
  allowedTrancheTransitions,
  nextTrancheNo,
  releaseAction,
  trancheErrorText,
  trancheEditable,
  trancheSummary,
  validateTrancheForm,
  type TrancheStatus,
  type TrancheView,
} from "../../lib/greenfield-structure-view.ts";

/** Column shares (%): no, amount, release condition, status, [row actions]. */
const TRANCHE_COL_PCT_ACT = [8, 18, 40, 22, 12] as const;
const TRANCHE_COL_PCT_READONLY = [10, 22, 46, 22] as const;

const STATUS_CLS: Record<TrancheStatus, string> = { planned: "status-not-started", released: "status-green", withheld: "status-amber" };
const STATUS_ICON: Record<TrancheStatus, string> = { planned: "○", released: "✓", withheld: "⏸" };

type Dlg =
  | { kind: "edit"; t: TrancheView }
  | { kind: "status"; t: TrancheView; next: TrancheStatus }
  | { kind: "retire"; t: TrancheView };

const fmtAmount = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export function CapexTrancheTable({ projectId, tranches, canAct, onChanged, meUserId = null }: {
  projectId: string;
  /** Current viewer; used to hide the second-person approval from the requester and creator. */
  meUserId?: string | null;
  tranches: TrancheView[];
  canAct: boolean;
  onChanged: () => void;
}) {
  const uid = useId();
  const base = `/api/projects/${encodeURIComponent(projectId)}/capex-tranches`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [form, setForm] = useState({ trancheNo: "", amount: "", currency: "KRW", releaseCondition: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  async function post(body: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ release_pending?: boolean }>(base, body);
      if (body.action === "set_status" && body.status === "released") {
        // Two-person release: the first call only records a request (release_pending), the second releases.
        setAnnounce(r.data?.release_pending ? "집행 요청을 기록했습니다. 다른 한 사람의 승인이 필요합니다." : "집행을 승인해 집행 완료로 기록했습니다."); // INTERIM-WORDING
      }
      onChanged();
      return true;
    } catch (e) {
      const msg = trancheErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : "기록하지 못했습니다.");
      setError(msg);
      setAnnounce(`기록하지 못했습니다. ${msg}`); // INTERIM-WORDING
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const no = form.trancheNo.trim() === "" ? String(nextTrancheNo(tranches)) : form.trancheNo;
    const problem = validateTrancheForm({ ...form, trancheNo: no }, tranches.map((t) => t.tranche_no));
    setFormError(problem);
    if (problem) return;
    const ok = await post({ action: "create", tranche_no: Number(no), amount: Number(form.amount), currency: form.currency.trim() || "KRW", release_condition: form.releaseCondition.trim(), source_stage: "S10" });
    if (ok) setForm({ trancheNo: "", amount: "", currency: form.currency, releaseCondition: "" });
  }

  function menuItems(t: TrancheView): RowMenuItem[] {
    if (!trancheEditable(t.status)) return [];
    const items: RowMenuItem[] = [{ key: "edit", label: "금액·집행 조건 수정", onSelect: () => setDlg({ kind: "edit", t }) }];
    for (const next of allowedTrancheTransitions(t.status)) {
      if (next === "released") {
        const ra = releaseAction(t, meUserId);
        if (!ra.allowed) continue; // requester and creator never see the approve action
        items.push({ key: next, label: ra.kind === "approve" ? "집행 승인(집행 완료로 기록)" : "집행 요청 기록(다른 사람 승인 필요)", onSelect: () => setDlg({ kind: "status", t, next }) }); // INTERIM-WORDING
        continue;
      }
      const label = next === "withheld" ? "보류로 기록" : "집행 예정으로 되돌림";
      items.push({ key: next, label, onSelect: () => setDlg({ kind: "status", t, next }) });
    }
    items.push({ key: "retire", label: "폐기", danger: true, separatorBefore: true, onSelect: () => setDlg({ kind: "retire", t }) });
    return items;
  }

  const summary = trancheSummary(tranches);

  return (
    <section className="market-section sizing-step" aria-label="설비투자 집행 단계(집행 단계)" data-testid="capex-tranches">
      <h3 className="sizing-step-title text-[0.9rem]">설비투자 집행 단계 — 트랜치와 집행 조건 ({tranches.length}건)</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        투자금을 한 번에 집행하지 않고 조건이 충족될 때마다 나눠 집행합니다. 금액은 입력한 통화 단위 그대로이며, 집행 완료로 기록된 트랜치는 수정하거나 폐기할 수 없습니다.
        기록과 집행 판단은 사람만 합니다.
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}

      <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-48" aria-label="설비투자 집행 단계">
          <caption className="sr-only">설비투자 트랜치별 금액, 집행 조건, 상태</caption>
          <ColGroup widths={canAct ? TRANCHE_COL_PCT_ACT : TRANCHE_COL_PCT_READONLY} />
          <thead>
            <tr>
              <th scope="col">번호</th>
              <th scope="col" className="col-num">금액</th>
              <th scope="col">집행 조건</th>
              <th scope="col">상태</th>
              {canAct && <th scope="col">작업</th>}
            </tr>
          </thead>
          <tbody>
            {tranches.map((t) => (
              <tr key={t.id}>
                <th scope="row" data-label="번호" className="tabular-nums">{t.tranche_no}</th>
                <td data-label="금액" className="col-num tabular-nums">{fmtAmount(t.amount)} {t.currency}</td>
                <td data-label="집행 조건">{t.release_condition}</td>
                <td data-label="상태">
                  <span className={`status-chip ${STATUS_CLS[t.status]}`}><span aria-hidden="true">{STATUS_ICON[t.status]} </span>{TRANCHE_STATUS_LABEL[t.status] ?? t.status}</span>
                  {t.status === "planned" || t.status === "withheld" ? (() => {
                    const ra = t.pending_release ? releaseAction(t, meUserId) : null;
                    return ra?.stateText ? <span className="block text-[length:var(--fs-caption)]" data-testid="release-pending"><span className="status-chip status-amber"><span aria-hidden="true">⏳ </span>집행 요청 대기</span> {ra.stateText}</span> : null; // INTERIM-WORDING
                  })() : null}
                  {t.status_reason && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">사유: {t.status_reason}</span>}
                </td>
                {canAct && (
                  <td data-label="작업">
                    {menuItems(t).length > 0
                      ? <RowMenu label={`집행 단계 ${t.tranche_no} 작업`} items={menuItems(t)} />
                      : trancheEditable(t.status) ? <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">승인 대기</span> : <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">잠김</span>}
                  </td>
                )}
              </tr>
            ))}
            {tranches.length === 0 && (
              <tr><td colSpan={canAct ? 5 : 4}>등록된 트랜치가 없습니다 — 아래에서 첫 트랜치와 집행 조건을 기록하세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {summary.length > 0 && (
        <ul className="text-[length:var(--fs-caption)] mt-1" aria-label="통화별 집행 단계 합계">
          {summary.map((s) => (
            <li key={s.currency} className="tabular-nums">
              {s.currency} 합계 {fmtAmount(s.total)} — 집행 완료 {fmtAmount(s.released)} · 집행 예정 {fmtAmount(s.planned)} · 보류 {fmtAmount(s.withheld)}
            </li>
          ))}
        </ul>
      )}

      {canAct && (
        <form
          className="flex flex-wrap items-end gap-2 mt-2 text-[length:var(--fs-caption)]"
          aria-label="집행 단계 추가"
          onSubmit={(e) => { e.preventDefault(); void create(); }}
        >
          <label htmlFor={`${uid}-no`}>번호
            <input id={`${uid}-no`} className="sizing-new-input mono-num ml-1" style={{ width: "4.5rem" }} inputMode="numeric" placeholder={String(nextTrancheNo(tranches))} value={form.trancheNo} onChange={(e) => setForm({ ...form, trancheNo: e.target.value })} />
          </label>
          <label htmlFor={`${uid}-amt`}>금액 (필수)
            <input id={`${uid}-amt`} className="sizing-new-input mono-num ml-1" style={{ width: "9rem" }} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label htmlFor={`${uid}-cur`}>통화
            <input id={`${uid}-cur`} className="sizing-new-input ml-1" style={{ width: "4.5rem" }} maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          </label>
          <label htmlFor={`${uid}-cond`}>집행 조건 (필수)
            <input id={`${uid}-cond`} className="sizing-new-input ml-1" style={{ minWidth: "18rem" }} placeholder="예: 인허가 취득 및 1차 설비 발주 확정" value={form.releaseCondition} onChange={(e) => setForm({ ...form, releaseCondition: e.target.value })} />
          </label>
          <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? "기록 중..." : "집행 단계 추가"}</button>
        </form>
      )}
      {formError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {formError}</p>}

      {dlg && (
        <TrancheDialog
          dlg={dlg}
          busy={busy}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            const ok = dlg.kind === "edit"
              ? await post({ action: "update", tranche_id: dlg.t.id, amount: Number(v.amount), currency: v.currency, release_condition: v.releaseCondition })
              : dlg.kind === "status"
                ? await post({ action: "set_status", tranche_id: dlg.t.id, status: dlg.next, reason: v.reason })
                : await post({ action: "retire", tranche_id: dlg.t.id, reason: v.reason });
            if (ok) setDlg(null);
          }}
        />
      )}
    </section>
  );
}

function TrancheDialog({ dlg, busy, onClose, onSubmit }: {
  dlg: Dlg;
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { amount: string; currency: string; releaseCondition: string; reason: string }) => void | Promise<void>;
}) {
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [v, setV] = useState({ amount: String(dlg.t.amount), currency: dlg.t.currency, releaseCondition: dlg.t.release_condition, reason: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const edit = dlg.kind === "edit";
  const title = edit
    ? `집행 단계 ${dlg.t.tranche_no} 수정`
    : dlg.kind === "retire"
      ? `집행 단계 ${dlg.t.tranche_no} 폐기`
      : `집행 단계 ${dlg.t.tranche_no} — ${dlg.next === "released" ? (dlg.t.pending_release ? "집행 승인" : "집행 요청") : dlg.next === "withheld" ? "보류로 기록" : "집행 예정으로 되돌림"}`;

  function submit() {
    const p = edit
      ? validateTrancheForm({ trancheNo: String(dlg.t.tranche_no), amount: v.amount, currency: v.currency, releaseCondition: v.releaseCondition })
      : v.reason.trim() ? null : "사유를 입력하세요 — 집행 조건 충족 근거 또는 보류·폐기 사유입니다.";
    setProblem(p);
    if (!p) void onSubmit(v);
  }

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="tranche-dlg-title" style={{ maxWidth: "36rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="tranche-dlg-title" className="text-[1rem] font-semibold mb-1">{title}</h3>
        {dlg.kind === "status" && dlg.next === "released" && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {dlg.t.pending_release
              ? "다른 사람이 집행을 요청했습니다. 승인하면 집행 완료로 기록되어 되돌릴 수 없고 수정·폐기도 할 수 없습니다. 집행 판단은 사람의 결정이며 감사 기록에 남습니다."
              : "집행은 두 사람이 필요합니다. 지금 기록하면 집행 요청만 남고 상태는 바뀌지 않으며, 집행 단계 작성자와 요청자가 아닌 다른 사람이 승인해야 집행 완료가 됩니다."} {/* INTERIM-WORDING */}
          </p>
        )}
        {edit ? (
          <div className="flex flex-col gap-2 text-[length:var(--fs-caption)]">
            <label htmlFor="tranche-amt">금액 (필수)
              <input id="tranche-amt" className="sizing-new-input mono-num w-full" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
            </label>
            <label htmlFor="tranche-cur">통화
              <input id="tranche-cur" className="sizing-new-input w-full" maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />
            </label>
            <label htmlFor="tranche-cond">집행 조건 (필수)
              <textarea id="tranche-cond" className="sizing-new-input w-full" rows={3} value={v.releaseCondition} onChange={(e) => setV({ ...v, releaseCondition: e.target.value })} />
            </label>
          </div>
        ) : (
          <label className="text-[length:var(--fs-caption)] block" htmlFor="tranche-reason">사유 (필수)
            <textarea id="tranche-reason" className="sizing-new-input mt-1 w-full" rows={3} required aria-required="true" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </label>
        )}
        <p role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">{problem ? `✕ ${problem}` : ""}</p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>취소</button>
          <button type="button" className={dlg.kind === "retire" ? "btn-danger btn-sm" : "btn-ghost btn-sm"} disabled={busy} onClick={submit}>
            {dlg.kind === "retire" ? "폐기" : dlg.kind === "status" && dlg.next === "released" ? (dlg.t.pending_release ? "집행 승인" : "집행 요청 기록") : "기록"}
          </button>
        </div>
      </div>
    </div>
  );
}
