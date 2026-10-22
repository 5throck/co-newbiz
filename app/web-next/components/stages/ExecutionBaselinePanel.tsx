"use client";

// S11 신규 사업(greenfield) 실행 기준선 패널 (ADR-0161 Row 3, procedure greenfield-execution-baseline).
// 경계 #2: 기준선 기록과 확인은 사람의 행위다 — 에이전트는 초안만 제안한다. 이 패널은 설비투자 트랜치를
// 읽기만 한다(집행은 S10 설비투자 집행 단계 탭의 두 사람 절차). 트랜치 합계는 S8 채택 케이스 설비투자와
// 정확히 일치할 때만 일치로 표시하고, 차이는 항상 '확인 필요' 항목이다 (자동 통과 없음).
// 이 화면에는 이미 IC 결정 패널의 주요 행동(primary)이 있으므로 확인 버튼은 ghost 로 둔다 (화면당 primary 1개).
// 확정은 프로젝트 리드만 할 수 있다(서버 403 lead_required) — 리드가 아니면 확인 폼을 그리지 않는다.
// 열린 확인 필요 항목(finding)은 확인 대화상자에서 항목마다 근거(1~500자)를 적어야 확정된다.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../lib/api.ts";
import { BaselineConfirmDialog } from "./BaselineConfirmDialog.tsx";
import { useIsProjectLead } from "./useIsProjectLead.ts";
import { ColGroup } from "../ui.tsx";
import { useConfirm } from "../crud.tsx";
import { TRANCHE_STATUS_LABEL } from "../../lib/labels.ts";
import {
  EMPTY_ENTRIES,
  ENTRY_KINDS,
  ENTRY_SPECS,
  EXCLUDED_TRANCHE_TEXT,
  LEAD_ONLY_TEXT,
  MAX_RATIONALE_LEN,
  NEEDS_CLASSIFICATION_NOTE,
  acknowledgeableFindings,
  baselineErrorText,
  buildEntry,
  canAddEntry,
  canConfirm,
  confirmErrorText,
  confirmationView,
  cumulativeHeadcounts,
  emptyValues,
  entriesClearConfirmation,
  findingText,
  fmtNumber,
  fmtMoney,
  isExcludedTranche,
  missingSectionViews,
  permitStepNote,
  reconciliationVerdict,
  requirementView,
  rowCells,
  sourceOptionLabel,
  valuesOf,
  withEntry,
  type BaselineEntries,
  type AcknowledgedFinding,
  type BaselineRecord,
  type EntryKind,
  type EntryValues,
  type ExecutionBaselineStatus,
  type Finding,
  type HiringRow,
} from "../../lib/execution-baseline-view.ts";

/** Column shares (%): four data columns, [row actions]. */
const ENTRY_COL_PCT_ACT = [30, 20, 14, 24, 12] as const;
const ENTRY_COL_PCT_READONLY = [34, 22, 16, 28] as const;
/** Column shares (%): no, amount, currency, release condition, status. */
const TRANCHE_RECON_COL_PCT = [8, 18, 10, 44, 20] as const;

interface SourceOption { value: string; label: string }

function EntrySection({ kind, entries, canAct, busy, sourceOptions, onSave, onRemove }: {
  kind: EntryKind;
  entries: BaselineEntries;
  canAct: boolean;
  busy: boolean;
  sourceOptions: SourceOption[];
  onSave: (next: BaselineEntries) => Promise<boolean>;
  onRemove: (kind: EntryKind, index: number) => void;
}) {
  const spec = ENTRY_SPECS[kind];
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [values, setValues] = useState<EntryValues>(() => emptyValues(kind));
  const [formError, setFormError] = useState<string | null>(null);
  const rows = entries[kind] as object[];
  const cumulative = kind === "hiring_plan" ? cumulativeHeadcounts(entries.hiring_plan as HiringRow[]) : [];
  const labelOf = (id: string | null) => (id ? sourceOptions.find((o) => o.value === id)?.label ?? id : null);

  useEffect(() => {
    if (editing !== null) formRef.current?.querySelector<HTMLElement>("input, select")?.focus();
  }, [editing]);

  async function submit() {
    const built = buildEntry(kind, values);
    setFormError(built.ok ? null : built.message);
    if (!built.ok) return;
    if (editing === null && !canAddEntry(entries, kind)) { setFormError("항목은 100개까지만 기록할 수 있습니다."); return; }
    const saved = await onSave(withEntry(entries, kind, editing, built.value));
    if (saved) { setValues(emptyValues(kind)); setEditing(null); }
  }

  return (
    <div className="mt-3" id={`gx-${kind}`} tabIndex={-1} data-testid={`gx-${kind}`}>
      <h4 className="text-[length:var(--fs-body)] mb-1">{spec.title} ({rows.length}건)</h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{spec.description}</p>
      <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-48" aria-label={spec.title}>
          <caption className="sr-only">{spec.title} 목록</caption>
          <ColGroup widths={canAct ? ENTRY_COL_PCT_ACT : ENTRY_COL_PCT_READONLY} />
          <thead>
            <tr>
              <th scope="col">{spec.headers[0]}</th><th scope="col">{spec.headers[1]}</th>
              <th scope="col">{spec.headers[2]}</th><th scope="col">{spec.headers[3]}</th>
              {canAct && <th scope="col">관리</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={canAct ? 5 : 4} className="text-[color:var(--muted-fg)]">아직 기록한 항목이 없습니다.</td></tr>
            )}
            {rows.map((row, i) => {
              const cells = rowCells(kind, row, { cumulativeHeadcount: cumulative[i], sourceLabel: labelOf });
              return (
                <tr key={`${kind}-${i}`}>
                  {cells.map((c, j) => <td key={j} className={j === 2 && kind !== "permit_milestones" && kind !== "certification_milestones" ? "tabular-nums" : undefined}>{c}</td>)}
                  {canAct && (
                    <td>
                      <span className="flex gap-1">
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={`${spec.title} ${i + 1}번째 수정`}
                          onClick={() => { setEditing(i); setValues(valuesOf(kind, row)); setFormError(null); }}>수정</button>
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={`${spec.title} ${i + 1}번째 삭제`}
                          onClick={() => onRemove(kind, i)}>삭제</button>
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canAct && (
        <form
          ref={formRef}
          className="sizing-new-form mt-2"
          aria-label={editing === null ? spec.addLabel : `${spec.title} ${editing + 1}번째 수정`}
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div className="flex flex-wrap items-end gap-2">
            {spec.fields.map((f) => (
              <label key={f.key} className="text-[length:var(--fs-caption)] min-w-[9rem] flex-1" htmlFor={`${uid}-${f.key}`}>
                <span className="block mb-1">{f.label}{f.required ? " (필수)" : ""}</span>
                {f.kind === "select" ? (
                  <select id={`${uid}-${f.key}`} className="sizing-new-input w-full" value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    <option value="">선택 안 함</option>
                    {sourceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    id={`${uid}-${f.key}`}
                    className="sizing-new-input w-full"
                    type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                    step={f.kind === "number" ? "any" : undefined}
                    value={values[f.key] ?? ""}
                    maxLength={f.max}
                    placeholder={f.placeholder}
                    aria-required={f.required}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                )}
              </label>
            ))}
          </div>
          {formError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {formError}</p>}
          <div className="flex gap-2 mt-2">
            <button type="submit" className="btn-ghost btn-sm" disabled={busy}>
              {busy ? "기록 중..." : editing === null ? spec.addLabel : "수정 저장"}
            </button>
            {editing !== null && (
              <button type="button" className="btn-ghost btn-sm" disabled={busy}
                onClick={() => { setEditing(null); setValues(emptyValues(kind)); setFormError(null); }}>수정 취소</button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

export function ExecutionBaselinePanel({ projectId, canAct }: { projectId: string; canAct: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [status, setStatus] = useState<ExecutionBaselineStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 2026-10-21 decider: 실행 기준선 5개 하위 섹션을 서브탭으로 구분 (전체 보기 기본).
  const [gxTab, setGxTab] = useState<"all" | "tranches" | "permits_certs" | "hiring_kpi" | "incentives">("all");
  const [announce, setAnnounce] = useState("");
  const [rationale, setRationale] = useState("");
  const [rationaleError, setRationaleError] = useState<string | null>(null);
  const [ackFindings, setAckFindings] = useState<Finding[] | null>(null); // non-null = confirm dialog open
  const [serverMissing, setServerMissing] = useState<string[] | null>(null); // meta.missing_sections of a 409 baseline_empty
  const [s11Complete, setS11Complete] = useState(false);
  const isLead = useIsProjectLead(projectId);
  const base = `/api/projects/${encodeURIComponent(projectId)}/execution-baseline`;

  const load = useCallback((): Promise<void> =>
    api.get<ExecutionBaselineStatus>(base)
      .then((r) => { setStatus(r.data); setLoadError(null); })
      .catch((e) => setLoadError(baselineErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : "실행 기준선을 불러오지 못했습니다."))),
  [base]);
  useEffect(() => { void load(); }, [load]);
  // reconfirm_required blocks S11 only while S11 is not complete (the GET reports the rule as if the other criteria hold).
  useEffect(() => {
    let live = true;
    api.get<{ stages?: Array<{ id: string; status: string }> }>(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => { if (live) setS11Complete(r.data?.stages?.find((st) => st.id === "S11")?.status === "complete"); })
      .catch(() => { /* unknown: assume not complete (the conservative reading) */ });
    return () => { live = false; };
  }, [projectId, status?.record?.id]);

  // 2026-10-21 decider 2차: 이 패널이 전용 탭(실행 기준선)을 지게 되어 무음(null)
  // 대신 로딩·적용 대상 아님을 명시한다 — 빈 탭처럼 보이지 않게.
  if (loadError) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-3">✕ {loadError}</p>;
  if (!status) return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3" role="status">실행 기준선을 불러오는 중…</p>;
  if (status.applicability.state === "not_applicable") {
    return (
      <section className="market-section sizing-step mt-3" aria-label="신규 사업 실행 기준선" data-testid="gx-not-applicable">
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> 신규 사업 실행 기준선</h3>
        <p className="text-[length:var(--fs-caption)] mb-0" role="note">
          <span className="status-chip status-not-started">○ 적용 대상 아님</span>
          <span className="block mt-1 text-[color:var(--muted-fg)]">
            이 프로젝트는 신규 사업(greenfield) 트랙의 실행 기준선 절차가 적용되지 않습니다. brownfield(M&A·합작·전략적 투자)는 설립 실행 탭의 PMI 킥오프가 대체 절차입니다.
          </span>
        </p>
      </section>
    );
  }

  if (status.requirement === "classification_conflict") {
    // Conflicting case_type vs route track: a human must reconcile them first; no form is offered.
    const cc = requirementView("classification_conflict");
    return (
      <section className="market-section sizing-step mt-3" aria-label="신규 사업 실행 기준선" data-testid="gx-classification-conflict">
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> 신규 사업 실행 기준선</h3>
        <div role="alert" className="text-[length:var(--fs-caption)] border border-[color:var(--amber-border,var(--primary-border))] rounded-lg px-3 py-2">
          <span className={`status-chip ${cc.cls}`}>{cc.chip}</span>
          <span className="block mt-1 font-semibold">{cc.text}</span>
          {status.warning && <span className="block mt-1 text-[color:var(--muted-fg)]">{status.warning}</span>}
          <span className="block mt-1">조치: 프로젝트의 case_type과 경로(route) 트랙을 같은 트랙으로 정리하세요. 정리되기 전에는 S11을 완료할 수 없습니다.</span>
        </div>
      </section>
    );
  }
  if (status.applicability.state === "needs_classification") {
    return (
      <section className="market-section sizing-step mt-3" aria-label="신규 사업 실행 기준선" data-testid="gx-needs-classification">
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> 신규 사업 실행 기준선</h3>
        <p className="text-[length:var(--fs-caption)]" role="note">
          <span className="status-chip status-not-started">○ 트랙 분류 필요</span>
          <span className="block mt-1 text-[color:var(--muted-fg)]">{NEEDS_CLASSIFICATION_NOTE}</span>
          {status.warning && <span className="block mt-1 text-[color:var(--muted-fg)]" data-testid="gx-warning">안내: {status.warning}</span>}
        </p>
      </section>
    );
  }

  const rec = status.reconciliation;
  const record: BaselineRecord | null = status.record;
  const entries = record?.entries ?? EMPTY_ENTRIES;
  const req = requirementView(status.requirement, !s11Complete);
  const conf = confirmationView(record, status.findings, status.confirmed_record ?? null);
  const confirmedRecord = status.confirmed_record ?? (record?.confirmation ? record : null);
  const missingKeys = serverMissing ?? status.missing_sections ?? [];
  const missingViews = missingSectionViews(missingKeys);
  const verdict = rec ? reconciliationVerdict(rec) : null;
  const srcOptions = (kind: EntryKind): SourceOption[] => {
    const s = status.sources;
    if (!s) return [];
    if (kind === "permit_milestones") return s.permits.map((p) => ({ value: p.id, label: sourceOptionLabel(p) }));
    if (kind === "certification_milestones") return s.certifications.map((c) => ({ value: c.id, label: sourceOptionLabel(c) }));
    if (kind === "incentive_obligations") return s.incentives.map((i) => ({ value: i.id, label: sourceOptionLabel(i) }));
    return [];
  };
  const permitNote = permitStepNote(status.applicability.permit_step_applies);
  const check = canConfirm(canAct, rationale, isLead);

  async function saveEntries(next: BaselineEntries): Promise<boolean> {
    if (busy) return false;
    const hadConfirmation = entriesClearConfirmation(record);
    setBusy(true); setError(null);
    try {
      await api.post(base, { action: "record_entries", entries: next });
      await load();
      setAnnounce(hadConfirmation ? "기록했습니다. 이전 확인은 해제되었고 다시 확인해야 합니다." : "기록했습니다."); // INTERIM-WORDING
      return true;
    } catch (e) {
      const msg = baselineErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : undefined);
      setError(msg);
      setAnnounce(`기록하지 못했습니다. ${msg}`); // INTERIM-WORDING
      return false;
    } finally {
      setBusy(false);
    }
  }

  function removeEntry(kind: EntryKind, index: number) {
    const label = ENTRY_SPECS[kind].title;
    confirm(`${label} 항목 삭제`, () => { void saveEntries(withEntry(entries, kind, index, null)); }, {
      body: `${label}의 ${index + 1}번째 항목을 목록에서 제거하고 기준선 기록을 새로 남깁니다.${entriesClearConfirmation(record) ? " 이전 확인은 해제됩니다." : ""}`, // INTERIM-WORDING
      confirmLabel: "삭제",
    });
  }

  /** Validate the rationale, refuse early on missing sections, then open the acknowledgement dialog. */
  function confirmBaseline() {
    const problem = canConfirm(canAct, rationale, isLead);
    setRationaleError(problem.reason);
    if (!problem.allowed) return;
    if ((status?.missing_sections ?? []).length > 0) {
      setServerMissing(status!.missing_sections!);
      setError(confirmErrorText("baseline_empty", undefined));
      return;
    }
    setError(null);
    setAckFindings(acknowledgeableFindings(status!.findings));
  }

  async function submitConfirm(acknowledged: AcknowledgedFinding[]) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { action: "confirm", rationale: rationale.trim() };
      if (acknowledged.length > 0) body.acknowledged_findings = acknowledged;
      const r = await api.post<{ open_findings: unknown[] }>(base, body);
      setAckFindings(null);
      setServerMissing(null);
      setRationale("");
      await load();
      const open = r.data?.open_findings?.length ?? 0;
      setAnnounce(open > 0 ? `확정했습니다. 확인 필요 항목 ${open}건과 확인 근거가 기록에 남았습니다.` : "확정했습니다."); // INTERIM-WORDING
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      const meta = e instanceof ApiError ? e.meta : {};
      let msg = confirmErrorText(code, e instanceof Error ? e.message : undefined);
      if (code === "findings_open") {
        // The server's open list wins: reopen the dialog with exactly those findings.
        const open = acknowledgeableFindings(((meta.open_findings as Finding[] | undefined) ?? []));
        setAckFindings(open.length > 0 ? open : null);
        msg = `${msg} (${open.length}건)`;
      } else {
        setAckFindings(null);
      }
      if (code === "baseline_empty") {
        const missing = (meta.missing_sections as string[] | undefined) ?? [];
        setServerMissing(missing);
        msg = `${msg} 비어 있는 항목: ${missingSectionViews(missing).map((m) => m.label).join(", ")}`;
      }
      if (code === "lead_required") await load();
      setError(msg);
      setAnnounce(`확정하지 못했습니다. ${msg}`); // INTERIM-WORDING
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="market-section sizing-step mt-3" aria-label="신규 사업 실행 기준선" data-testid="gx-baseline">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> 신규 사업 실행 기준선 — 트랜치 · 인허가/인증 · 인력/조직 계획 · 가동 KPI · 인센티브 의무</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S10에서 정한 투자 조건과 S8 채택 케이스를 기준으로 실행 계획을 한곳에 고정합니다. 기록과 확인은 사람이 하며, 이 패널은 설비투자 트랜치를 바꾸지 않습니다. 섹션 순서(트랜치 → 인허가/인증 → 인력/조직 계획 → 가동 KPI → 인센티브 의무)대로 위에서 아래로 기록하면 됩니다.
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {/* 상태 칩: 필수 여부(차단/권장) + 확정 여부 */}
      <p className="flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)]">
        <span className={`status-chip ${req.cls}`} title={status.requirement_label ?? undefined}>{req.chip}</span>
        <span className={`status-chip ${conf.cls}`}>{conf.chip}</span>
        {status.requirement === "reconfirm_required" && <span className="status-chip status-amber">▲ 재확정 필요</span>}
        {conf.detail && <span className="text-[color:var(--muted-fg)]">확정자·확정일 {conf.detail}{conf.recordedBy ? ` · 항목 기록자 ${conf.recordedBy}` : ""}</span>}
      </p>
      <p className="text-[length:var(--fs-caption)] mt-1">{req.text}</p>
      {status.requirement_label && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{status.requirement_label}</p>}
      {status.warning && status.requirement !== "recommended" && (
        <p className="text-[length:var(--fs-caption)] mt-1" data-testid="gx-warning"><span aria-hidden="true">▲ </span>{status.warning}</p>
      )}
      {confirmedRecord?.confirmation && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          확정 근거: {confirmedRecord.confirmation.rationale}
          {(confirmedRecord.confirmation.acknowledged_findings?.length ?? 0) > 0 && ` · 확인 필요 항목 ${confirmedRecord.confirmation.acknowledged_findings!.length}건에 근거를 남김`}
        </p>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-2">✕ {error}</p>}

      {/* 서브탭 — 2026-10-21 decider: 트랜치 / 인허가·인증 / 인력·조직 / 가동 KPI / 인센티브 의무 구분 */}
      <div role="tablist" aria-label="실행 기준선 하위 화면" className="flex flex-wrap gap-1 mb-2">
        {([
          { key: "all", label: "전체" },
          { key: "tranches", label: "집행 단계(트랜치)" },
          { key: "permits_certs", label: "인허가·인증" },
          { key: "hiring_kpi", label: "인력·조직 · 가동 KPI" },
          { key: "incentives", label: "인센티브 의무" },
        ] as Array<{ key: typeof gxTab; label: string }>).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={gxTab === t.key}
            className={`stage-tab${gxTab === t.key ? " stage-tab-active" : ""}`}
            onClick={() => setGxTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {status.findings.length > 0 && (
        <div className="mt-2" data-testid="gx-findings">
          <h4 className="text-[length:var(--fs-body)] mb-1">확인 필요 항목 ({status.findings.length}건)</h4>
          <ul className="sizing-note-list" aria-label="확인 필요 항목">
            {status.findings.map((f, i) => <li key={`${f.code}-${i}`}><span aria-hidden="true">▲ </span>{findingText(f)}</li>)}
          </ul>
        </div>
      )}

      {/* 1. 트랜치 대조 */}
      <div className="mt-3" data-testid="gx-tranches" hidden={gxTab !== "all" && gxTab !== "tranches"}>
        <h4 className="text-[length:var(--fs-body)] mb-1">설비투자 트랜치 대조 — S10 집행 조건과 S8 채택 케이스</h4>
        {rec && (
          <>
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48" aria-label="설비투자 집행 단계 대조">
                <caption className="sr-only">S10에서 기록한 설비투자 트랜치의 금액, 통화, 집행 조건, 상태</caption>
                <ColGroup widths={TRANCHE_RECON_COL_PCT} />
                <thead>
                  <tr><th scope="col">번호</th><th scope="col">금액</th><th scope="col">통화</th><th scope="col">집행 조건</th><th scope="col">상태</th></tr>
                </thead>
                <tbody>
                  {rec.tranches.length === 0 && <tr><td colSpan={5} className="text-[color:var(--muted-fg)]">S10에 기록된 트랜치가 없습니다.</td></tr>}
                  {rec.tranches.map((t) => (
                    <tr key={t.id} className={isExcludedTranche(t) ? "text-[color:var(--muted-fg)] opacity-70" : undefined} data-excluded={isExcludedTranche(t) ? "true" : undefined}>
                      <td className="tabular-nums">{t.tranche_no}</td>
                      <td className="tabular-nums">{fmtMoney(t.amount, t.currency)}</td>
                      <td>{t.currency}</td>
                      <td className="text-[length:var(--fs-caption)]">{t.release_condition || "—"}</td>
                      <td>
                        {TRANCHE_STATUS_LABEL[t.status] ?? t.status}
                        {isExcludedTranche(t) && <span className="block text-[length:var(--fs-caption)]">{EXCLUDED_TRANCHE_TEXT}</span>}
                        {t.pending_release && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">집행 승인 대기</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[length:var(--fs-caption)] mt-1">
              트랜치 합계(보류 행 제외) <span className="tabular-nums">{fmtMoney(rec.tranche_total, rec.tranche_currencies.length === 1 ? rec.tranche_currencies[0] : "KRW")}</span>
              {rec.case.capex_total_krw_m !== null && <> · S8 채택 케이스 설비투자 <span className="tabular-nums">{fmtMoney(rec.case.capex_total_krw_m)}</span> 백만 KRW</>}
            </p>
            {verdict && (
              <p className="text-[length:var(--fs-caption)] mt-1">
                <span className={`status-chip ${verdict.cls}`}>{verdict.chip}</span>
                <span className="block text-[color:var(--muted-fg)] mt-1">{verdict.text}</span>
              </p>
            )}
          </>
        )}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          트랜치 집행은 두 사람이 하는 절차입니다 (요청자와 승인자가 달라야 함). 여기서는 집행하지 않습니다.{" "}
          <Link href={`/projects/${encodeURIComponent(projectId)}/deal-structure?tab=capex`} className="underline">S10 설비투자 집행 단계 탭에서 집행 →</Link>
        </p>
      </div>

      {/* 2-5. 기록 항목 */}
      {permitNote && <p className="text-[length:var(--fs-caption)] mt-3" role="note"><span className="status-chip status-not-started">○ 참고</span> {permitNote}</p>}
      {ENTRY_KINDS.map((kind) => {
        // 2026-10-21 decider: 하위탭 필터 — 전체 / 트랜치 / 인허가·인증 / 인력·조직 / 가동 KPI / 인센티브 의무
        const show = gxTab === "all" || gxTab === "tranches"
          ? true
          : gxTab === "permits_certs"
            ? kind === "permit_milestones" || kind === "certification_milestones"
            : gxTab === "hiring_kpi"
              ? kind === "hiring_plan" || kind === "kpi_targets"
              : kind === "incentive_obligations";
        if (!show) return null;
        return (
          <EntrySection
            key={kind}
            kind={kind}
            entries={entries}
            canAct={canAct}
            busy={busy}
            sourceOptions={srcOptions(kind)}
            onSave={saveEntries}
            onRemove={removeEntry}
          />
        );
      })}

      {/* S8 사업 목표: 참고 증적 (판정 아님) */}
      {(status.sources?.goals_reference_only.length ?? 0) > 0 && (
        <div className="mt-3" data-testid="gx-goals-reference">
          <h4 className="text-[length:var(--fs-body)] mb-1">참고 증적 — S8 사업 목표</h4>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
            가동 KPI 목표를 정할 때 참고하는 값입니다. 합격·불합격 판정이 아니며, 'goal:지표 키'로 KPI 목표에서 가리킬 수 있습니다.
          </p>
          <ul className="sizing-note-list">
            {status.sources!.goals_reference_only.map((g) => (
              <li key={g.id}><span className="tabular-nums">goal:{g.metric_key}</span> — {g.label ?? g.metric_key}: {fmtNumber(g.target_value)} {g.direction === "gte" ? "이상" : "이하"} (참고)</li>
            ))}
          </ul>
        </div>
      )}

      {/* 사람의 확인 — 프로젝트 리드만 */}
      <div className="mt-4" data-testid="gx-confirm">
        <h4 className="text-[length:var(--fs-body)] mb-1">프로젝트 리드의 확정 — 실행 기준선</h4>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
          새 항목을 기록하거나 트랜치가 바뀌면 이전 확정이 유효하지 않아 다시 확정해야 합니다. 확정은 프로젝트 리드가 근거와 함께 기록하며, 에이전트는 초안만 제안합니다.
        </p>
        {missingViews.length > 0 && (
          <div className="text-[length:var(--fs-caption)] mb-2" role="note" data-testid="gx-missing-sections">
            <span className="status-chip status-amber">▲ 필수 항목이 비어 있음</span>
            <ul className="sizing-note-list mt-1" aria-label="비어 있는 필수 항목">
              {missingViews.map((m) => (
                <li key={m.key}>
                  <a href={`#${m.anchor}`} className="underline"
                    onClick={(e) => { e.preventDefault(); const el = document.getElementById(m.anchor); el?.scrollIntoView({ block: "center" }); el?.focus({ preventScroll: true }); }}>
                    {m.label}
                  </a>을(를) 먼저 기록하세요.
                </li>
              ))}
            </ul>
          </div>
        )}
        {canAct && isLead ? (
          <form aria-label="실행 기준선 확인" onSubmit={(e) => { e.preventDefault(); confirmBaseline(); }}>
            <label className="text-[length:var(--fs-caption)] block">
              <span className="block mb-1">확정 근거 (필수, {MAX_RATIONALE_LEN}자 이하)</span>
              <textarea
                className="sizing-new-input w-full"
                rows={3}
                maxLength={MAX_RATIONALE_LEN}
                value={rationale}
                aria-required="true"
                aria-invalid={rationaleError ? true : undefined}
                onChange={(e) => { setRationale(e.target.value); if (rationaleError) setRationaleError(null); }}
              />
              <span className="block text-[color:var(--muted-fg)] tabular-nums">{rationale.trim().length}/{MAX_RATIONALE_LEN}</span>
            </label>
            {rationaleError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {rationaleError}</p>}
            <button type="submit" className="btn-ghost btn-sm mt-2" disabled={busy} aria-describedby={!check.allowed && check.reason ? "gx-confirm-reason" : undefined}>
              {busy ? "기록 중..." : status.requirement === "reconfirm_required" ? "실행 기준선 재확정 (확인 필요)" : "실행 기준선 확인 (확인 필요)"}
            </button>
            {!check.allowed && rationale.length > 0 && check.reason && <span id="gx-confirm-reason" className="sr-only">{check.reason}</span>}
          </form>
        ) : (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="gx-lead-only">
            {!canAct ? "기록은 analyst 이상 권한이 필요합니다. " : ""}{LEAD_ONLY_TEXT}.
          </p>
        )}
      </div>
      {ackFindings && (
        <BaselineConfirmDialog
          findings={ackFindings}
          busy={busy}
          onCancel={() => setAckFindings(null)}
          onConfirm={(acks) => { void submitConfirm(acks); }}
        />
      )}
      {confirmDialog}
    </section>
  );
}
