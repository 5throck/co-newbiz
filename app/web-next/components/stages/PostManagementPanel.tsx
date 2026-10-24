"use client";

// S12 사후 관리 패널 (ADR-0161 Row 3). 읽기 전용: 어떤 S12 항목이 이 프로젝트에 적용되는지(모두 권장,
// S12에는 게이트가 없어 차단하지 않음), 신규 사업(greenfield)의 가동 지표를 S8 사업 목표에 비춘
// '참고 증적'으로, 외부 brownfield의 통합·전략 제휴 모니터링 읽기 보기를 보여 준다. 판정은 사람의 몫이며
// 이 패널은 어떤 값도 기록하지 않는다 (전환 결정 기록은 PortfolioStage 의 기존 폼).

import { TranslatorFn } from "../../i18n/config.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { ColGroup, ParamTable } from "../ui.tsx";
import { TRANSITION_DECISION_KEY, TRANSITION_HELP_KEY } from "../../lib/label-keys.ts";
import { baselineErrorText } from "../../lib/execution-baseline-view.ts";
import { useTranslations } from "next-intl";
import { resolveI18n } from "../../lib/execution-baseline-view.ts";
import {
  applicableItems,
  bpToPercent,
  buildScorecardPayload,
  CUSTOM_GOAL_OPTION,
  effectiveClassText,
  emptyMeasureDraft,
  EVIDENCE_REF_HINT,
  isVentureOverride,
  MEASURE_STATUS_VALUES,
  scorecardErrorText,
  SCORECARD_FORM_LIMITS,
  VENTURE_CLASS_VALUES,
  type GreenfieldRampUp,
  type MeasureDraft,
  goalDirectionText,
  goalJudgementMeta,
  goalJudgementI18n,
  isGreenfieldRampUp,
  retentionText,
  ventureClassI18n,
  type PostManagementView,
} from "../../lib/post-management-view.ts";

/** Column shares (%): item, state. */
const ITEM_COL_PCT = [68, 32] as const;
/** Column shares (%): measure, class, target, actual, state. */
const RAMP_MEASURE_COL_PCT = [34, 18, 14, 14, 20] as const;
/** Column shares (%): metric, label, direction + target, judgement. */
const RAMP_GOAL_COL_PCT = [26, 30, 22, 22] as const;
/** Column shares (%): section, measure, state. */
const PARTNER_MEASURE_COL_PCT = [24, 46, 30] as const;
/** Column shares (%): item, baseline, actual, variance, state. */
const VARIANCE_COL_PCT = [40, 14, 14, 14, 18] as const;

const MEASURE_STATUS = (tr: TranslatorFn): Record<string, { icon: string; label: string; cls: string }> => ({
  on_target: { icon: "●", label: "common.goalAttainment", cls: "status-green" },
  deviation: { icon: "◐", label: "common.churn", cls: "status-amber" },
  insufficient_evidence: { icon: "○", label: "common.insufficientEvidence", cls: "status-not-started" },
});
const measureStatus = (s: string, tr: TranslatorFn) => {
  const m = MEASURE_STATUS(tr)[s];
  return m ? { ...m, label: tr(m.label) } : { icon: "?", label: s, cls: "status-not-started" };
};

export function PostManagementPanel({ projectId }: { projectId: string }) {const tr = useTranslations(); const t = useTranslations("stages.s12.postManagement"); const tc = useTranslations("common");
  /** Resolve a lib-emitted render reference: catalog key + params, or raw server text passthrough. */
  const tx = (m: { key: string | null; params: Record<string, string>; text: string | null }): string => (m.key ? tr(m.key, m.params) : m.text ?? "");
  const [view, setView] = useState<PostManagementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);

  const load = useCallback(async (isLive: () => boolean = () => true) => {
    try {
      const r = await api.get<PostManagementView>(`/api/projects/${encodeURIComponent(projectId)}/post-management`);
      if (isLive()) setView(r.data);
    } catch (e) {
      // Insider (read) gate: the same Korean message the other ADR-0161 GETs show.
      if (isLive()) setError(tx(baselineErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : t("failedToLoadItems"))));
    }
  }, [projectId]);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, [load]);

  if (error) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-3">✕ {error}</p>;
  if (!view) return null;

  // The venture-scorecard form is greenfield-only (T-20261022-001); off-greenfield
  // the portfolio_venture_monitoring recommendation is procedural — say so on the
  // chip instead of implying a recorder this screen does not offer (T-20261022-044).
  const items = applicableItems(view.applicability, { ventureRecorder: isGreenfieldRampUp(view) ? "in_app" : "procedure_only" });
  const ramp = isGreenfieldRampUp(view) ? view.greenfield_ramp_up : null;
  const integ = view.integration_monitoring;
  const partner = view.partnership_monitoring;

  return (
    <section className="market-section sizing-step mt-3" aria-label={t("applicableItems")} data-testid="pm-panel">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">🧭</span> {t("applicableItems2")}</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("s12HasNoGatesSo")}
      </p>
      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-32" aria-label={t("applicableS12Items")}>
          <caption className="sr-only">{t("s12ItemsApplyingToThis")}</caption>
          <ColGroup widths={ITEM_COL_PCT} />
          <thead><tr><th scope="col">{tc("items")}</th><th scope="col">{tc("apply")}</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key}>
                <td>{resolveI18n(it.label, tr)}</td>
                <td><span className={`status-chip ${it.cls}`}>{resolveI18n(it.chip, tr)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ramp && (
        <div className="mt-3" data-testid="pm-ramp-up">
          <h4 className="text-[length:var(--fs-body)] mb-1">{t("newBusinessOperatingMetricsVs")}</h4>
          <p className="text-[length:var(--fs-caption)] mb-1">
            <span className="status-chip status-not-started">{t("defaultVentureClass")} {resolveI18n(ventureClassI18n(ramp.default_venture_class), tr)}</span>
            <span className="status-chip status-not-started ml-1" data-testid="pm-effective-class">{t("currentlyApplied")} {effectiveClassText(ramp.venture_class, ramp.default_venture_class, (cls) => resolveI18n(ventureClassI18n(cls), tr))}</span>
            {ramp.review_cycle && <span className="status-chip status-not-started ml-1">{tc("reviewCycle")} {ramp.review_cycle}</span>}
          </p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {t("ventureClassDefaultsForNew")}
          </p>

          <h5 className="text-[length:var(--fs-body)] mb-1">{t("s8BusinessGoals")}{ramp.goals.length}{tc("countSuffixParen")}</h5>
          {ramp.goals.length > 0 ? (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-40" aria-label={t("s8BusinessGoalsReference")}>
                <caption className="sr-only">{t("s8BusinessGoalsAndScorecard")}</caption>
                <ColGroup widths={RAMP_GOAL_COL_PCT} />
                <thead><tr><th scope="col">{tc("metric")}</th><th scope="col">{t("name")}</th><th scope="col">{tc("target")}</th><th scope="col">{tc("judgement")}</th></tr></thead>
                <tbody>
                  {ramp.goals.map((g) => {
                    const m = goalJudgementMeta(g.judgement);
                    return (
                      <tr key={g.goal_id}>
                        <td className="tabular-nums">goal:{g.metric_key}</td>
                        <td>{g.label ?? g.metric_key}</td>
                        <td className="tabular-nums">{g.target_value.toLocaleString("ko-KR")} {goalDirectionText(g.direction)}</td>
                        <td><span className={`status-chip ${m.cls}`}>{m.icon} {resolveI18n(goalJudgementI18n(g.judgement), tr)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noBusinessGoalsRecordedIn")}</p>
          )}

          <h5 className="text-[length:var(--fs-body)] mt-2 mb-1">{t("latestCycleOperatingMeasurement")}{ramp.measures.length}{tc("countSuffixParen")}</h5>
          {ramp.measures.length > 0 ? (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48" aria-label={t("newBusinessOperatingMeasurement")}>
                <caption className="sr-only">{t("newBusinessOperatingMeasurementFor")}</caption>
                <ColGroup widths={RAMP_MEASURE_COL_PCT} />
                <thead><tr><th scope="col">{tc("measurement")}</th><th scope="col">{t("class")}</th><th scope="col">{tc("target")}</th><th scope="col">{tc("actual")}</th><th scope="col">{tc("status")}</th></tr></thead>
                <tbody>
                  {ramp.measures.map((r, i) => {
                    const m = measureStatus(r.status, tr);
                    return (
                      <tr key={`${r.section}-${r.measure_key}-${i}`}>
                        <td>{r.measure_key}</td>
                        <td>{resolveI18n(ventureClassI18n(r.venture_class), tr)}</td>
                        <td>{r.target_value ?? "—"}</td>
                        <td>{r.actual_value ?? "—"}</td>
                        <td><span className={`status-chip ${m.cls}`}>{m.icon} {m.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noOperatingMeasurementsRecordedYet")}</p>
          )}

          {view.baseline_variance && view.baseline_variance.status !== "not_applicable" && (
            <div className="mt-3" data-testid="baseline-variance">
              <h4 className="text-[length:var(--fs-body)] mb-1">{tc("varianceVsExecutionBaseline")} <span className="note">{t("s11ConfirmedBaselineVsQuarterly")}</span></h4>
              {view.baseline_variance.status === "no_confirmed_baseline" ? (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noConfirmedExecutionBaselineOnce")}</p>
              ) : view.baseline_variance.status === "no_scorecard_cycle" ? (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("theBaselineIsConfirmedBut")}</p>
              ) : (
                <>
                  <p className="text-[length:var(--fs-caption)] mb-1">
                    {tc("quarter")} {view.baseline_variance.review_cycle} {t("baselineConfirmed")} {view.baseline_variance.baseline_confirmed_at?.slice(0, 10)} ·
                    {" "}{t("asPlanned")} {view.baseline_variance.summary.on_plan} {t("lagging")} {view.baseline_variance.summary.behind} {t("ahead")} {view.baseline_variance.summary.ahead} {t("insufficientEvidence")} {view.baseline_variance.summary.insufficient_evidence}
                  </p>
                  <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                    <table className="data-table table-fixed-pct tmin-48" aria-label={tc("varianceVsExecutionBaseline")}>
                      <caption className="sr-only">{tc("varianceVsExecutionBaseline")}</caption>
                      <ColGroup widths={VARIANCE_COL_PCT} />
                      <thead><tr><th>{tc("items")}</th><th className="col-num">{t("baseline")}</th><th className="col-num">{tc("actual")}</th><th className="col-num">{t("difference")}</th><th>{tc("judgement")}</th></tr></thead>
                      <tbody>{view.baseline_variance.rows.map((r) => (
                        <tr key={`${r.area}:${r.key}`}>
                          <td title={r.note ?? undefined}>{r.label}{r.comparison === "higher_is_better_assumed" && <span className="note ml-1" title={t("noDirectionInformationSoRead")}>{t("assumptionAbove")}</span>}</td>
                          <td className="col-num tabular-nums">{r.baseline ?? "—"}</td>
                          <td className="col-num tabular-nums">{r.actual ?? "—"}</td>
                          <td className="col-num tabular-nums">{r.variance != null ? `${r.variance > 0 ? "+" : ""}${r.variance}` : "—"}</td>
                          {/* P5 신호등 — 색 + 글리프 + 텍스트 3중 부호화 (design-guide.md P5) */}
                          <td>{r.status === "on_plan" ? <span className="status-chip status-green"><span aria-hidden="true">●</span> {t("asPlanned2")}</span> : r.status === "behind" ? <span className="status-chip status-amber"><span aria-hidden="true">◐</span> {t("lagging2")}</span> : r.status === "ahead" ? <span className="status-chip status-green"><span aria-hidden="true">●</span> {t("ahead2")}</span> : <span className="status-chip status-not-started"><span aria-hidden="true">○</span> {tc("insufficientEvidence")}</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {canAct && <ScorecardForm projectId={projectId} ramp={ramp} onRecorded={() => load()} />}

          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("transitionDecisionTermsMeaningIn")}</summary>
            <ul className="sizing-note-list mt-1" aria-label={t("newBusinessTransitionDecisionTerms")}>
              {Object.keys(TRANSITION_HELP_KEY).map((k) => (
                <li key={k}><strong>{tr(TRANSITION_DECISION_KEY[k] ?? k)}</strong>: {tr(TRANSITION_HELP_KEY[k])}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {integ && (
        <div className="mt-3" data-testid="pm-integration">
          <h4 className="text-[length:var(--fs-body)] mb-1">{t("integratedMonitoringSynergyAndKey")}</h4>
          <ParamTable
            caption={t("integratedMonitoringSummary")}
            valueAlign="end"
            rows={[
              { label: t("synergyCertificationCount"), value: integ.synergy.certifications.toLocaleString("ko-KR"), unit: tc("countUnit") },
              { label: t("latestSynergyRunRate"), value: integ.synergy.latest ? t("p1P2QuartersSustained", { p1: bpToPercent(integ.synergy.latest.run_rate_bp), p2: integ.synergy.latest.sustained_quarters }) : "—", source: integ.synergy.latest ? t("signedP1", { p1: integ.synergy.latest.signed_at.slice(0, 10) }) : undefined },
              { label: t("keyTalentEmployment"), value: integ.key_talent.active.toLocaleString("ko-KR"), unit: tc("peopleUnit") },
              { label: t("regrettedAttrition"), value: integ.key_talent.departed_regretted.toLocaleString("ko-KR"), unit: tc("peopleUnit") },
              { label: t("plannedRetirementsAndMoves"), value: integ.key_talent.departed_planned.toLocaleString("ko-KR"), unit: tc("peopleUnit") },
              { label: t("keyTalentRetentionRate"), value: retentionText(integ.key_talent.retention_pct) },
            ]}
          />
        </div>
      )}

      {partner && (
        <div className="mt-3" data-testid="pm-partnership">
          <h4 className="text-[length:var(--fs-body)] mb-1">{t("strategicAllianceMonitoringJvAnd")}</h4>
          <p className="text-[length:var(--fs-caption)] mb-1">
            {t("recordedJvConditions")} {partner.jv_terms.toLocaleString("ko-KR")}{tc("countUnit")}
            {partner.review_cycle && <span className="status-chip status-not-started ml-2">{tc("reviewCycle")} {partner.review_cycle}</span>}
          </p>
          {partner.measures.length > 0 ? (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-32" aria-label={t("strategicAllianceMeasurement")}>
                <caption className="sr-only">{t("strategicAllianceMeasurementForThe")}</caption>
                <ColGroup widths={PARTNER_MEASURE_COL_PCT} />
                <thead><tr><th scope="col">{tc("division")}</th><th scope="col">{tc("measurement")}</th><th scope="col">{tc("status")}</th></tr></thead>
                <tbody>
                  {partner.measures.map((m, i) => {
                    const st = measureStatus(m.status, tr);
                    return (
                      <tr key={`${m.section}-${m.measure_key}-${i}`}>
                        <td>{m.section === "financial" ? tc("finance") : m.section === "strategic" ? t("strategy") : m.section}</td>
                        <td>{m.measure_key}</td>
                        <td><span className={`status-chip ${st.cls}`}>{st.icon} {st.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noStrategicAllianceMeasurementsRecorded")}</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Column shares (%): key, actual, target, status, evidence, observed, remove. */
const FORM_COL_PCT = [22, 10, 10, 16, 22, 12, 8] as const;
const STATUS_OPTION_LABEL = (tr: TranslatorFn): Record<string, string> => ({ on_target: "common.goalAttainment", deviation: "common.churn", insufficient_evidence: "common.insufficientEvidence" });

/** S12 안착 지표 기록 — human-only greenfield scorecard cycle. A collapsed disclosure; the server stays the authority. */
function ScorecardForm({ projectId, ramp, onRecorded }: { projectId: string; ramp: GreenfieldRampUp; onRecorded: () => Promise<void> }) {const tr = useTranslations(); const t = useTranslations("stages.s12.postManagement"); const tc = useTranslations("common");
  const def = ramp.default_venture_class;
  const effective = ramp.venture_class?.effective ?? def ?? "";
  const uidRef = useRef(0);
  const nextUid = () => `m${++uidRef.current}`;
  const [cycle, setCycle] = useState("");
  const [vclass, setVclass] = useState(effective);
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<MeasureDraft[]>(() => [emptyMeasureDraft("m0")]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  const keys = [...(ramp.measure_keys?.financial ?? []), ...(ramp.measure_keys?.strategic ?? [])];
  const override = isVentureOverride(vclass, def);
  const patch = (uid: string, p: Partial<MeasureDraft>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...p } : r)));

  async function submit() {
    setSuccess(null);
    const built = buildScorecardPayload({ review_cycle: cycle, venture_class: vclass, note, measures: rows }, def);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors([]);
    setBusy(true);
    try {
      const r = await api.post<{ review_cycle: string; measures: number }>(`/api/projects/${encodeURIComponent(projectId)}/post-management/scorecard`, built.payload);
      setSuccess(t("recordedP2MeasurementSFor", { p1: r.data.review_cycle, p2: r.data.measures })); // INTERIM-WORDING
      setRows([emptyMeasureDraft(nextUid())]);
      setCycle("");
      setNote("");
      await onRecorded();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setErrors([scorecardErrorText(code, e instanceof ApiError ? e.status : undefined, e instanceof Error ? e.message : undefined)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-2" data-testid="pm-scorecard-form">
      <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("recordS12StabilizationMetrics")}</summary>
      <div className="mt-2">
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("recordsOneNewBusinessReview")}
        </p>
        <div className="flex flex-wrap gap-3 mb-2">
          <label className="text-[length:var(--fs-caption)]" htmlFor="pm-sc-cycle">
            <span className="block mb-1">{tc("reviewCycle")}</span>
            <input id="pm-sc-cycle" className="sizing-new-input" value={cycle} placeholder="2026-Q4" onChange={(e) => setCycle(e.target.value)} />
          </label>
          <label className="text-[length:var(--fs-caption)]" htmlFor="pm-sc-class">
            <span className="block mb-1">{t("ventureClassDefault")} {resolveI18n(ventureClassI18n(def), tr)})</span>
            <select id="pm-sc-class" className="sizing-new-input" value={vclass} onChange={(e) => setVclass(e.target.value)}>
              {VENTURE_CLASS_VALUES.map((c) => <option key={c} value={c}>{resolveI18n(ventureClassI18n(c), tr)}</option>)}
            </select>
          </label>
        </div>
        {override && (
          <div className="mb-2">
            <label className="text-[length:var(--fs-caption)] block" htmlFor="pm-sc-note">{t("reasonForDeviatingFromThe")}</label>
            <textarea id="pm-sc-note" className="sizing-new-input mt-1 w-full" rows={3} maxLength={SCORECARD_FORM_LIMITS.note} required aria-required="true"
              value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("aClassDifferentFromThe")}
            </p>
          </div>
        )}

        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-48" aria-label={t("metricsToRecord")}>
            <caption className="sr-only">{t("metricsToRecordThisReview")}</caption>
            <ColGroup widths={FORM_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{tc("metric")}</th><th scope="col">{tc("actual")}</th><th scope="col">{tc("target")}</th><th scope="col">{tc("status")}</th>
                <th scope="col">{t("evidenceReference")}</th><th scope="col">{t("observationDate")}</th><th scope="col"><span className="sr-only">{tc("delete")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.uid}>
                  <td>
                    <select aria-label={t("metricKeyP1", { p1: i + 1 })} className="sizing-new-input w-full" value={r.measure_key} onChange={(e) => patch(r.uid, { measure_key: e.target.value })}>
                      <option value="">{t("item")}</option>
                      {keys.map((k) => <option key={k} value={k}>{k}</option>)}
                      {ramp.goals.map((g) => <option key={g.goal_id} value={`goal:${g.metric_key}`}>goal:{g.metric_key}</option>)}
                      <option value={CUSTOM_GOAL_OPTION}>{t("enterBusinessGoalDirectlyGoal")}</option>
                    </select>
                    {r.measure_key === CUSTOM_GOAL_OPTION && (
                      <input aria-label={t("businessGoalKeyP1", { p1: i + 1 })} className="sizing-new-input w-full mt-1" placeholder="metric_key" value={r.custom_goal} onChange={(e) => patch(r.uid, { custom_goal: e.target.value })} />
                    )}
                  </td>
                  <td><input type="number" step="any" aria-label={t("actualP1", { p1: i + 1 })} className="sizing-new-input w-full" value={r.value} onChange={(e) => patch(r.uid, { value: e.target.value })} /></td>
                  <td><input type="number" step="any" aria-label={t("targetP1", { p1: i + 1 })} className="sizing-new-input w-full" value={r.target_value} onChange={(e) => patch(r.uid, { target_value: e.target.value })} /></td>
                  <td>
                    <select aria-label={t("statusP1", { p1: i + 1 })} className="sizing-new-input w-full" value={r.status} onChange={(e) => patch(r.uid, { status: e.target.value })}>
                      {MEASURE_STATUS_VALUES.map((s) => <option key={s} value={s}>{STATUS_OPTION_LABEL(tr)[s]}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={t("evidenceReferenceP1", { p1: i + 1 })} title={EVIDENCE_REF_HINT} placeholder="doc:… / src:… / https://…" maxLength={SCORECARD_FORM_LIMITS.evidence_ref} className="sizing-new-input w-full" value={r.evidence_ref} onChange={(e) => patch(r.uid, { evidence_ref: e.target.value })} /></td>
                  <td><input type="date" aria-label={t("observationDateP1", { p1: i + 1 })} className="sizing-new-input w-full" value={r.observed_at} onChange={(e) => patch(r.uid, { observed_at: e.target.value })} /></td>
                  <td>
                    <button type="button" className="btn-ghost btn-sm" disabled={rows.length <= 1 || busy} aria-label={t("deleteMetricP1", { p1: i + 1 })} onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>{tc("delete")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{t("evidenceReferenceFormat")} {EVIDENCE_REF_HINT}{t("whenActualOrTargetIs")}</p>

        <div className="flex gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" disabled={busy || rows.length >= SCORECARD_FORM_LIMITS.measures * 2} onClick={() => setRows((rs) => [...rs, emptyMeasureDraft(nextUid())])}>{t("addMetric")}</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void submit()}>{busy ? t("item2") : t("thisCycleSRecord")}</button>
        </div>
        <div aria-live="polite" role="status" className="min-h-[1.25rem] text-[length:var(--fs-caption)] mt-1">
          {success && <p>✓ {success}</p>}
        </div>
        <div aria-live="assertive" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] min-h-[1.25rem]">
          {errors.length === 1 && <p>✕ {errors[0]}</p>}
          {errors.length > 1 && <ul className="sizing-note-list">{errors.map((m) => <li key={m}>✕ {m}</li>)}</ul>}
        </div>
      </div>
    </details>
  );
}
