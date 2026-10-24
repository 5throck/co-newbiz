"use client";

// S11 설립 실행 — 5단계 (ADR-0165). 담당자 지정, 상태 변경, 완료 취소(재개), 이력.
// 경계 #2: 완료·재개·담당자 지정은 사람의 행위이며 모든 변경은 P4 확인을 거친다.
// 규칙(증적 필수·재개 선행·구성원 검증)의 권위는 서버이고, 이 화면은 일찍 거절하고 메시지를 옮길 뿐이다.

import Link from "next/link";
import { Fragment, useState } from "react";
import { api, ApiError } from "../../lib/api.ts";
import { ColGroup, useToast } from "../ui.tsx";
import { RowMenu, useConfirm } from "../crud.tsx";
import { estStepColPct } from "./constants.ts";
import { useTranslations } from "next-intl";
import {
  isModeValue, MODE_NOT_CHOSEN_NOTICE, modeLabel, S11_INTRO, s11Title, titleFor, visibleHistorySteps,
  type HistoryStepView,
} from "../../lib/establishment-mode-view.ts";
import {
  assigneeView, buildStatusBody, CASCADE_CONFIRM_TITLE, CHANGEABLE_STATUSES, defaultFormStatus, establishmentApplies,
  establishmentErrorText, ESTABLISHMENT_CAPTION, eventSummary, evidenceRequired, notApplicableNote, reopenWarning,
  reopenWarningText, safeEvidenceHref, STATUS_LABEL, validateReopenReason, validateStatusForm,
  type EventView, type MemberView, type ReopenedAfterGateSrc, type StepRowView,
} from "../../lib/establishment-view.ts";

const STEP_TITLES: Record<number, string> = ({
  1: "stages.s11.establishment.establishmentPreparationJurisdictionShareStructure",
  2: "stages.s11.establishment.corporateRegistrationArticlesOfIncorporation",
  3: "stages.s11.establishment.permitTransferReissuanceClassification",
  4: "stages.s11.establishment.personnelTransferNewEmploymentContracts",
  5: "stages.s11.establishment.completionCheckIpTransferChain",
});

const MODE_NEW_ENTITY_TITLES = STEP_TITLES;

// P5: 상태는 색+아이콘+텍스트의 조합 — 색 단독으로 상태를 전달하지 않는다.
const STEP_STATUS_META: Record<string, { icon: string; cls: string }> = ({
  pending: { icon: "○", cls: "status-not-started" },
  in_progress: { icon: "◐", cls: "status-amber" },
  done: { icon: "●", cls: "status-green" },
  halted: { icon: "✕", cls: "status-red" },
  escalated: { icon: "▲", cls: "status-amber" },
});
const metaOf = (status: string | undefined) => STEP_STATUS_META[status ?? "pending"] ?? STEP_STATUS_META.pending;
const labelOf = (status: string | undefined) => STATUS_LABEL[status ?? "pending"] ?? status ?? "unknown";

export interface EstablishmentData {
  project: { origin: string | null };
  /** ADR-0167: active mode (null = a Green Field project that has not chosen one). */
  mode?: string | null;
  step_titles?: Record<string, string> | null;
  all_step_titles?: Record<string, Record<string, string>>;
  history_steps?: HistoryStepView[];
  steps: StepRowView[];
  members?: MemberView[];
  history?: EventView[];
  reopened_after_gate?: boolean;
  reopened_after_gate_detail?: ReopenedAfterGateSrc["reopened_after_gate_detail"];
}

type OpenForm = { step: number; kind: "status" | "assign" | "reopen" } | null;

export function EstablishmentPanel({ projectId, canAct, est, fallbackSteps, fallbackReopen, onChanged }: {
  projectId: string;
  canAct: boolean;
  est: EstablishmentData | null;
  fallbackSteps: StepRowView[];
  /** Server flag from the IC package, used until/unless the establishment read loads. */
  fallbackReopen?: ReopenedAfterGateSrc;
  onChanged: () => Promise<unknown>;
}) {const tr = useTranslations(); const t = useTranslations("stages.s11.establishment"); const tc = useTranslations("common");
  const { confirm, confirmDialog } = useConfirm();
  const { toast } = useToast();
  const [open, setOpen] = useState<OpenForm>(null);
  const [form, setForm] = useState({ status: "in_progress", evidence_url: "", note: "" });
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = est?.project.origin ?? null;
  const applies = establishmentApplies(origin);
  const writable = canAct && applies;
  const members = est?.members ?? [];
  const history = est?.history ?? [];
  const base = `/api/projects/${encodeURIComponent(projectId)}/establishment`;
  const colCount = writable ? 6 : 5;
  const warning = reopenWarning(est ?? fallbackReopen);
  const mode = est ? (isModeValue(est.mode) ? est.mode : null) : "new_entity";
  const titleOf = (n: number) => est?.step_titles?.[String(n)] ?? tr(MODE_NEW_ENTITY_TITLES[n]);
  const historySteps = visibleHistorySteps(est?.history_steps);

  const rowOf = (n: number): StepRowView | undefined => est?.steps.find((s) => s.step_no === n) ?? fallbackSteps.find((s) => s.step_no === n);

  function openFor(n: number, kind: "status" | "assign" | "reopen") {
    const row = rowOf(n);
    setError(null);
    if (open?.step === n && open.kind === kind) { setOpen(null); return; }
    setOpen({ step: n, kind });
    if (kind === "status") setForm({ status: defaultFormStatus(row?.status), evidence_url: "", note: "" });
    if (kind === "assign") setAssignee(row?.assignee_user_id ?? "");
    if (kind === "reopen") setReason("");
  }

  async function run(fn: () => Promise<void>, failText: string) {
    setBusy(true); setError(null);
    try {
      await fn();
      await onChanged();
      setOpen(null);
    } catch (e) {
      setError(e instanceof ApiError ? establishmentErrorText(e.code, e.message) : e instanceof Error ? e.message : failText);
    } finally {
      setBusy(false);
    }
  }

  function saveStatus(n: number) {
    const problem = validateStatusForm(form);
    if (problem) { setError(problem); return; }
    confirm(t("changeEstablishmentExecutionStepP1", { p1: n }), () => {
      void run(async () => {
        await api.put(base, buildStatusBody(n, form, origin ?? "internal"));
        toast(t("recordedEstablishmentExecutionStepP1", { p1: n, p2: labelOf(form.status) }));
      }, t("failedToRecordEstablishmentExecution"));
    }, {
      body: t("recordsTheEstablishmentExecutionStep"),
      confirmLabel: tc("record"),
      tone: "neutral",
    });
  }

  function saveAssignee(n: number) {
    const target = members.find((m) => m.user_id === assignee);
    confirm(t("assignOwnerToEstablishmentExecution", { p1: n }), () => {
      void run(async () => {
        await api.put(`${base}/assignee`, { step_no: n, assignee_user_id: assignee || null, origin: origin ?? undefined });
        toast(target ? t("assignedStepP1OwnerTo", { p1: n, p2: target.name }) : t("unassignedTheStepP1Owner", { p1: n }));
      }, t("failedToAssignTheOwner"));
    }, {
      body: target ? t("assignsP1AsThisStep", { p1: target.name }) : t("revertsThisStepSOwner"),
      confirmLabel: t("assigned"),
      tone: "neutral",
    });
  }

  async function postReopen(n: number, cascade: boolean) {
    await api.post(`${base}/reopen`, { step_no: n, reason: reason.trim(), ...(cascade ? { cascade_step5: true } : {}) });
    toast(t("resumedEstablishmentExecutionStepP1", { p1: n, p2: cascade ? t("includingTheFiveSteps") : "" }));
  }

  function saveReopen(n: number) {
    const problem = validateReopenReason(reason);
    if (problem) { setError(problem); return; }
    confirm(t("undoEstablishmentExecutionStepP1", { p1: n }), () => {
      void run(async () => {
        try {
          await postReopen(n, false);
        } catch (e) {
          if (e instanceof ApiError && e.code === "dependent_step_done") {
            // Second, explicit confirmation before cascading into step 5.
            confirm(CASCADE_CONFIRM_TITLE, () => { void run(() => postReopen(n, true), t("resumeFailed")); }, {
              body: t("thisStepCannotResumeUnless"),
              confirmLabel: t("resumeTogether"),
              tone: "danger",
            });
            throw new Error("");
          }
          throw e;
        }
      }, t("resumeFailed2"));
    }, {
      body: t("reasonP1ResumingReturnsThe", { p1: reason.trim() }),
      confirmLabel: t("resume"),
      tone: "danger",
    });
  }

  if (est && applies && mode === null) {
    return (
      <section className="market-section sizing-step mt-3" aria-label={tc("establishmentFiveSteps")}>
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">🏗</span> {t("establishmentExecutionFiveSteps")}</h3>
        <p role="note" className="status-chip status-amber" style={{ whiteSpace: "normal" }}>ⓘ {MODE_NOT_CHOSEN_NOTICE}</p>
        <p className="text-[length:var(--fs-caption)] mt-2">
          <Link href={`/projects/${encodeURIComponent(projectId)}/deal-structure`} className="underline">{t("chooseTheEstablishmentTypeIn")}</Link>
        </p>
        <HistoryBlock steps={historySteps} titles={est.all_step_titles} />
      </section>
    );
  }

  if (est && !applies) {
    return (
      <section className="market-section sizing-step mt-3" aria-label={tc("establishmentFiveSteps")}>
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">🏗</span> {t("establishmentExecutionFiveSteps2")}</h3>
        <p role="note" className="status-chip status-not-started" style={{ whiteSpace: "normal" }}>ⓘ {notApplicableNote(origin)}</p>
      </section>
    );
  }

  return (
    <section className="market-section sizing-step mt-3" aria-label={tc("establishmentFiveSteps")}>
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">
        <span className="sizing-step-badge" aria-hidden="true">🏗</span> {s11Title(mode)}
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
        {S11_INTRO[mode ?? "new_entity"]}
      </p>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{ESTABLISHMENT_CAPTION}</p>
      {warning && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg,var(--accent))] mb-2">⚠ {reopenWarningText(warning)}</p>}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-48" aria-label={t("establishmentExecutionStepStatus")}>
          <caption className="sr-only">{t("establishmentExecutionProgress")}</caption>
          <ColGroup widths={estStepColPct(colCount)} />
          <thead>
            <tr>
              <th scope="col">{tc("stage")}</th><th scope="col">{tc("status")}</th><th scope="col">{t("owner")}</th><th scope="col">{t("latestRecord")}</th><th scope="col">{t("refresh")}</th>
              {writable && <th scope="col">{tc("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((n) => {
              const row = rowOf(n);
              const meta = metaOf(row?.status);
              const isDone = row?.status === "done";
              const who = assigneeView(row);
              const href = safeEvidenceHref(row?.evidence_url);
              const events = history.filter((h) => h.step_no === n);
              const menu = [
                { key: "assign", label: t("assignOwner"), onSelect: () => openFor(n, "assign"), disabled: busy },
              ];
              return (
                <Fragment key={n}>
                  <tr>
                    <td>
                      <span className="tabular-nums mr-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{n}</span>{titleOf(n)}
                      {events.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("viewHistory")}{events.length}{tc("countSuffixParen")}</summary>
                          <ul className="sizing-note-list" aria-label={t("stepP1History", { p1: n })}>
                            {events.map((e) => (
                              <li key={e.id} className="text-[length:var(--fs-caption)]">
                                <span className="tabular-nums">{e.created_at.slice(0, 16).replace("T", " ")}</span> · {e.actor_name ?? e.actor_user_id} · {eventSummary(e)}
                                {e.reason && <span className="block text-[color:var(--muted-fg)]">{tc("reasonColon")} {e.reason}</span>}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td>
                      <span className={`status-chip ${meta.cls}`}>{meta.icon} {labelOf(row?.status)}</span>
                      {(row?.reopen_count ?? 0) > 0 && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("resume2")} {row!.reopen_count}{tc("timesUnit")}</span>}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {who.name}
                      {who.inactive && <span className="block text-[color:var(--muted-fg)]">{t("notAMember")}</span>}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {row?.last_recorded_by ?? row?.owner ?? "—"}
                      {row?.evidence_url && (
                        <span className="block text-[color:var(--muted-fg)]">
                          {tc("proofColon")} {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{row.evidence_url}</a> : row.evidence_url}
                        </span>
                      )}
                    </td>
                    <td className="text-[length:var(--fs-caption)] tabular-nums">{row?.updated_at?.slice(0, 10) ?? "—"}</td>
                    {writable && (
                      <td>
                        <div className="flex items-center gap-1">
                          {isDone ? (
                            <>
                              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("completed")}</span>
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                disabled={busy}
                                aria-expanded={open?.step === n && open.kind === "reopen"}
                                aria-controls={`est-step-${n}`}
                                onClick={() => openFor(n, "reopen")}
                              >
                                {t("undoCompletionResume")}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              disabled={busy}
                              aria-busy={busy}
                              aria-expanded={open?.step === n && open.kind === "status"}
                              aria-controls={`est-step-${n}`}
                              onClick={() => openFor(n, "status")}
                            >
                              {open?.step === n && open.kind === "status" ? tc("close") : t("changeStatus")}
                            </button>
                          )}
                          <RowMenu label={t("stepP1MoreAssignOwner", { p1: n })} items={menu} />
                        </div>
                      </td>
                    )}
                  </tr>
                  {open?.step === n && writable && (
                    <tr id={`est-step-${n}`}>
                      <td colSpan={colCount}>
                        {open.kind === "status" && (
                          <form className="sizing-new-form" aria-label={t("changeEstablishmentExecutionStepP12", { p1: n })} onSubmit={(e) => { e.preventDefault(); saveStatus(n); }}>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="text-[length:var(--fs-caption)]">
                                <span className="block mb-1">{tc("status")}</span>
                                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                                  {CHANGEABLE_STATUSES.map((k) => <option key={k} value={k}>{metaOf(k).icon} {labelOf(k)}</option>)}
                                </select>
                              </label>
                              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]">
                                <span className="block mb-1">{t("evidenceUrlUrlOrNotes")}</span>
                                <input value={form.evidence_url} aria-required={evidenceRequired(form.status)} onChange={(e) => setForm({ ...form, evidence_url: e.target.value })} className="sizing-new-input w-full" placeholder={t("dataRoomLink")} />
                              </label>
                              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]">
                                <span className="block mb-1">{tc("notes")}</span>
                                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sizing-new-input w-full" />
                              </label>
                              <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? tc("recording") : t("saveStatus")}</button>
                            </div>
                          </form>
                        )}
                        {open.kind === "assign" && (
                          <form className="sizing-new-form" aria-label={t("assignOwnerToEstablishmentExecution2", { p1: n })} onSubmit={(e) => { e.preventDefault(); saveAssignee(n); }}>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="text-[length:var(--fs-caption)] min-w-[14rem]">
                                <span className="block mb-1">{t("owner2")}</span>
                                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="sizing-new-input w-full">
                                  <option value="">{t("unspecified")}</option>
                                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name} · {m.project_role}</option>)}
                                </select>
                              </label>
                              <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? tc("saving") : t("saveOwner")}</button>
                            </div>
                          </form>
                        )}
                        {open.kind === "reopen" && (
                          <form className="sizing-new-form" aria-label={t("undoEstablishmentExecutionStepP12", { p1: n })} onSubmit={(e) => { e.preventDefault(); saveReopen(n); }}>
                            <label className="block text-[length:var(--fs-caption)]">
                              <span className="block mb-1">{t("resumeReasonRequired10Chars")}</span>
                              <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="sizing-new-input w-full" rows={2} aria-required="true" />
                            </label>
                            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                              {t("resumingReturnsTheStepTo")}
                            </p>
                            <button type="submit" className="btn-danger btn-sm mt-2" disabled={busy}>{busy ? t("processing") : t("resumeConfirmationNeeded")}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {writable && [1, 2, 3, 4, 5].every((n) => rowOf(n)?.status === "done") && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">{t("allStepsAreCompleteTo")}</p>
      )}
      <HistoryBlock steps={historySteps} titles={est?.all_step_titles} />
      {confirmDialog}
    </section>
  );
}

/** Rows recorded under a previous establishment mode: read-only history (ADR-0167), collapsed by default. */
function HistoryBlock({ steps, titles }: { steps: HistoryStepView[]; titles?: Record<string, Record<string, string>> }) {const t = useTranslations("stages.s11.establishment"); const tc = useTranslations("common");
  if (steps.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("stepRecordsFromThePrevious")}{steps.length}{tc("countSuffixParen")}</summary>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{t("stepsRecordedBeforeTheEstablishment")}</p>
      <ul className="sizing-note-list" aria-label={t("stepRecordsFromThePrevious2")}>
        {steps.map((r) => (
          <li key={r.id} className="text-[length:var(--fs-caption)]">
            <strong>{modeLabel(r.mode)}</strong> · {r.step_no}{tc("stage")} {titleFor(titles, r.mode, r.step_no)} · {metaOf(r.status).icon} {labelOf(r.status)}
            <span className="tabular-nums"> · {r.updated_at.slice(0, 10)}</span>
            {r.last_recorded_by && <> · {r.last_recorded_by}</>}
            {r.evidence_url && <span className="block text-[color:var(--muted-fg)]">{tc("proofColon")} {r.evidence_url}</span>}
            {r.note && <span className="block text-[color:var(--muted-fg)]">{t("notes")} {r.note}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
