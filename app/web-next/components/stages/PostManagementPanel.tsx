"use client";

// S12 사후 관리 패널 (ADR-0161 Row 3). 읽기 전용: 어떤 S12 항목이 이 프로젝트에 적용되는지(모두 권장,
// S12에는 게이트가 없어 차단하지 않음), 신규 사업(greenfield)의 가동 지표를 S8 사업 목표에 비춘
// '참고 증적'으로, 외부 brownfield의 통합·전략 제휴 모니터링 읽기 보기를 보여 준다. 판정은 사람의 몫이며
// 이 패널은 어떤 값도 기록하지 않는다 (전환 결정 기록은 PortfolioStage 의 기존 폼).

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { ColGroup, ParamTable } from "../ui.tsx";
import { GREENFIELD_TRANSITION_HELP, TRANSITION_DECISION_LABEL } from "../../lib/labels.ts";
import { baselineErrorText } from "../../lib/execution-baseline-view.ts";
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
  goalJudgementText,
  isGreenfieldRampUp,
  retentionText,
  ventureClassText,
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

const MEASURE_STATUS: Record<string, { icon: string; label: string; cls: string }> = {
  on_target: { icon: "●", label: "목표 달성", cls: "status-green" },
  deviation: { icon: "◐", label: "이탈", cls: "status-amber" },
  insufficient_evidence: { icon: "○", label: "근거 부족", cls: "status-not-started" },
};
const measureStatus = (s: string) => MEASURE_STATUS[s] ?? { icon: "?", label: s, cls: "status-not-started" };

export function PostManagementPanel({ projectId }: { projectId: string }) {
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
      if (isLive()) setError(baselineErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : "사후 관리 항목을 불러오지 못했습니다."));
    }
  }, [projectId]);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, [load]);

  if (error) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-3">✕ {error}</p>;
  if (!view) return null;

  const items = applicableItems(view.applicability);
  const ramp = isGreenfieldRampUp(view) ? view.greenfield_ramp_up : null;
  const integ = view.integration_monitoring;
  const partner = view.partnership_monitoring;

  return (
    <section className="market-section sizing-step mt-3" aria-label="적용되는 사후 관리 항목" data-testid="pm-panel">
      <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">🧭</span> 적용되는 사후 관리 항목 (ADR-0161)</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S12에는 게이트가 없어 아래 항목은 모두 권장이며 어떤 것도 단계를 막지 않습니다. 이 화면은 읽기 전용이고, 판단과 전환 결정은 사람이 기록합니다.
      </p>
      <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-32" aria-label="적용되는 S12 항목">
          <caption className="sr-only">이 프로젝트에 적용되는 S12 사후 관리 항목</caption>
          <ColGroup widths={ITEM_COL_PCT} />
          <thead><tr><th scope="col">항목</th><th scope="col">적용</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key}>
                <td>{it.label}</td>
                <td><span className={`status-chip ${it.cls}`}>{it.chip}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ramp && (
        <div className="mt-3" data-testid="pm-ramp-up">
          <h4 className="text-[length:var(--fs-body)] mb-1">신규 사업 가동 지표 — S8 사업 목표 대비 (참고 증적)</h4>
          <p className="text-[length:var(--fs-caption)] mb-1">
            <span className="status-chip status-not-started">기본 벤처 클래스: {ventureClassText(ramp.default_venture_class)}</span>
            <span className="status-chip status-not-started ml-1" data-testid="pm-effective-class">현재 적용: {effectiveClassText(ramp.venture_class, ramp.default_venture_class)}</span>
            {ramp.review_cycle && <span className="status-chip status-not-started ml-1">리뷰 주기 {ramp.review_cycle}</span>}
          </p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            벤처 클래스는 신규 부지는 성장 주도형, 기존 사업 R&amp;BD는 역량 지원형, 사내벤처는 신생 탐색형이 기본값입니다. 스코어카드를 기록하는 사람이 다르게 지정할 수 있고,
            기본값과 다르게 지정하면 감사 기록에 남습니다. 목표 대비 값은 참고 증적일 뿐 합격·불합격 판정이 아닙니다.
          </p>

          <h5 className="text-[length:var(--fs-body)] mb-1">S8 사업 목표 ({ramp.goals.length}건)</h5>
          {ramp.goals.length > 0 ? (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-40" aria-label="S8 사업 목표 참고">
                <caption className="sr-only">S8 사업 목표와 스코어카드 판정 (참고)</caption>
                <ColGroup widths={RAMP_GOAL_COL_PCT} />
                <thead><tr><th scope="col">지표</th><th scope="col">이름</th><th scope="col">목표</th><th scope="col">판정</th></tr></thead>
                <tbody>
                  {ramp.goals.map((g) => {
                    const m = goalJudgementMeta(g.judgement);
                    return (
                      <tr key={g.goal_id}>
                        <td className="tabular-nums">goal:{g.metric_key}</td>
                        <td>{g.label ?? g.metric_key}</td>
                        <td className="tabular-nums">{g.target_value.toLocaleString("ko-KR")} {goalDirectionText(g.direction)}</td>
                        <td><span className={`status-chip ${m.cls}`}>{m.icon} {goalJudgementText(g.judgement)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">S8에서 기록한 사업 목표가 없습니다.</p>
          )}

          <h5 className="text-[length:var(--fs-body)] mt-2 mb-1">최신 주기 가동 측정 ({ramp.measures.length}건)</h5>
          {ramp.measures.length > 0 ? (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48" aria-label="신규 사업 가동 측정">
                <caption className="sr-only">최신 리뷰 주기의 신규 사업 가동 측정</caption>
                <ColGroup widths={RAMP_MEASURE_COL_PCT} />
                <thead><tr><th scope="col">측정</th><th scope="col">클래스</th><th scope="col">목표</th><th scope="col">실적</th><th scope="col">상태</th></tr></thead>
                <tbody>
                  {ramp.measures.map((r, i) => {
                    const m = measureStatus(r.status);
                    return (
                      <tr key={`${r.section}-${r.measure_key}-${i}`}>
                        <td>{r.measure_key}</td>
                        <td>{ventureClassText(r.venture_class)}</td>
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
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">아직 기록된 가동 측정이 없습니다 — portfolio-venture-monitoring 분기 기록이 여기에 표시됩니다.</p>
          )}

          {view.baseline_variance && view.baseline_variance.status !== "not_applicable" && (
            <div className="mt-3" data-testid="baseline-variance">
              <h4 className="text-[length:var(--fs-body)] mb-1">실행 기준선 대비 차이 <span className="note">— S11 확정 기준선 vs 분기 스코어카드 (참고 · 게이트를 막지 않음)</span></h4>
              {view.baseline_variance.status === "no_confirmed_baseline" ? (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">확정된 실행 기준선이 없습니다 — S11 화면에서 기준선을 확정하면 분기별 차이가 여기에 표시됩니다.</p>
              ) : view.baseline_variance.status === "no_scorecard_cycle" ? (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기준선은 확정되었으나 아직 스코어카드 분기 기록이 없습니다 — 아래 안착 지표를 기록하면 차이가 계산됩니다.</p>
              ) : (
                <>
                  <p className="text-[length:var(--fs-caption)] mb-1">
                    분기 {view.baseline_variance.review_cycle} · 기준선 확정 {view.baseline_variance.baseline_confirmed_at?.slice(0, 10)} ·
                    {" "}계획대로 {view.baseline_variance.summary.on_plan} · 뒤처짐 {view.baseline_variance.summary.behind} · 앞섬 {view.baseline_variance.summary.ahead} · 근거 부족 {view.baseline_variance.summary.insufficient_evidence}
                  </p>
                  <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                    <table className="data-table table-fixed-pct tmin-48" aria-label="실행 기준선 대비 차이">
                      <caption className="sr-only">실행 기준선 대비 차이</caption>
                      <ColGroup widths={VARIANCE_COL_PCT} />
                      <thead><tr><th>항목</th><th className="col-num">기준선</th><th className="col-num">실적</th><th className="col-num">차이</th><th>판정</th></tr></thead>
                      <tbody>{view.baseline_variance.rows.map((r) => (
                        <tr key={`${r.area}:${r.key}`}>
                          <td title={r.note ?? undefined}>{r.label}{r.comparison === "higher_is_better_assumed" && <span className="note ml-1" title="방향 정보가 없어 높을수록 좋은 것으로 읽었습니다">(↑ 가정)</span>}</td>
                          <td className="col-num tabular-nums">{r.baseline ?? "—"}</td>
                          <td className="col-num tabular-nums">{r.actual ?? "—"}</td>
                          <td className="col-num tabular-nums">{r.variance != null ? `${r.variance > 0 ? "+" : ""}${r.variance}` : "—"}</td>
                          <td>{r.status === "on_plan" ? <span className="status-chip status-green">계획대로</span> : r.status === "behind" ? <span className="status-chip status-amber">뒤처짐</span> : r.status === "ahead" ? <span className="status-chip status-green">앞섬</span> : <span className="status-chip status-not-started">근거 부족</span>}</td>
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
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">전환 결정 용어 — 신규 사업에서의 뜻</summary>
            <ul className="sizing-note-list mt-1" aria-label="신규 사업 전환 결정 용어">
              {Object.entries(GREENFIELD_TRANSITION_HELP).map(([k, text]) => (
                <li key={k}><strong>{TRANSITION_DECISION_LABEL[k] ?? k}</strong>: {text}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {integ && (
        <div className="mt-3" data-testid="pm-integration">
          <h4 className="text-[length:var(--fs-body)] mb-1">통합 모니터링 — 인수 후 시너지·핵심인력 (읽기 전용)</h4>
          <ParamTable
            caption="통합 모니터링 요약"
            valueAlign="end"
            rows={[
              { label: "시너지 인증 건수", value: integ.synergy.certifications.toLocaleString("ko-KR"), unit: "건" },
              { label: "최신 시너지 런레이트", value: integ.synergy.latest ? `${bpToPercent(integ.synergy.latest.run_rate_bp)} (${integ.synergy.latest.sustained_quarters}분기 지속)` : "—", source: integ.synergy.latest ? `서명 ${integ.synergy.latest.signed_at.slice(0, 10)}` : undefined },
              { label: "핵심인력 재직", value: integ.key_talent.active.toLocaleString("ko-KR"), unit: "명" },
              { label: "아쉬운 퇴사", value: integ.key_talent.departed_regretted.toLocaleString("ko-KR"), unit: "명" },
              { label: "계획된 퇴사·이동", value: integ.key_talent.departed_planned.toLocaleString("ko-KR"), unit: "명" },
              { label: "핵심인력 잔존율", value: retentionText(integ.key_talent.retention_pct) },
            ]}
          />
        </div>
      )}

      {partner && (
        <div className="mt-3" data-testid="pm-partnership">
          <h4 className="text-[length:var(--fs-body)] mb-1">전략 제휴 모니터링 — JV·제휴 조건과 성과 (읽기 전용)</h4>
          <p className="text-[length:var(--fs-caption)] mb-1">
            기록된 JV 조건 {partner.jv_terms.toLocaleString("ko-KR")}건
            {partner.review_cycle && <span className="status-chip status-not-started ml-2">리뷰 주기 {partner.review_cycle}</span>}
          </p>
          {partner.measures.length > 0 ? (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-32" aria-label="전략 제휴 측정">
                <caption className="sr-only">최신 주기의 전략 제휴 측정</caption>
                <ColGroup widths={PARTNER_MEASURE_COL_PCT} />
                <thead><tr><th scope="col">구분</th><th scope="col">측정</th><th scope="col">상태</th></tr></thead>
                <tbody>
                  {partner.measures.map((m, i) => {
                    const st = measureStatus(m.status);
                    return (
                      <tr key={`${m.section}-${m.measure_key}-${i}`}>
                        <td>{m.section === "financial" ? "재무" : m.section === "strategic" ? "전략" : m.section}</td>
                        <td>{m.measure_key}</td>
                        <td><span className={`status-chip ${st.cls}`}>{st.icon} {st.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">아직 기록된 전략 제휴 측정이 없습니다.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Column shares (%): key, actual, target, status, evidence, observed, remove. */
const FORM_COL_PCT = [22, 10, 10, 16, 22, 12, 8] as const;
const STATUS_OPTION_LABEL: Record<string, string> = { on_target: "목표 달성", deviation: "이탈", insufficient_evidence: "근거 부족" };

/** S12 안착 지표 기록 — human-only greenfield scorecard cycle. A collapsed disclosure; the server stays the authority. */
function ScorecardForm({ projectId, ramp, onRecorded }: { projectId: string; ramp: GreenfieldRampUp; onRecorded: () => Promise<void> }) {
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
      setSuccess(`${r.data.review_cycle} 주기의 측정 ${r.data.measures}건을 기록했습니다. 목표 대비 값은 참고 증적이며 판정은 사람이 합니다.`); // INTERIM-WORDING
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
      <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">S12 안착 지표 기록</summary>
      <div className="mt-2">
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          신규 사업의 한 리뷰 주기에 해당하는 측정을 한 번에 기록합니다. 기록한 주기는 바꿀 수 없고, 같은 지표를 다음 분기에 다시 기록하려면 새 분석 실행이 필요합니다.
          값은 참고 증적이며 합격·불합격 판정이 아닙니다.
        </p>
        <div className="flex flex-wrap gap-3 mb-2">
          <label className="text-[length:var(--fs-caption)]" htmlFor="pm-sc-cycle">
            <span className="block mb-1">리뷰 주기</span>
            <input id="pm-sc-cycle" className="sizing-new-input" value={cycle} placeholder="2026-Q4" onChange={(e) => setCycle(e.target.value)} />
          </label>
          <label className="text-[length:var(--fs-caption)]" htmlFor="pm-sc-class">
            <span className="block mb-1">벤처 클래스 (기본값: {ventureClassText(def)})</span>
            <select id="pm-sc-class" className="sizing-new-input" value={vclass} onChange={(e) => setVclass(e.target.value)}>
              {VENTURE_CLASS_VALUES.map((c) => <option key={c} value={c}>{ventureClassText(c)}</option>)}
            </select>
          </label>
        </div>
        {override && (
          <div className="mb-2">
            <label className="text-[length:var(--fs-caption)] block" htmlFor="pm-sc-note">기본값과 다르게 지정하는 사유 (필수)</label>
            <textarea id="pm-sc-note" className="sizing-new-input mt-1 w-full" rows={3} maxLength={SCORECARD_FORM_LIMITS.note} required aria-required="true"
              value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              기본값과 다른 클래스는 변경 이력(누가, 언제, 사유)이 감사 기록에 남습니다.
            </p>
          </div>
        )}

        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-48" aria-label="기록할 측정 지표">
            <caption className="sr-only">이번 리뷰 주기에 기록할 측정 지표</caption>
            <ColGroup widths={FORM_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">지표</th><th scope="col">실적</th><th scope="col">목표</th><th scope="col">상태</th>
                <th scope="col">증적 참조</th><th scope="col">관측일</th><th scope="col"><span className="sr-only">삭제</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.uid}>
                  <td>
                    <select aria-label={`${i + 1}번째 지표 키`} className="sizing-new-input w-full" value={r.measure_key} onChange={(e) => patch(r.uid, { measure_key: e.target.value })}>
                      <option value="">선택…</option>
                      {keys.map((k) => <option key={k} value={k}>{k}</option>)}
                      {ramp.goals.map((g) => <option key={g.goal_id} value={`goal:${g.metric_key}`}>goal:{g.metric_key}</option>)}
                      <option value={CUSTOM_GOAL_OPTION}>사업 목표 직접 입력 (goal:…)</option>
                    </select>
                    {r.measure_key === CUSTOM_GOAL_OPTION && (
                      <input aria-label={`${i + 1}번째 사업 목표 키`} className="sizing-new-input w-full mt-1" placeholder="metric_key" value={r.custom_goal} onChange={(e) => patch(r.uid, { custom_goal: e.target.value })} />
                    )}
                  </td>
                  <td><input type="number" step="any" aria-label={`${i + 1}번째 실적`} className="sizing-new-input w-full" value={r.value} onChange={(e) => patch(r.uid, { value: e.target.value })} /></td>
                  <td><input type="number" step="any" aria-label={`${i + 1}번째 목표`} className="sizing-new-input w-full" value={r.target_value} onChange={(e) => patch(r.uid, { target_value: e.target.value })} /></td>
                  <td>
                    <select aria-label={`${i + 1}번째 상태`} className="sizing-new-input w-full" value={r.status} onChange={(e) => patch(r.uid, { status: e.target.value })}>
                      {MEASURE_STATUS_VALUES.map((s) => <option key={s} value={s}>{STATUS_OPTION_LABEL[s]}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={`${i + 1}번째 증적 참조`} title={EVIDENCE_REF_HINT} placeholder="doc:… / src:… / https://…" maxLength={SCORECARD_FORM_LIMITS.evidence_ref} className="sizing-new-input w-full" value={r.evidence_ref} onChange={(e) => patch(r.uid, { evidence_ref: e.target.value })} /></td>
                  <td><input type="date" aria-label={`${i + 1}번째 관측일`} className="sizing-new-input w-full" value={r.observed_at} onChange={(e) => patch(r.uid, { observed_at: e.target.value })} /></td>
                  <td>
                    <button type="button" className="btn-ghost btn-sm" disabled={rows.length <= 1 || busy} aria-label={`${i + 1}번째 지표 삭제`} onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">증적 참조 형식: {EVIDENCE_REF_HINT}. 실적·목표가 비어 있으면 상태는 '근거 부족'이어야 합니다.</p>

        <div className="flex gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" disabled={busy || rows.length >= SCORECARD_FORM_LIMITS.measures * 2} onClick={() => setRows((rs) => [...rs, emptyMeasureDraft(nextUid())])}>+ 지표 추가</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void submit()}>{busy ? "기록 중…" : "이 주기 기록"}</button>
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
