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
import { useTranslations } from "next-intl";
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
}) {const t = useTranslations("stages.s10.capexTranche"); const tc = useTranslations("common");
  /** Capex tranche status chip → catalog key (ko master wording mirrors the former labels.ts TRANCHE_STATUS_LABEL). */
  const TRANCHE_STATUS_KEY: Record<string, string> = {
    planned: "statusPlanned",
    released: "statusReleased",
    withheld: "statusWithheld",
  };
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
        setAnnounce(r.data?.release_pending ? t("executionRequestRecordedApprovalFrom") : t("executionApprovedAndRecordedAs")); // INTERIM-WORDING
      }
      onChanged();
      return true;
    } catch (e) {
      const msg = trancheErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : t("failedToRecord"));
      setError(msg);
      setAnnounce(t("failedToRecordP1", { p1: msg })); // INTERIM-WORDING
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

  function menuItems(rec: TrancheView): RowMenuItem[] {
    if (!trancheEditable(rec.status)) return [];
    const items: RowMenuItem[] = [{ key: "edit", label: t("editAmountAndExecutionConditions"), onSelect: () => setDlg({ kind: "edit", t: rec }) }];
    for (const next of allowedTrancheTransitions(rec.status)) {
      if (next === "released") {
        const ra = releaseAction(rec, meUserId);
        if (!ra.allowed) continue; // requester and creator never see the approve action
        items.push({ key: next, label: ra.kind === "approve" ? t("approveExecutionRecordsExecutionComplete") : t("recordExecutionRequestAnotherPerson"), onSelect: () => setDlg({ kind: "status", t: rec, next }) }); // INTERIM-WORDING
        continue;
      }
      const label = next === "withheld" ? t("recordAsHold") : t("revertedTo");
      items.push({ key: next, label, onSelect: () => setDlg({ kind: "status", t: rec, next }) });
    }
    items.push({ key: "retire", label: tc("discard"), danger: true, separatorBefore: true, onSelect: () => setDlg({ kind: "retire", t: rec }) });
    return items;
  }

  const summary = trancheSummary(tranches);

  return (
    <section className="market-section sizing-step" aria-label={t("capexExecutionStageExecutionStage")} data-testid="capex-tranches">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("capexExecutionStageTranchesAnd")}{tranches.length}{tc("countSuffixParen")}</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("deploysTheInvestmentInTranches")}
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}

      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-48" aria-label={t("capexExecutionStage")}>
          <caption className="sr-only">{t("amountExecutionConditionsAndStatus")}</caption>
          <ColGroup widths={canAct ? TRANCHE_COL_PCT_ACT : TRANCHE_COL_PCT_READONLY} />
          <thead>
            <tr>
              <th scope="col">{tc("rowNumber")}</th>
              <th scope="col" className="col-num">{tc("amount")}</th>
              <th scope="col">{t("executionCondition")}</th>
              <th scope="col">{tc("status")}</th>
              {canAct && <th scope="col">{tc("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {tranches.map((rec) => (
              <tr key={rec.id}>
                <th scope="row" data-label={tc("rowNumber")} className="tabular-nums">{rec.tranche_no}</th>
                <td data-label={tc("amount")} className="col-num tabular-nums">{fmtAmount(rec.amount)} {rec.currency}</td>
                <td data-label={t("executionCondition")}>{rec.release_condition}</td>
                <td data-label={tc("status")}>
                  <span className={`status-chip ${STATUS_CLS[rec.status]}`}><span aria-hidden="true">{STATUS_ICON[rec.status]} </span>{TRANCHE_STATUS_KEY[rec.status] ? t(TRANCHE_STATUS_KEY[rec.status]) : rec.status}</span>
                  {rec.status === "planned" || rec.status === "withheld" ? (() => {
                    const ra = rec.pending_release ? releaseAction(rec, meUserId) : null;
                    return ra?.stateText ? <span className="block text-[length:var(--fs-caption)]" data-testid="release-pending"><span className="status-chip status-amber"><span aria-hidden="true">⏳ </span>{t("executionRequestPending")}</span> {ra.stateText}</span> : null; // INTERIM-WORDING
                  })() : null}
                  {rec.status_reason && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("reasonColon")} {rec.status_reason}</span>}
                </td>
                {canAct && (
                  <td data-label={tc("actions")}>
                    {menuItems(rec).length > 0
                      ? <RowMenu label={t("workOnExecutionStageP1", { p1: rec.tranche_no })} items={menuItems(rec)} />
                      : trancheEditable(rec.status) ? <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("awaitingApproval")}</span> : <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("locked")}</span>}
                  </td>
                )}
              </tr>
            ))}
            {tranches.length === 0 && (
              <tr><td colSpan={canAct ? 5 : 4}>{t("noTranchesRegisteredRecordThe")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {summary.length > 0 && (
        <ul className="text-[length:var(--fs-caption)] mt-1" aria-label={t("executionStageTotalsByCurrency")}>
          {summary.map((s) => (
            <li key={s.currency} className="tabular-nums">
              {s.currency} {tc("total")} {fmtAmount(s.total)} {t("executionComplete")} {fmtAmount(s.released)} {t("scheduledForExecution")} {fmtAmount(s.planned)} {t("hold")} {fmtAmount(s.withheld)}
            </li>
          ))}
        </ul>
      )}

      {canAct && (
        <form
          className="flex flex-wrap items-end gap-2 mt-2 text-[length:var(--fs-caption)]"
          aria-label={t("addExecutionStage")}
          onSubmit={(e) => { e.preventDefault(); void create(); }}
        >
          <label htmlFor={`${uid}-no`}>{tc("rowNumber")}
            <input id={`${uid}-no`} className="sizing-new-input mono-num ml-1" style={{ width: "4.5rem" }} inputMode="numeric" placeholder={String(nextTrancheNo(tranches))} value={form.trancheNo} onChange={(e) => setForm({ ...form, trancheNo: e.target.value })} />
          </label>
          <label htmlFor={`${uid}-amt`}>{t("amountRequired")}
            <input id={`${uid}-amt`} className="sizing-new-input mono-num ml-1" style={{ width: "9rem" }} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label htmlFor={`${uid}-cur`}>{tc("currency")}
            <input id={`${uid}-cur`} className="sizing-new-input ml-1" style={{ width: "4.5rem" }} maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          </label>
          <label htmlFor={`${uid}-cond`}>{t("executionConditionRequired")}
            <input id={`${uid}-cond`} className="sizing-new-input ml-1" style={{ minWidth: "18rem" }} placeholder={t("eGPermitObtainedAnd")} value={form.releaseCondition} onChange={(e) => setForm({ ...form, releaseCondition: e.target.value })} />
          </label>
          <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? tc("recording") : t("addExecutionStage2")}</button>
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
}) {const t = useTranslations("stages.s10.capexTranche"); const tc = useTranslations("common");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [v, setV] = useState({ amount: String(dlg.t.amount), currency: dlg.t.currency, releaseCondition: dlg.t.release_condition, reason: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const edit = dlg.kind === "edit";
  const title = edit
    ? t("editExecutionStageP1", { p1: dlg.t.tranche_no })
    : dlg.kind === "retire"
      ? t("discardExecutionStageP1", { p1: dlg.t.tranche_no })
      : t("executionStageP1P2", { p1: dlg.t.tranche_no, p2: dlg.next === "released" ? (dlg.t.pending_release ? t("executionApproval") : t("requestExecution")) : dlg.next === "withheld" ? t("recordAsHold") : t("revertedTo") });

  function submit() {
    const p = edit
      ? validateTrancheForm({ trancheNo: String(dlg.t.tranche_no), amount: v.amount, currency: v.currency, releaseCondition: v.releaseCondition })
      : v.reason.trim() ? null : t("enterAReasonEitherEvidence");
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
              ? t("anotherPersonRequestedExecutionApproving")
              : t("executionNeedsTwoPeopleRecording")} {/* INTERIM-WORDING */}
          </p>
        )}
        {edit ? (
          <div className="flex flex-col gap-2 text-[length:var(--fs-caption)]">
            <label htmlFor="tranche-amt">{t("amountRequired2")}
              <input id="tranche-amt" className="sizing-new-input mono-num w-full" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
            </label>
            <label htmlFor="tranche-cur">{tc("currency")}
              <input id="tranche-cur" className="sizing-new-input w-full" maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />
            </label>
            <label htmlFor="tranche-cond">{t("executionConditionRequired2")}
              <textarea id="tranche-cond" className="sizing-new-input w-full" rows={3} value={v.releaseCondition} onChange={(e) => setV({ ...v, releaseCondition: e.target.value })} />
            </label>
          </div>
        ) : (
          <label className="text-[length:var(--fs-caption)] block" htmlFor="tranche-reason">{t("reasonRequired")}
            <textarea id="tranche-reason" className="sizing-new-input mt-1 w-full" rows={3} required aria-required="true" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </label>
        )}
        <p role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">{problem ? `✕ ${problem}` : ""}</p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{tc("cancel")}</button>
          <button type="button" className={dlg.kind === "retire" ? "btn-danger btn-sm" : "btn-ghost btn-sm"} disabled={busy} onClick={submit}>
            {dlg.kind === "retire" ? tc("discard") : dlg.kind === "status" && dlg.next === "released" ? (dlg.t.pending_release ? t("executionApproval2") : t("recordExecutionRequest")) : tc("record")}
          </button>
        </div>
      </div>
    </div>
  );
}
