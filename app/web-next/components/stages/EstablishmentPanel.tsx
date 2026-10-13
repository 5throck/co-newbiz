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

const STEP_TITLES: Record<number, string> = {
  1: "설립준비(관할·주식구조·이사회 결의)",
  2: "법인등기·정관·사업자등록",
  3: "인허가 이전/재발급 분류",
  4: "인력이전(신 근로계약+PIIA)",
  5: "완료확인(IP양도체인·거버넌스 베이스라인)",
};

const MODE_NEW_ENTITY_TITLES = STEP_TITLES;

// P5: 상태는 색+아이콘+텍스트의 조합 — 색 단독으로 상태를 전달하지 않는다.
const STEP_STATUS_META: Record<string, { icon: string; cls: string }> = {
  pending: { icon: "○", cls: "status-not-started" },
  in_progress: { icon: "◐", cls: "status-amber" },
  done: { icon: "●", cls: "status-green" },
  halted: { icon: "✕", cls: "status-red" },
  escalated: { icon: "▲", cls: "status-amber" },
};
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
}) {
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
  const titleOf = (n: number) => est?.step_titles?.[String(n)] ?? MODE_NEW_ENTITY_TITLES[n];
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
    confirm(`설립 실행 ${n}단계 상태 변경`, () => {
      void run(async () => {
        await api.put(base, buildStatusBody(n, form, origin ?? "internal"));
        toast(`설립 실행 ${n}단계 상태를 ${labelOf(form.status)}(으)로 기록했습니다.`);
      }, "설립 실행 기록 실패");
    }, {
      body: "설립 실행 단계 상태를 기록합니다. 기록하는 사람이 최근 기록자로 남으며, 완료 처리는 사람만 할 수 있습니다. 담당자는 바뀌지 않습니다.",
      confirmLabel: "기록",
      tone: "neutral",
    });
  }

  function saveAssignee(n: number) {
    const target = members.find((m) => m.user_id === assignee);
    confirm(`설립 실행 ${n}단계 담당자 지정`, () => {
      void run(async () => {
        await api.put(`${base}/assignee`, { step_no: n, assignee_user_id: assignee || null, origin: origin ?? undefined });
        toast(target ? `${n}단계 담당자를 ${target.name}(으)로 지정했습니다.` : `${n}단계 담당자를 해제했습니다.`);
      }, "담당자 지정 실패");
    }, {
      body: target ? `${target.name}을(를) 이 단계의 책임자로 지정합니다.` : "이 단계의 담당자를 미지정으로 되돌립니다.",
      confirmLabel: "지정",
      tone: "neutral",
    });
  }

  async function postReopen(n: number, cascade: boolean) {
    await api.post(`${base}/reopen`, { step_no: n, reason: reason.trim(), ...(cascade ? { cascade_step5: true } : {}) });
    toast(`설립 실행 ${n}단계를 재개했습니다${cascade ? " (완료확인 5단계 포함)" : ""}.`);
  }

  function saveReopen(n: number) {
    const problem = validateReopenReason(reason);
    if (problem) { setError(problem); return; }
    confirm(`설립 실행 ${n}단계 완료 취소(재개)`, () => {
      void run(async () => {
        try {
          await postReopen(n, false);
        } catch (e) {
          if (e instanceof ApiError && e.code === "dependent_step_done") {
            // Second, explicit confirmation before cascading into step 5.
            confirm(CASCADE_CONFIRM_TITLE, () => { void run(() => postReopen(n, true), "재개 실패"); }, {
              body: "완료확인(5단계)이 완료 상태여서 함께 재개하지 않으면 이 단계를 재개할 수 없습니다.",
              confirmLabel: "함께 재개",
              tone: "danger",
            });
            throw new Error("");
          }
          throw e;
        }
      }, "재개 실패");
    }, {
      body: `사유: ${reason.trim()} — 재개하면 단계가 진행 중으로 돌아가고 기존 증적은 이력에만 남습니다. 투자심의위원회 승인 기록은 바뀌지 않습니다.`,
      confirmLabel: "재개",
      tone: "danger",
    });
  }

  if (est && applies && mode === null) {
    return (
      <section className="market-section sizing-step mt-3" aria-label="설립 실행 5단계">
        <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">🏗</span> 설립 실행 — 5단계</h3>
        <p role="note" className="status-chip status-amber" style={{ whiteSpace: "normal" }}>ⓘ {MODE_NOT_CHOSEN_NOTICE}</p>
        <p className="text-[length:var(--fs-caption)] mt-2">
          <Link href={`/projects/${encodeURIComponent(projectId)}/deal-structure`} className="underline">S10 투자구조 설계에서 설립 방식 정하기 →</Link>
        </p>
        <HistoryBlock steps={historySteps} titles={est.all_step_titles} />
      </section>
    );
  }

  if (est && !applies) {
    return (
      <section className="market-section sizing-step mt-3" aria-label="설립 실행 5단계">
        <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">🏗</span> 설립 실행 — 5단계</h3>
        <p role="note" className="status-chip status-not-started" style={{ whiteSpace: "normal" }}>ⓘ {notApplicableNote(origin)}</p>
      </section>
    );
  }

  return (
    <section className="market-section sizing-step mt-3" aria-label="설립 실행 5단계">
      <h3 className="sizing-step-title text-[0.95rem]">
        <span className="sizing-step-badge">🏗</span> {s11Title(mode)}
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
        {S11_INTRO[mode ?? "new_entity"]}
      </p>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{ESTABLISHMENT_CAPTION}</p>
      {warning && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg,var(--accent))] mb-2">⚠ {reopenWarningText(warning)}</p>}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-48" aria-label="설립 실행 단계 현황">
          <caption className="sr-only">설립 실행 5단계 진행 현황</caption>
          <ColGroup widths={estStepColPct(colCount)} />
          <thead>
            <tr>
              <th scope="col">단계</th><th scope="col">상태</th><th scope="col">담당자</th><th scope="col">최근 기록</th><th scope="col">갱신</th>
              {writable && <th scope="col">작업</th>}
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
                { key: "assign", label: "담당자 지정", onSelect: () => openFor(n, "assign"), disabled: busy },
              ];
              return (
                <Fragment key={n}>
                  <tr>
                    <td>
                      <span className="tabular-nums mr-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{n}</span>{titleOf(n)}
                      {events.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">이력 보기 ({events.length}건)</summary>
                          <ul className="sizing-note-list" aria-label={`${n}단계 이력`}>
                            {events.map((e) => (
                              <li key={e.id} className="text-[length:var(--fs-caption)]">
                                <span className="tabular-nums">{e.created_at.slice(0, 16).replace("T", " ")}</span> · {e.actor_name ?? e.actor_user_id} · {eventSummary(e)}
                                {e.reason && <span className="block text-[color:var(--muted-fg)]">사유: {e.reason}</span>}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td>
                      <span className={`status-chip ${meta.cls}`}>{meta.icon} {labelOf(row?.status)}</span>
                      {(row?.reopen_count ?? 0) > 0 && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">재개 {row!.reopen_count}회</span>}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {who.name}
                      {who.inactive && <span className="block text-[color:var(--muted-fg)]">(구성원 아님)</span>}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {row?.last_recorded_by ?? row?.owner ?? "—"}
                      {row?.evidence_url && (
                        <span className="block text-[color:var(--muted-fg)]">
                          증적: {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{row.evidence_url}</a> : row.evidence_url}
                        </span>
                      )}
                    </td>
                    <td className="text-[length:var(--fs-caption)] tabular-nums">{row?.updated_at?.slice(0, 10) ?? "—"}</td>
                    {writable && (
                      <td>
                        <div className="flex items-center gap-1">
                          {isDone ? (
                            <>
                              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">완료됨</span>
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                disabled={busy}
                                aria-expanded={open?.step === n && open.kind === "reopen"}
                                aria-controls={`est-step-${n}`}
                                onClick={() => openFor(n, "reopen")}
                              >
                                완료 취소(재개)
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
                              {open?.step === n && open.kind === "status" ? "닫기" : "상태 변경"}
                            </button>
                          )}
                          <RowMenu label={`${n}단계 더보기 (담당자 지정)`} items={menu} />
                        </div>
                      </td>
                    )}
                  </tr>
                  {open?.step === n && writable && (
                    <tr id={`est-step-${n}`}>
                      <td colSpan={colCount}>
                        {open.kind === "status" && (
                          <form className="sizing-new-form" aria-label={`설립 실행 ${n}단계 상태 변경`} onSubmit={(e) => { e.preventDefault(); saveStatus(n); }}>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="text-[length:var(--fs-caption)]">
                                <span className="block mb-1">상태</span>
                                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                                  {CHANGEABLE_STATUSES.map((k) => <option key={k} value={k}>{metaOf(k).icon} {labelOf(k)}</option>)}
                                </select>
                              </label>
                              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]">
                                <span className="block mb-1">증적 URL (완료 선택 시 URL 또는 비고 필수)</span>
                                <input value={form.evidence_url} aria-required={evidenceRequired(form.status)} onChange={(e) => setForm({ ...form, evidence_url: e.target.value })} className="sizing-new-input w-full" placeholder="data room 링크" />
                              </label>
                              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]">
                                <span className="block mb-1">비고</span>
                                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sizing-new-input w-full" />
                              </label>
                              <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? "기록 중..." : "상태 저장"}</button>
                            </div>
                          </form>
                        )}
                        {open.kind === "assign" && (
                          <form className="sizing-new-form" aria-label={`설립 실행 ${n}단계 담당자 지정`} onSubmit={(e) => { e.preventDefault(); saveAssignee(n); }}>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="text-[length:var(--fs-caption)] min-w-[14rem]">
                                <span className="block mb-1">담당자</span>
                                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="sizing-new-input w-full">
                                  <option value="">미지정</option>
                                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name} · {m.project_role}</option>)}
                                </select>
                              </label>
                              <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? "저장 중..." : "담당자 저장"}</button>
                            </div>
                          </form>
                        )}
                        {open.kind === "reopen" && (
                          <form className="sizing-new-form" aria-label={`설립 실행 ${n}단계 완료 취소`} onSubmit={(e) => { e.preventDefault(); saveReopen(n); }}>
                            <label className="block text-[length:var(--fs-caption)]">
                              <span className="block mb-1">재개 사유 (필수, 10자 이상)</span>
                              <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="sizing-new-input w-full" rows={2} aria-required="true" />
                            </label>
                            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                              재개하면 단계가 진행 중으로 돌아가고 기존 증적은 이력에만 남습니다. 완료 처리는 다시 증적과 함께 기록해야 합니다.
                            </p>
                            <button type="submit" className="btn-danger btn-sm mt-2" disabled={busy}>{busy ? "처리 중..." : "재개 (확인 필요)"}</button>
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
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">모든 단계가 완료되었습니다. 상태를 바꾸려면 먼저 '완료 취소(재개)'로 되돌리세요.</p>
      )}
      <HistoryBlock steps={historySteps} titles={est?.all_step_titles} />
      {confirmDialog}
    </section>
  );
}

/** Rows recorded under a previous establishment mode: read-only history (ADR-0167), collapsed by default. */
function HistoryBlock({ steps, titles }: { steps: HistoryStepView[]; titles?: Record<string, Record<string, string>> }) {
  if (steps.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">이전 설립 방식의 단계 기록 — 읽기 전용 ({steps.length}건)</summary>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">설립 방식을 바꾸기 전에 기록한 단계입니다. 수정할 수 없고 이력으로만 남습니다.</p>
      <ul className="sizing-note-list" aria-label="이전 설립 방식의 단계 기록">
        {steps.map((r) => (
          <li key={r.id} className="text-[length:var(--fs-caption)]">
            <strong>{modeLabel(r.mode)}</strong> · {r.step_no}단계 {titleFor(titles, r.mode, r.step_no)} · {metaOf(r.status).icon} {labelOf(r.status)}
            <span className="tabular-nums"> · {r.updated_at.slice(0, 10)}</span>
            {r.last_recorded_by && <> · {r.last_recorded_by}</>}
            {r.evidence_url && <span className="block text-[color:var(--muted-fg)]">증적: {r.evidence_url}</span>}
            {r.note && <span className="block text-[color:var(--muted-fg)]">비고: {r.note}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
