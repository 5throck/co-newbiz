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
import { useTranslations } from "next-intl";
import {
  EMPTY_ENTRIES,
  ENTRY_KINDS,
  ENTRY_SPECS,
  EXCLUDED_TRANCHE_KEY,
  LEAD_ONLY_KEY,
  MAX_RATIONALE_LEN,
  NEEDS_CLASSIFICATION_KEY,
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
  type EntryCell,
  type EntryError,
  type EntryKind,
  type EntryValues,
  type ExecutionBaselineStatus,
  type Finding,
  type HiringRow,
  type I18nText,
} from "../../lib/execution-baseline-view.ts";

/** Column shares (%): four data columns, [row actions]. */
const ENTRY_COL_PCT_ACT = [30, 20, 14, 24, 12] as const;
const ENTRY_COL_PCT_READONLY = [34, 22, 16, 28] as const;
/** Column shares (%): no, amount, currency, release condition, status. */
const TRANCHE_RECON_COL_PCT = [8, 18, 10, 44, 20] as const;

/** Capex tranche status chip → catalog key (ko master wording mirrors labels.ts TRANCHE_STATUS_LABEL). */
const TRANCHE_STATUS_KEY: Record<string, string> = {
  planned: "stages.s11.executionBaseline.tranchePlanned",
  released: "stages.s11.executionBaseline.trancheReleased",
  withheld: "stages.s11.executionBaseline.trancheWithheld",
};

interface SourceOption { value: string; label: string }

function EntrySection({ kind, entries, canAct, busy, sourceOptions, onSave, onRemove }: {
  kind: EntryKind;
  entries: BaselineEntries;
  canAct: boolean;
  busy: boolean;
  sourceOptions: SourceOption[];
  onSave: (next: BaselineEntries) => Promise<boolean>;
  onRemove: (kind: EntryKind, index: number) => void;
}) {const t = useTranslations("stages.s11.executionBaseline"); const tc = useTranslations("common"); const tr = useTranslations();
  /** Resolve a lib-emitted render reference: catalog key + params, or raw server text passthrough. */
  const tx = (m: I18nText): string => (m.key ? tr(m.key, m.params) : m.text ?? "");
  /** Resolve a structured form-validation failure into a message (label refs resolved from the spec). */
  const FORMAT_ERR_KEY: Record<string, string> = {
    target_date: "errFormatTargetDate",
    quarter: "errFormatQuarter",
    headcount: "errFormatHeadcount",
    metric_key: "errFormatMetricKey",
    target_value: "errFormatTargetValue",
    due: "errFormatDue",
    deadline: "errFormatDeadline",
  };
  const entryErrorText = (err: EntryError): string => {
    if (err.kind === "required") return t("errRequired", { p1: tx(ENTRY_SPECS[kind].fields.find((f) => f.key === err.field)!.label) });
    if (err.kind === "maxLength") return t("errMaxLength", { p1: tx(ENTRY_SPECS[kind].fields.find((f) => f.key === err.field)!.label), p2: String(err.max) });
    return t(FORMAT_ERR_KEY[err.code]);
  };
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
    setFormError(built.ok ? null : entryErrorText(built.error));
    if (!built.ok) return;
    if (editing === null && !canAddEntry(entries, kind)) { setFormError(t("atMost100ItemsCan")); return; }
    const saved = await onSave(withEntry(entries, kind, editing, built.value));
    if (saved) { setValues(emptyValues(kind)); setEditing(null); }
  }

  /** Render one row cell: plain data text or a catalog reference resolved at render. */
  const renderCell = (c: EntryCell): string => (typeof c === "string" ? c : tx(c));

  return (
    <div className="mt-3" id={`gx-${kind}`} tabIndex={-1} data-testid={`gx-${kind}`}>
      <h4 className="text-[length:var(--fs-body)] mb-1">{tx(spec.title)} ({rows.length}{tc("countSuffixParen")}</h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{tx(spec.description)}</p>
      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-48" aria-label={tx(spec.title)}>
          <caption className="sr-only">{tx(spec.title)} {t("list")}</caption>
          <ColGroup widths={canAct ? ENTRY_COL_PCT_ACT : ENTRY_COL_PCT_READONLY} />
          <thead>
            <tr>
              <th scope="col">{tx(spec.headers[0])}</th><th scope="col">{tx(spec.headers[1])}</th>
              <th scope="col">{tx(spec.headers[2])}</th><th scope="col">{tx(spec.headers[3])}</th>
              {canAct && <th scope="col">{tc("manage")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={canAct ? 5 : 4} className="text-[color:var(--muted-fg)]">{t("nothingRecordedYet")}</td></tr>
            )}
            {rows.map((row, i) => {
              const cells = rowCells(kind, row, { cumulativeHeadcount: cumulative[i], sourceLabel: labelOf });
              return (
                <tr key={`${kind}-${i}`}>
                  {cells.map((c, j) => <td key={j} className={j === 2 && kind !== "permit_milestones" && kind !== "certification_milestones" ? "tabular-nums" : undefined}>{renderCell(c)}</td>)}
                  {canAct && (
                    <td>
                      <span className="flex gap-1">
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={t("p1ModificationP2", { p1: tx(spec.title), p2: i + 1 })}
                          onClick={() => { setEditing(i); setValues(valuesOf(kind, row)); setFormError(null); }}>{tc("edit")}</button>
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={t("p1DeletionP2", { p1: tx(spec.title), p2: i + 1 })}
                          onClick={() => onRemove(kind, i)}>{tc("delete")}</button>
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
          aria-label={editing === null ? tx(spec.addLabel) : t("p1ModificationP22", { p1: tx(spec.title), p2: editing + 1 })}
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div className="flex flex-wrap items-end gap-2">
            {spec.fields.map((f) => (
              <label key={f.key} className="text-[length:var(--fs-caption)] min-w-[9rem] flex-1" htmlFor={`${uid}-${f.key}`}>
                <span className="block mb-1">{tx(f.label)}{f.required ? tc("requiredSuffix") : ""}</span>
                {f.kind === "select" ? (
                  <select id={`${uid}-${f.key}`} className="sizing-new-input w-full" value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    <option value="">{t("doNotSelect")}</option>
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
                    placeholder={f.placeholder ? tx(f.placeholder) : undefined}
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
              {busy ? tc("recording") : editing === null ? tx(spec.addLabel) : t("saveChanges")}
            </button>
            {editing !== null && (
              <button type="button" className="btn-ghost btn-sm" disabled={busy}
                onClick={() => { setEditing(null); setValues(emptyValues(kind)); setFormError(null); }}>{t("cancelEdit")}</button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

export function ExecutionBaselinePanel({ projectId, canAct }: { projectId: string; canAct: boolean }) {const t = useTranslations("stages.s11.executionBaseline"); const tc = useTranslations("common"); const tr = useTranslations();
  /** Resolve a lib-emitted render reference: catalog key + params, or raw server text passthrough. */
  const tx = (m: I18nText): string => (m.key ? tr(m.key, m.params) : m.text ?? "");
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
      .catch((e) => setLoadError(tx(baselineErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : t("failedToLoadTheExecution"))))),
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
  if (!status) return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3" role="status">{t("loadingTheExecution")}</p>;
  if (status.applicability.state === "not_applicable") {
    return (
      <section className="market-section sizing-step mt-3" aria-label={tc("newExecutionBaseline")} data-testid="gx-not-applicable">
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> {tc("newExecutionBaseline")}</h3>
        <p className="text-[length:var(--fs-caption)] mb-0" role="note">
          <span className="status-chip status-not-started">{t("notApplicable")}</span>
          <span className="block mt-1 text-[color:var(--muted-fg)]">
            {t("thisProjectDoesNotFollow")}
          </span>
        </p>
      </section>
    );
  }

  if (status.requirement === "classification_conflict") {
    // Conflicting case_type vs route track: a human must reconcile them first; no form is offered.
    const cc = requirementView("classification_conflict");
    return (
      <section className="market-section sizing-step mt-3" aria-label={tc("newExecutionBaseline")} data-testid="gx-classification-conflict">
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> {tc("newExecutionBaseline")}</h3>
        <div role="alert" className="text-[length:var(--fs-caption)] border border-[color:var(--amber-border,var(--primary-border))] rounded-lg px-3 py-2">
          <span className={`status-chip ${cc.cls}`}>{tx(cc.chip)}</span>
          <span className="block mt-1 font-semibold">{tx(cc.text)}</span>
          {status.warning && <span className="block mt-1 text-[color:var(--muted-fg)]">{status.warning}</span>}
          <span className="block mt-1">{t("actionAlignTheProjectS")}</span>
        </div>
      </section>
    );
  }
  if (status.applicability.state === "needs_classification") {
    return (
      <section className="market-section sizing-step mt-3" aria-label={tc("newExecutionBaseline")} data-testid="gx-needs-classification">
        <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> {tc("newExecutionBaseline")}</h3>
        <p className="text-[length:var(--fs-caption)]" role="note">
          <span className="status-chip status-not-started">{t("trackClassificationNeeded")}</span>
          <span className="block mt-1 text-[color:var(--muted-fg)]">{tr(NEEDS_CLASSIFICATION_KEY)}</span>
          {status.warning && <span className="block mt-1 text-[color:var(--muted-fg)]" data-testid="gx-warning">{t("note")} {status.warning}</span>}
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
      setAnnounce(hadConfirmation ? t("recordedThePreviousConfirmationWas") : t("recorded")); // INTERIM-WORDING
      return true;
    } catch (e) {
      const msg = tx(baselineErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : undefined));
      setError(msg);
      setAnnounce(t("failedToRecordP1", { p1: msg })); // INTERIM-WORDING
      return false;
    } finally {
      setBusy(false);
    }
  }

  function removeEntry(kind: EntryKind, index: number) {
    const label = tx(ENTRY_SPECS[kind].title);
    confirm(t("deleteP1Item", { p1: label }), () => { void saveEntries(withEntry(entries, kind, index, null)); }, {
      body: t("removesItemP2OfP1", { p1: label, p2: index + 1, p3: entriesClearConfirmation(record) ? t("thePreviousConfirmationIsCleared") : "" }), // INTERIM-WORDING
      confirmLabel: tc("delete"),
    });
  }

  /** Validate the rationale, refuse early on missing sections, then open the acknowledgement dialog. */
  function confirmBaseline() {
    const problem = canConfirm(canAct, rationale, isLead);
    setRationaleError(problem.reason ? tx(problem.reason) : null);
    if (!problem.allowed) return;
    if ((status?.missing_sections ?? []).length > 0) {
      setServerMissing(status!.missing_sections!);
      setError(tx(confirmErrorText("baseline_empty", undefined)));
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
      setAnnounce(open > 0 ? t("confirmedP1ItemSNeeding", { p1: open }) : t("confirmed")); // INTERIM-WORDING
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      const meta = e instanceof ApiError ? e.meta : {};
      let msg = tx(confirmErrorText(code, e instanceof Error ? e.message : undefined));
      if (code === "findings_open") {
        // The server's open list wins: reopen the dialog with exactly those findings.
        const open = acknowledgeableFindings(((meta.open_findings as Finding[] | undefined) ?? []));
        setAckFindings(open.length > 0 ? open : null);
        msg = t("p1P2ItemS", { p1: msg, p2: open.length });
      } else {
        setAckFindings(null);
      }
      if (code === "baseline_empty") {
        const missing = (meta.missing_sections as string[] | undefined) ?? [];
        setServerMissing(missing);
        msg = t("p1EmptyItemsP2", { p1: msg, p2: missingSectionViews(missing).map((m) => tx(m.label)).join(", ") });
      }
      if (code === "lead_required") await load();
      setError(msg);
      setAnnounce(t("failedToConfirmP1", { p1: msg })); // INTERIM-WORDING
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="market-section sizing-step mt-3" aria-label={tc("newExecutionBaseline")} data-testid="gx-baseline">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> {t("newBusinessExecutionBaselineTranches")}</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("fixesTheExecutionPlanIn")}
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {/* 상태 칩: 필수 여부(차단/권장) + 확정 여부 */}
      <p className="flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)]">
        <span className={`status-chip ${req.cls}`} title={status.requirement_label ?? undefined}>{tx(req.chip)}</span>
        <span className={`status-chip ${conf.cls}`}>{tx(conf.chip)}</span>
        {status.requirement === "reconfirm_required" && <span className="status-chip status-amber">{t("needed")}</span>}
        {conf.detail && <span className="text-[color:var(--muted-fg)]">{t("confirmedByAndDate")} {conf.detail}{conf.recordedBy ? t("itemRecordedByP1", { p1: conf.recordedBy }) : ""}</span>}
      </p>
      <p className="text-[length:var(--fs-caption)] mt-1">{tx(req.text)}</p>
      {status.requirement_label && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{status.requirement_label}</p>}
      {status.warning && status.requirement !== "recommended" && (
        <p className="text-[length:var(--fs-caption)] mt-1" data-testid="gx-warning"><span aria-hidden="true">▲ </span>{status.warning}</p>
      )}
      {confirmedRecord?.confirmation && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          {t("confirmationEvidence")} {confirmedRecord.confirmation.rationale}
          {(confirmedRecord.confirmation.acknowledged_findings?.length ?? 0) > 0 && t("evidenceLeftForP1Item", { p1: confirmedRecord.confirmation.acknowledged_findings!.length })}
        </p>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-2">✕ {error}</p>}

      {/* 서브탭 — 2026-10-21 decider: 트랜치 / 인허가·인증 / 인력·조직 / 가동 KPI / 인센티브 의무 구분 */}
      <div role="tablist" aria-label={t("executionBaseline")} className="flex flex-wrap gap-1 mb-2">
        {([
          { key: "all", label: tc("all") },
          { key: "tranches", label: t("executionStageTranche") },
          { key: "permits_certs", label: t("permitsAndCertifications") },
          { key: "hiring_kpi", label: t("staffingAndOrganizationOperatingKpis") },
          { key: "incentives", label: t("incentiveObligations") },
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
          <h4 className="text-[length:var(--fs-body)] mb-1">{t("itemsNeedingConfirmation")}{status.findings.length}{tc("countSuffixParen")}</h4>
          <ul className="sizing-note-list" aria-label={t("itemsNeedingConfirmation2")}>
            {status.findings.map((f, i) => <li key={`${f.code}-${i}`}><span aria-hidden="true">▲ </span>{tx(findingText(f))}</li>)}
          </ul>
        </div>
      )}

      {/* 1. 트랜치 대조 */}
      <div className="mt-3" data-testid="gx-tranches" hidden={gxTab !== "all" && gxTab !== "tranches"}>
        <h4 className="text-[length:var(--fs-body)] mb-1">{t("capexTrancheComparisonS10Execution")}</h4>
        {rec && (
          <>
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48" aria-label={t("capexExecutionStageComparison")}>
                <caption className="sr-only">{t("amountCurrencyExecutionConditionsAnd")}</caption>
                <ColGroup widths={TRANCHE_RECON_COL_PCT} />
                <thead>
                  <tr><th scope="col">{tc("rowNumber")}</th><th scope="col">{tc("amount")}</th><th scope="col">{tc("currency")}</th><th scope="col">{t("executionCondition")}</th><th scope="col">{tc("status")}</th></tr>
                </thead>
                <tbody>
                  {rec.tranches.length === 0 && <tr><td colSpan={5} className="text-[color:var(--muted-fg)]">{t("noTranchesRecordedInS10")}</td></tr>}
                  {rec.tranches.map((row) => (
                    <tr key={row.id} className={isExcludedTranche(row) ? "text-[color:var(--muted-fg)] opacity-70" : undefined} data-excluded={isExcludedTranche(row) ? "true" : undefined}>
                      <td className="tabular-nums">{row.tranche_no}</td>
                      <td className="tabular-nums">{fmtMoney(row.amount, row.currency)}</td>
                      <td>{row.currency}</td>
                      <td className="text-[length:var(--fs-caption)]">{row.release_condition || "—"}</td>
                      <td>
                        {TRANCHE_STATUS_KEY[row.status] ? tr(TRANCHE_STATUS_KEY[row.status]) : row.status}
                        {isExcludedTranche(row) && <span className="block text-[length:var(--fs-caption)]">{tr(EXCLUDED_TRANCHE_KEY)}</span>}
                        {row.pending_release && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("awaitingExecutionApproval")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[length:var(--fs-caption)] mt-1">
              {t("trancheTotalHoldRowsExcluded")} <span className="tabular-nums">{fmtMoney(rec.tranche_total, rec.tranche_currencies.length === 1 ? rec.tranche_currencies[0] : "KRW")}</span>
              {rec.case.capex_total_krw_m !== null && <> {t("s8Capex")} <span className="tabular-nums">{fmtMoney(rec.case.capex_total_krw_m)}</span> {tc("krwMillionKrw")}</>}
            </p>
            {verdict && (
              <p className="text-[length:var(--fs-caption)] mt-1">
                <span className={`status-chip ${verdict.cls}`}>{tx(verdict.chip)}</span>
                <span className="block text-[color:var(--muted-fg)] mt-1">{tx(verdict.text)}</span>
              </p>
            )}
          </>
        )}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          {t("trancheExecutionIsAProcedure")}{" "}
          <Link href={`/projects/${encodeURIComponent(projectId)}/deal-structure?tab=capex`} className="underline">{t("executeInTheS10Capex")}</Link>
        </p>
      </div>

      {/* 2-5. 기록 항목 */}
      {permitNote && <p className="text-[length:var(--fs-caption)] mt-3" role="note"><span className="status-chip status-not-started">{t("reference")}</span> {tx(permitNote)}</p>}
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
          <h4 className="text-[length:var(--fs-body)] mb-1">{t("referenceEvidenceS8BusinessGoals")}</h4>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
            {t("aReferenceValueForSetting")}
          </p>
          <ul className="sizing-note-list">
            {status.sources!.goals_reference_only.map((g) => (
              <li key={g.id}><span className="tabular-nums">goal:{g.metric_key}</span> — {g.label ?? g.metric_key}: {fmtNumber(g.target_value)} {g.direction === "gte" ? t("orMore") : t("orLess")} {t("reference2")}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 사람의 확인 — 프로젝트 리드만 */}
      <div className="mt-4" data-testid="gx-confirm">
        <h4 className="text-[length:var(--fs-body)] mb-1">{t("projectLeadConfirmationExecutionBaseline")}</h4>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
          {t("recordingANewItemOr")}
        </p>
        {missingViews.length > 0 && (
          <div className="text-[length:var(--fs-caption)] mb-2" role="note" data-testid="gx-missing-sections">
            <span className="status-chip status-amber">{t("requiredItemsAreEmpty")}</span>
            <ul className="sizing-note-list mt-1" aria-label={t("emptyRequiredItems")}>
              {missingViews.map((m) => (
                <li key={m.key}>
                  <a href={`#${m.anchor}`} className="underline"
                    onClick={(e) => { e.preventDefault(); const el = document.getElementById(m.anchor); el?.scrollIntoView({ block: "center" }); el?.focus({ preventScroll: true }); }}>
                    {tx(m.label)}
                  </a>{t("recordItFirst")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canAct && isLead ? (
          <form aria-label={tc("confirmExecutionBaseline")} onSubmit={(e) => { e.preventDefault(); confirmBaseline(); }}>
            <label className="text-[length:var(--fs-caption)] block">
              <span className="block mb-1">{t("confirmationEvidenceRequired")} {MAX_RATIONALE_LEN}{t("charsOrFewer")}</span>
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
              {busy ? tc("recording") : status.requirement === "reconfirm_required" ? t("executionBaselineConfirmationNeeded") : t("confirmExecutionBaselineConfirmationNeeded")}
            </button>
            {!check.allowed && rationale.length > 0 && check.reason && <span id="gx-confirm-reason" className="sr-only">{tx(check.reason)}</span>}
          </form>
        ) : (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="gx-lead-only">
            {!canAct ? t("recordingRequiresTheAnalystRole") : ""}{tr(LEAD_ONLY_KEY)}.
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
