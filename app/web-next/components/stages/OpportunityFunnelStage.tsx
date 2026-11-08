"use client";

// S2 기회 발굴 본문 — ADR-0120 Wave 2 Phase A 추출(/opportunities 페이지와
// /deals/[id]/s2 탭이 동일 컴포넌트를 소비한다). StageFrame과 main 셸은 호출자가
// 제공한다(공통 규칙 #6). opportunityId가 주어지면(deals 탭 진입) 퍼널에서 해당
// 기회 행을 표시한다 — 검토/안건의 캐리어가 어떤 기회인지 목록에서 바로 보이게.
//
// 레이아웃 원칙(ADR-0127): 목록 행은 경량 퍼널(상태·점수·대표 액션)로 유지하고,
// 평가·요인·비즈니스 모델 검토 작업은 상세 화면(/opportunities/{id})에서 한다.
// 행 액션은 선별·제외·비즈니스 모델 검토·삭제만 둔다. S3 시너지·전략적 적합성은
// 상세 화면에서 S3 화면(/synergy)으로 이동하는 링크로 안내한다.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { useConfirm } from "../crud.tsx";
import { SectionToolbar } from "../layout.tsx";
import { ColGroup } from "../ui.tsx";
import {
  AttractivenessEditor,
  AttractivenessReEvaluateToggle,
  attractivenessToggleId,
  canReEvaluateAttractiveness,
} from "../AttractivenessReEvaluate.tsx";
import { isDegeneratePct, NOT_COMPUTABLE_TEXT, SYNTHETIC_BADGE_TEXT } from "../../lib/synthetic-value.ts";
import type { TranslatorFn } from "../../i18n/config.ts";
import { useTranslations } from "next-intl";

/** Column shares (%) in header order: status, name, attractiveness, synergy, actions. */
const FUNNEL_COL_PCT = [14, 34, 12, 16, 24] as const;

interface OpportunityRow {
  id: string;
  project_id: string | null;
  name: string;
  market_scope: string | null;
  industry_id: string | null;
  value_chain_node: string | null;
  market_size_krw_m: number | null;
  growth_rate: number | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  synergy_rationale: string | null;
  synergy_score_confirmed_at: string | null;
  /** S4 진출방식 결정 확정(현재 final 결정, API route_confirmed) — selected 재평가 가시성 판단. */
  route_confirmed?: number | boolean | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  rationale: string | null;
  created_by: string;
  created_at: string;
}

// 라벨은 카탈로그 키 — 렌더 시 TranslatorFn으로 푼다.
const COLUMNS: Array<{ status: OpportunityRow["status"]; label: string }> = [
  { status: "identified", label: "stages.s2.stage.discovery" },
  { status: "assessed", label: "stages.s2.stage.evaluation" },
  { status: "selected", label: "common.shortlist" },
  { status: "dropped", label: "common.exclude" },
];

// S1 시장분석 인사이트 — 기회 발굴·평가의 입력(market-sizing 5-B).
interface SizingInsight {
  analysis_id: string;
  industry_id: string;
  industry_name: string;
  completed_at: string | null;
  bottom_up_cagr_pct: number | null;
  synthetic?: boolean;
  escalated_cagr_pct: number | null;
  external_forecast: {
    source_label: string;
    target_year: number;
    external_size_b: number;
    our_size_b: number | null;
    gap_pct: number | null;
    gap_analysis: string | null;
    new_drivers: string[];
  } | null;
  opportunity_factors: string[];
  risk_factors: string[];
}

/**
 * 행 액션 — 매력도 평가(입력 있는 실제 평가 UI)·S3 시너지·적합성 평가·선별
 * 승격·비즈니스 모델 검토는 모두 상세 화면(/opportunities/{id})과 그 안에서
 * 이어지는 /synergy(S4로 진행 버튼, 시너지 근거 포함 승격)에서만 이루어진다.
 * 목록의 상태 전환 단축 버튼(구 "매력도 평가"/"선별"/"제외")은 실제 평가
 * 없이 상태만 바꾸는 중복 경로였다 — 제거하고 상세 화면 링크 하나로 통일
 * (삭제는 별도 셀, ADR-0127).
 */
function nextStepActions(o: OpportunityRow, t: TranslatorFn) {
  return (
    <>
      {/* R2-A item 5: every row advances ITS OWN opportunity — the header primary
          acts on the deal you entered through, which is a different row. */}
      {o.status === "identified" && (
        <Link
          className="btn-ghost btn-sm"
          href={`/opportunities/${encodeURIComponent(o.id)}?focus=score`}
          title={t("evaluateThisOpportunitySAttractiveness")}
        >
          {t("attractivenessEvaluation")}
          <span className="sr-only"> — {o.name}</span>
        </Link>
      )}
      {(o.status === "assessed" || o.status === "selected") && (
        <Link
          className="btn-ghost btn-sm"
          href={`/deals/${encodeURIComponent(o.id)}/s3`}
          title={t("proceedToThisOpportunityS")}
        >
          {t("proceedToS3")}
          <span className="sr-only"> — {o.name}</span>
        </Link>
      )}
      <Link
        className="btn-ghost btn-sm"
        href={`/opportunities/${encodeURIComponent(o.id)}?tab=sketch`}
        title={t("goesToTheBusinessModel")}
      >
        {t("businessModelReview")}
      </Link>
    </>
  );
}

/**
 * `startRegister` — land with the registration form open, scrolled into view and
 * focused (R2-A item 7): "known_target" additionally moves the form to the top of the
 * page; both focus the first field (the opportunity name).
 */
export function OpportunityFunnelStage({
  opportunityId,
  startRegister,
}: {
  opportunityId?: string;
  startRegister?: "name" | "known_target";
}) {
  const tr = useTranslations();
  const t = useTranslations("stages.s2.stage");
  const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState<SizingInsight[] | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    market_scope: "",
    value_chain_node: "",
    attractiveness_score: "",
    industry_id: "",
    known_target: "",
  });

  // KPI 클릭 = 상태 필터 (재클릭 해제)
  const [statusFilter, setStatusFilter] = useState<OpportunityRow["status"] | "">("");

  // S2 activities 상태 — 상세 작업은 /opportunities/{id} 화면으로 이동 (ADR-0127)
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"attractiveness" | "recent">("attractiveness");
  const [industryFilter, setIndustryFilter] = useState<string | "">("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  // Known-target entry (?known_target=1) moves the form to the top; any other open focuses the name field.
  const [knownTargetMode, setKnownTargetMode] = useState(startRegister === "known_target");
  const [discoverNotice, setDiscoverNotice] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // 재평가 편집기 — 행 id별 열림 상태. 편집기는 행 아래 전폭 하위 행에 그린다.
  const [reEvalOpenIds, setReEvalOpenIds] = useState<ReadonlySet<string>>(new Set());
  const toggleReEvaluate = (id: string) =>
    reEvalOpenIds.has(id) ? closeReEvaluate(id) : setReEvalOpenIds((prev) => new Set(prev).add(id));
  const closeReEvaluate = (id: string) => {
    setReEvalOpenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // 닫으면 포커스를 토글로 되돌린다 (편집기가 사라지며 포커스를 잃지 않게).
    requestAnimationFrame(() => document.getElementById(attractivenessToggleId(`opp-score-input-${id}`))?.focus());
  };

  // 재평가 가능 여부 — assessed, 또는 selected(S4 확정 전·프로젝트 승격 전).
  const reEvaluable = (o: OpportunityRow) =>
    canReEvaluateAttractiveness(o.status, canAct, { s4Confirmed: !!o.route_confirmed, hasProject: !!o.project_id });

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is refetched via useEffect(load, [load]) — adding tc would recreate load on translator identity churn and refetch on every locale re-render; tc is read at call time
  const load = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    api
      .get<OpportunityRow[]>(`/api/opportunities${qs}`)
      .then((r) => setRows(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
  }, [statusFilter]);

  // ?status= 딥링크는 유지 (?opportunity= 펼침은 상세 화면 분리로 폐지 — ADR-0127)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only deep-link parse — re-running on startRegister change would re-open the create form mid-session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("known_target") === "1" || startRegister === "known_target") {
      setKnownTargetMode(true);
      setShowCreateForm(true);
    } else if (params.get("new") === "1" || startRegister === "name") {
      setShowCreateForm(true);
    }
    const initial = params.get("status");
    if (initial && ["identified", "assessed", "selected", "dropped"].includes(initial)) {
      setStatusFilter(initial as OpportunityRow["status"]);
    }
  }, []);

  useEffect(load, [load]);

  // R2-A item 7 / walkthrough F9: opening the form scrolls it into view and focuses its field
  // (previously the form opened far below the fold with focus left on the button).
  useEffect(() => {
    if (!showCreateForm) return;
    const t = setTimeout(() => {
      const el = document.getElementById("opp-new-name");
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [showCreateForm]);

  useEffect(() => {
    api
      .get<{ insights: SizingInsight[] }>("/api/market-overview/insights")
      .then((r) => setInsights(r.data.insights))
      .catch(() => setInsights([]));
  }, []);

  // Wave C-3 (D-3): link an existing opportunity to an analysed S1 industry
  // (PUT industry_id) so the S1 predicate can find the market-sizing matrix.
  async function linkIndustry(o: OpportunityRow, industryId: string) {
    setError(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(o.id)}`, { industry_id: industryId });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLinkTheIndustry"));
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string; known_target_id: string | null }>("/api/opportunities", {
        name: form.name,
        market_scope: form.market_scope || undefined,
        value_chain_node: form.value_chain_node || undefined,
        attractiveness_score: form.attractiveness_score ? Number(form.attractiveness_score) : undefined,
        industry_id: form.industry_id || undefined,
        known_target: form.known_target.trim() ? { company_name: form.known_target.trim() } : undefined,
      });
      setForm({
        name: "",
        market_scope: "",
        value_chain_node: "",
        attractiveness_score: "",
        industry_id: "",
        known_target: "",
      });
      setShowCreateForm(false);
      // 알려진 대상으로 시작한 경우 — 안내(S1~S4)가 있는 상세 화면으로 이동한다.
      if (created.data.known_target_id) {
        window.location.assign(`/opportunities/${encodeURIComponent(created.data.id)}`);
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("errors.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  // ── S2 activity: opportunity-discovery ──
  async function discoverOpportunities(industry: string) {
    if (discovering) return;
    setDiscovering(industry);
    setError(null);
    try {
      const res = await api.post<{ inserted: Array<{ name: string }>; source: string }>("/api/opportunities/discover", {
        industry,
      });
      load();
      setDiscoverNotice(
        t("p1OpportunityIesDiscoveredP2", {
          p1: res.data.inserted.length,
          p2: res.data.source === "llm" ? "AI" : t("deterministicSynthesis"),
          p3: res.data.inserted.length ? `: ${res.data.inserted.map((o) => o.name).join(", ")}` : "",
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("opportunityDiscoveryFailed"));
    } finally {
      setDiscovering(null);
    }
  }

  // 기회 삭제 — 테스트·오등록 정리용. 검토/안건으로 승격된 기회(project_id 연계)는
  // 서버에서도 차단되며, S4+ 단계 연계가 있으면 삭제가 거부된다.
  function deleteOpportunity(o: OpportunityRow) {
    confirm(
      t("deleteOpportunityP1", { p1: o.name }),
      async () => {
        setError(null);
        try {
          await api.delete(`/api/opportunities/${o.id}`);
          setRows((prev) => (prev ? prev.filter((r) => r.id !== o.id) : prev));
        } catch (err) {
          setError(err instanceof Error ? err.message : t("failedToDeleteTheOpportunity"));
        }
      },
      { body: t("thisOpportunityAndItsEvaluation") },
    );
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: rows?.length ?? 0, identified: 0, assessed: 0, selected: 0, dropped: 0 };
    for (const r of rows ?? []) c[r.status]++;
    return c;
  }, [rows]);

  const industries = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.market_scope) set.add(r.market_scope);
    return [...set];
  }, [rows]);
  const sortedRows = useMemo(() => {
    const list = (rows ?? []).filter((r) => !industryFilter || r.market_scope === industryFilter);
    if (sortKey === "attractiveness") {
      list.sort((a, b) => (b.attractiveness_score ?? -1) - (a.attractiveness_score ?? -1));
    } else {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return list;
  }, [rows, sortKey, industryFilter]);

  const selectedInsight = insights?.find((s) => s.industry_name === selectedIndustry) ?? null;

  const registerSection = (
    <>
      {canAct && (
        <section aria-label={t("registerOpportunityManually")} className="market-section">
          <SectionToolbar
            title={t("registerOpportunityDirectly")}
            icon="✍️"
            actions={
              <button
                type="button"
                className="btn-ghost whitespace-nowrap"
                onClick={() => setShowCreateForm((v) => !v)}
                aria-expanded={showCreateForm}
              >
                {t("registerOpportunityDirectly2")}
              </button>
            }
          />
          {showCreateForm && (
            <form onSubmit={create} className="sizing-new-form mb-3">
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                {t("knownTargetCompaniesAreAs")}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("opportunityName")}</span>
                  <input
                    id="opp-new-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    className="sizing-new-input"
                  />
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("marketScope")}</span>
                  <input
                    value={form.market_scope}
                    onChange={(e) => setForm({ ...form, market_scope: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                  />
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("knownTargetCompaniesOptional")}</span>
                  <input
                    id="opp-known-target"
                    value={form.known_target}
                    onChange={(e) => setForm({ ...form, known_target: e.target.value })}
                    placeholder={t("whenTheAcquisitionTargetIs")}
                    className="sizing-new-input sizing-new-input-sm"
                  />
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("s1AnalyzedIndustries")}</span>
                  <select
                    value={form.industry_id}
                    onChange={(e) => setForm({ ...form, industry_id: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                  >
                    <option value="">{t("doNotLink")}</option>
                    {(insights ?? []).map((i) => (
                      // key는 산업+분석 복합 — 서버 dedupe 전 데이터에서도 중복 키가 없게 (방어선)
                      <option key={`${i.industry_id}:${i.analysis_id}`} value={i.industry_id}>
                        {i.industry_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("valueChainNode")}</span>
                  <input
                    value={form.value_chain_node}
                    onChange={(e) => setForm({ ...form, value_chain_node: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                  />
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("attractiveness")}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.attractiveness_score}
                    onChange={(e) => setForm({ ...form, attractiveness_score: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                  />
                </label>
                <button type="submit" className="btn-ghost" disabled={busy || !form.name.trim()}>
                  {busy ? tc("registering") : tc("register")}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setShowCreateForm(false)}>
                  {tc("cancel")}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  );

  return (
    <>
      {confirmDialog}
      {knownTargetMode && canAct && (
        <div className="focus-banner" role="note">
          <strong>{t("startWithAKnownTarget")}</strong> {t("registerWithTheOpportunityName")}
        </div>
      )}
      {knownTargetMode && registerSection}
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {opportunityId && (
        <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S2")} />
      )}

      {/* ── KPI 요약 (클릭 = 상태 필터) ── */}
      <div className="summary-cards mb-4">
        {(
          [
            ["", tc("all"), counts.total],
            ["identified", t("discovery2"), counts.identified],
            ["assessed", t("evaluation2"), counts.assessed],
            ["selected", tc("shortlist"), counts.selected],
            ["dropped", tc("exclude"), counts.dropped],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={label}
            type="button"
            aria-pressed={statusFilter === key}
            className={`summary-card glass text-left ${statusFilter === key ? "border-[color:var(--accent)]" : ""}`}
            onClick={() =>
              setStatusFilter(
                statusFilter === key || key === ""
                  ? key === ""
                    ? ""
                    : (key as OpportunityRow["status"])
                  : (key as OpportunityRow["status"]),
              )
            }
          >
            <span className="summary-value mono-num">{count}</span>
            <span className="text-label">{label}</span>
          </button>
        ))}
      </div>

      {discoverNotice && (
        <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-body)] mb-2">
          {discoverNotice}
        </p>
      )}

      {/* ── 분석된 산업 (S1 연동, 접힘) ── */}
      <section aria-label={t("analyzedIndustries")} className="market-section">
        <div className="section-toolbar">
          <span className="section-title">
            <h2>{t("analyzedIndustriesPickOneTo")}</h2>
          </span>
        </div>
        {insights !== null && insights.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {insights.map((s) => (
              <button
                key={s.analysis_id}
                type="button"
                aria-pressed={selectedIndustry === s.industry_name}
                className={`sizing-industry-chip ${selectedIndustry === s.industry_name ? "sizing-industry-chip-active" : ""}`}
                onClick={() => setSelectedIndustry(selectedIndustry === s.industry_name ? null : s.industry_name)}
              >
                <span className="font-semibold">{s.industry_name}</span>
                <span className="sizing-chip-meta">
                  CAGR {isDegeneratePct(s.bottom_up_cagr_pct) ? NOT_COMPUTABLE_TEXT : `${s.bottom_up_cagr_pct}%`}
                  {s.synthetic && <span className="status-chip status-amber ml-1">{SYNTHETIC_BADGE_TEXT}</span>}
                  {s.escalated_cagr_pct !== null && (
                    <span title={t("cagrExternalReference085")}>
                      {" "}
                      {t("escalation")} {s.escalated_cagr_pct}%
                    </span>
                  )}
                  {s.external_forecast?.gap_pct != null
                    ? t("gapP1P2", { p1: s.external_forecast.gap_pct > 0 ? "+" : "", p2: s.external_forecast.gap_pct })
                    : ""}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
            {t("noCompletedMarketAnalysis")}{" "}
            <Link
              href={opportunityId ? `/deals/${encodeURIComponent(opportunityId)}/s1` : "/market"}
              className="text-[color:var(--accent)] underline"
            >
              {t("marketAnalysisS1")}
            </Link>
            {t("analyzeIndustriesThereFirst")}
          </p>
        )}

        {/* 선택 산업: 발굴 버튼 + 요약 인사이트 (접힘) */}
        {selectedInsight && (
          <div className="sizing-new-form mt-3">
            {/* CAGR·격차는 위 칩에 이미 표시된다 — 선택된 산업명만 다시
                밝혀 어느 칩을 눌렀는지 스크롤 후에도 알 수 있게 한다. */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <strong className="text-[length:var(--fs-body)]">{selectedInsight.industry_name}</strong>
              {canAct && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  style={{ marginLeft: "auto" }} /* lint-exempt: 폼 내부 헤더(SectionToolbar 외부 컨텍스트) */
                  disabled={discovering !== null}
                  title={t("automaticallyDiscoversOpportunityCandidatesFrom")}
                  onClick={() => discoverOpportunities(selectedInsight.industry_name)}
                >
                  {discovering === selectedInsight.industry_name
                    ? t("discoveringOpportunities")
                    : t("opportunityDiscoveryAutomaticFactorDerivation")}
                </button>
              )}
            </div>
            <details>
              <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("insightDetailsOpportunityAndRisk")}
              </summary>
              <div className="chart-pair mt-2">
                <div className="chart-half sizing-grade-card">
                  <h4 className="text-[length:var(--fs-body)] mb-2">{t("opportunityFactor")}</h4>
                  <ul className="sizing-note-list">
                    {(selectedInsight.opportunity_factors.length
                      ? selectedInsight.opportunity_factors
                      : [t("analysisNeedsReinforcement")]
                    ).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
                <div className="chart-half sizing-grade-card">
                  <h4 className="text-[length:var(--fs-body)] mb-2">{t("riskFactor")}</h4>
                  <ul className="sizing-note-list">
                    {(selectedInsight.risk_factors.length
                      ? selectedInsight.risk_factors
                      : [t("analysisNeedsReinforcement2")]
                    ).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {selectedInsight.external_forecast?.gap_analysis && (
                    <p className="mt-2 mb-0 text-[length:var(--fs-caption)] whitespace-pre-line">
                      {selectedInsight.external_forecast.gap_analysis}
                    </p>
                  )}
                </div>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* ── 기회 퍼널 (리스트 + 행 펼침 평가 패널) ── */}
      <section aria-label={t("opportunityFunnel")} className="market-section">
        <SectionToolbar
          title={t("opportunityFunnel2")}
          icon=""
          count={sortedRows.length}
          filters={
            <>
              <span className="section-meta">
                {statusFilter
                  ? t("p1Filter", {
                      p1: (() => {
                        const col = COLUMNS.find((c) => c.status === statusFilter);
                        return col?.label ? tr(col.label) : statusFilter;
                      })(),
                    })
                  : ""}
              </span>
              {/* biome-ignore lint/a11y/useSemanticElements: control-chip toolbar group — a fieldset would change the toolbar DOM/styling shared across stage toolbars */}
              <span role="group" aria-label={t("industryFilter")} className="flex flex-wrap gap-1">
                <button
                  type="button"
                  aria-pressed={industryFilter === ""}
                  className={`control-chip ${industryFilter === "" ? "status-green" : "status-not-started"}`}
                  onClick={() => setIndustryFilter("")}
                >
                  {t("allIndustries")}
                </button>
                {industries.map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    aria-pressed={industryFilter === ind}
                    className={`control-chip ${industryFilter === ind ? "status-green" : "status-not-started"}`}
                    onClick={() => setIndustryFilter(ind)}
                  >
                    {ind}
                  </button>
                ))}
              </span>
            </>
          }
          actions={
            <>
              {canAct && (
                <button
                  type="button"
                  className="btn-ghost btn-sm whitespace-nowrap"
                  onClick={() => setShowCreateForm((v) => !v)}
                  aria-expanded={showCreateForm}
                >
                  {t("registerOpportunity")}
                </button>
              )}
              {/* biome-ignore lint/a11y/useSemanticElements: control-chip toolbar group — a fieldset would change the toolbar DOM/styling shared across stage toolbars */}
              <span role="group" aria-label={t("sort")} className="flex gap-1">
                {(
                  [
                    ["attractiveness", t("byAttractiveness")],
                    ["recent", t("newestFirst")],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={sortKey === key}
                    className={`control-chip ${sortKey === key ? "status-green" : "status-not-started"}`}
                    onClick={() => setSortKey(key)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </>
          }
        />
        {rows === null ? (
          <p>{tc("loading")}</p>
        ) : sortedRows.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
            {statusFilter ? t("noOpportunitiesMatchTheFilter") : t("noOpportunitiesRegisteredStartOpportunity")}
          </p>
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: house table-scroll pattern shared with the other stage tables (keyboard-scrollable region, WCAG 2.1)
          // biome-ignore lint/a11y/noNoninteractiveTabindex: tabIndex 0 is what makes the scroll region keyboard-operable
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table
              className="data-table list-table list-wide table-fixed-pct tmin-56 opp-funnel-table"
              aria-label={t("opportunityFunnelList")}
            >
              <caption className="sr-only">{t("opportunityFunnelList2")}</caption>
              <ColGroup widths={FUNNEL_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{tc("status")}</th>
                  {/* 열 폭은 FUNNEL_COL_PCT(%)가 정한다 — 기회명 칸은 넘치면 말줄임(…) 처리한다. */}
                  <th scope="col">{t("opportunityName2")}</th>
                  <th scope="col">{t("attractiveness2")}</th>
                  <th scope="col">{t("synergy")}</th>
                  <th scope="col">
                    <span className="sr-only">{tc("actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((o) => (
                  <Fragment key={o.id}>
                    <tr aria-current={o.id === opportunityId ? "true" : undefined}>
                      <td>
                        <span
                          className={`status-chip ${o.status === "selected" ? "status-green" : o.status === "dropped" ? "status-red" : o.status === "assessed" ? "status-amber" : "status-not-started"}`}
                        >
                          {(() => {
                            const col = COLUMNS.find((c) => c.status === o.status);
                            return col ? tr(col.label) : "";
                          })()}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/opportunities/${encodeURIComponent(o.id)}`}
                          className="block cell-truncate font-semibold text-left underline-offset-2 hover:underline"
                          title={o.name}
                        >
                          {o.name}
                        </Link>
                        {/* deals 탭에서 진입한 경우 — 이 검토/안건의 캐리어 기회를 표시 */}
                        {o.id === opportunityId && (
                          <span className="status-chip status-amber ml-1" title={t("thisIsTheCarrierOpportunity")}>
                            {t("thisDeal")}
                          </span>
                        )}
                        <span className="block text-[length:var(--fs-caption)]">
                          {o.market_scope && <span className="status-chip status-amber mr-1">{o.market_scope}</span>}
                          {o.value_chain_node && (
                            <span className="text-[color:var(--muted-fg)]">{o.value_chain_node}</span>
                          )}
                          {!o.market_scope && !o.value_chain_node && "—"}
                        </span>
                      </td>
                      <td className="tabular-nums">
                        {o.attractiveness_score ?? "—"}
                        {o.attractiveness_score !== null && o.status === "identified" && (
                          <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {tc("proposal")}
                          </span>
                        )}
                      </td>
                      <td className="tabular-nums">
                        {o.synergy_score ?? "—"}
                        {/* 경계 #2 — 파이프라인 권고와 사람 확정을 구분해 표시한다. */}
                        {o.synergy_score !== null &&
                          (o.synergy_score_confirmed_at ? (
                            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              {tc("confirmed")}
                            </span>
                          ) : (
                            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              {t("recommendationUnconfirmed")}
                            </span>
                          ))}
                      </td>
                      <td className="sizing-actions-cell">
                        <span className="actions-row">
                          {canAct && !o.project_id && insights && insights.length > 0 && (
                            // S1 연결 select는 폼 컨트롤이므로 이름 열이 아니라 작업 셀에서
                            // 편집한다(2026-10 표 인터랙션 리뷰 — 이름 열은 읽기 표면 유지).
                            <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                              <span className="whitespace-nowrap">{t("s1Link")}</span>
                              <select
                                aria-label={t("linkP1ToS1Analyzed", { p1: o.name })}
                                value={o.industry_id ?? ""}
                                onChange={(e) => void linkIndustry(o, e.target.value)}
                                className="sizing-new-input sizing-new-input-sm"
                              >
                                <option value="">{t("notLinked")}</option>
                                {insights.map((i) => (
                                  // key는 산업+분석 복합 — 서버 dedupe 전 데이터에서도 중복 키가 없게 (방어선)
                                  <option key={`${i.industry_id}:${i.analysis_id}`} value={i.industry_id}>
                                    {i.industry_name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {/* 평가(assessed)·선택(selected, S4 확정 전) 기회의 매력도 재평가 — 작업 칸에는 토글만 두고, 편집기(점수 입력·
                            AI 초안 제안 문구)는 아래 전폭 하위 행에 그린다. 좁은 칸에서 긴 문구가 표를 깨지 않게. */}
                          {reEvaluable(o) && (
                            <AttractivenessReEvaluateToggle
                              opportunityName={o.name}
                              open={reEvalOpenIds.has(o.id)}
                              onToggle={() => toggleReEvaluate(o.id)}
                              inputId={`opp-score-input-${o.id}`}
                            />
                          )}
                          {nextStepActions(o, t)}
                          {canAct && !o.project_id && (
                            <button
                              type="button"
                              className="btn-danger btn-sm"
                              title={t("deletesThisOpportunityOpportunitiesPromoted")}
                              onClick={() => deleteOpportunity(o)}
                            >
                              {tc("delete")}
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {reEvalOpenIds.has(o.id) && reEvaluable(o) && (
                      <tr>
                        <td colSpan={FUNNEL_COL_PCT.length} className="bg-[color:var(--muted-bg)]">
                          <AttractivenessEditor
                            opportunityId={o.id}
                            opportunityName={o.name}
                            status={o.status}
                            onSaved={load}
                            onClose={() => closeReEvaluate(o.id)}
                            autoDraft
                            autoFocus
                            inputId={`opp-score-input-${o.id}`}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!knownTargetMode && registerSection}
    </>
  );
}
