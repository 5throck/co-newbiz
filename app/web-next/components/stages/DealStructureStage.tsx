"use client";

// S10 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/deal-structure 페이지와
// /deals/[id]/s10 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.
// 탭 상태는 독립 페이지에서 URL ?tab= 동기, embedded(deals 탭) 모드에서는 내부 상태로
// 유지한다 — router로 프로젝트 페이지를 건드리지 않는다.

import { TranslatorFn } from "../../i18n/config.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { KO_DATA } from "../../lib/ko-data-values.ts";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { StageTabs } from "../StageTabs.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { PrimaryAction, useToast } from "../ui.tsx";
import { TabNav } from "../TabNav.tsx";
import { KO_GF_FUNDING_SOURCE_PRESETS, KO_GF_FUNDING_USE_PRESETS } from "../../lib/ko-data-values.ts";
import { GF_JV_STAKE_KEY, GF_VEHICLE_KEY, GF_HEADING_KEY, RECORD_KEY as RECORD_KEY_MAP } from "../../lib/label-keys.ts";
import { balanceView, buildHypothesisPayload, hypothesisFieldVisibility, type TrancheView } from "../../lib/greenfield-structure-view.ts";
import { CapexTrancheTable } from "./CapexTrancheTable.tsx";
import { useConfirm } from "../crud.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { EstablishmentModePanel } from "./EstablishmentModePanel.tsx";
import { useTranslations } from "next-intl";
import {
  BUSINESS_UNIT_FORMS, BUSINESS_UNIT_FORM_LABEL, BUSINESS_UNIT_NO_ISOLATION_NOTE, withBusinessUnitForm,
  type BusinessUnitForm, type ModeState,
} from "../../lib/establishment-mode-view.ts";

// S10 투자구조 설계 (flow.spec v2.2.0) — 투자 주체(direct/SPC/holdco/내부 스핀오프/JV)
// 결정과 ADR-0045 4대 축(절세 구조·책임 격리·재무 레버리지·엑싯 구조) 검토,
// 그리고 자금조달 자금 조달·사용 균형을 다룬다. 4축 검토 완료는 근거 아티팩트
// 참조가 필수인 별도 행위이고, 완료 술어는 "최신 가설 완료 + 조달=사용>0"이다.

interface HypothesisRow {
  id: string;
  asset_or_stock: string | null;
  stake_type: string | null;
  instrument_mix: string | null;
  vehicle: string | null;
  commercialization_path: string | null;
  tax_structure_note: string | null;
  liability_isolation_note: string | null;
  financing_leverage_note: string | null;
  exit_structure_note: string | null;
  four_axis_review_completed: number;
  hypothesized_by: string;
  hypothesized_at: string;
  rationale: string;
  four_axis_artifact_ref?: string | null;
  four_axis_reviewed_by?: string | null;
  four_axis_reviewed_at?: string | null;
}
interface FinancingEntry {
  id: string;
  kind: "source" | "use";
  name: string;
  amount_krw_m: number;
  note: string | null;
  evidence_kind: string | null;
  evidence_ref: string | null;
  created_by: string;
}
interface FinancingCertainty { source_lines: number; evidenced_lines: number; unevidenced_lines: number; evidenced_amount_krw_m: number; unevidenced_amount_krw_m: number; all_sources_evidenced: boolean }
const EVIDENCE_KIND_LABEL = (tr: TranslatorFn): Record<string, string> => ({ commitment_letter: "stages.s10.stage.commitmentLetter", internal_approval: "stages.s10.stage.internalFundingApproval", term_sheet: "stages.s10.stage.termSheet", subsidy_grant: "stages.s10.stage.subsidyGrant", other: "stages.s10.stage.other" });
const AXIS_FIELDS = ["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const;
interface View {
  hypotheses: HypothesisRow[];
  financing: { entries: FinancingEntry[]; totals: { sources: number; uses: number; balanced: boolean }; certainty?: FinancingCertainty };
}

const VEHICLE_LABEL = (tr: TranslatorFn): Record<string, string> => ({
  direct: "stages.s10.stage.directInvestment",
  spc: "stages.s10.stage.spcSpvSpecialPurposeEntity",
  holdco: "stages.s10.stage.viaHoldingCompanyHoldco",
  internal_venture_spinoff: "stages.s10.stage.internalVenture",
  jv: "stages.s10.stage.jointVentureJv",
});
// Korean labels for the stored enum values (display only; the stored values are unchanged).
const STAKE_LABEL = (tr: TranslatorFn): Record<string, string> => ({ full: "stages.s10.stage.fullAcquisition", majority: "stages.s10.stage.majorityStake", minority: "stages.s10.stage.minorityStake", joint_control: "stages.s10.stage.jointControl" });
const INSTRUMENT_LABEL = (tr: TranslatorFn): Record<string, string> => ({ primary: "stages.s10.stage.newShareSubscription", secondary: "stages.s10.stage.sharePurchase", mixed: "stages.s10.stage.mixOfNewAndExisting" });
const AXIS_LABEL = (tr: TranslatorFn): Record<string, string> => ({
  tax_structure_note: "stages.s10.stage.structure",
  liability_isolation_note: "stages.s10.stage.responsibilitySeparation",
  financing_leverage_note: "stages.s10.stage.financialLeverage",
  exit_structure_note: "stages.s10.stage.exitStructure",
});

function fmt(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

export function DealStructureStage({ projectId, embedded }: { projectId: string; embedded?: boolean }) {const tr = useTranslations(); const t = useTranslations("stages.s10.stage"); const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSync = !embedded;
  const [localTab, setLocalTab] = useState("scenarios");
  const tabParam = urlSync ? searchParams.get("tab") : null;
  const tab = tabParam === "reco" || tabParam === "financing" || tabParam === "capex" ? tabParam : "hypotheses";
  const setTab = (key: string) => {
    if (urlSync) router.replace(`/projects/${projectId}/deal-structure?tab=${key}`, { scroll: false });
    else setLocalTab(key);
  };
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const { toast } = useToast();
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [artifactRef, setArtifactRef] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const formRef = useRef<HTMLDetailsElement | null>(null);
  const [newHyp, setNewHyp] = useState({ vehicle: "", asset_or_stock: "", stake_type: "", instrument_mix: "", tax_structure_note: "", liability_isolation_note: "", financing_leverage_note: "", exit_structure_note: "", rationale: "" });
  const [newEntry, setNewEntry] = useState<{ kind: "source" | "use"; name: string; amount_krw_m: string; note: string; evidence_kind: string; evidence_ref: string }>({ kind: "source", name: "", amount_krw_m: "", note: "", evidence_kind: "", evidence_ref: "" });
  // ADR-0118 — S10 검토/안건구조 AI 추천(제안). 가설 등록은 사람의 행위다.
  interface DealStructureReco {
    source: "llm" | "synthesis";
    provider: string | null;
    note: string | null;
    manifest: string[];
    recommendation: {
      vehicle: string | null;
      stake_type: string | null;
      instrument_mix: string | null;
      four_axis: { tax_structure_note: string; liability_isolation_note: string; financing_leverage_note: string; exit_structure_note: string };
      rationale_draft: string;
      key_evidence: string[];
      cautions: string[];
    };
  }
  // ADR-0160: greenfield routes get the establishment-structure view (M&A-only fields hidden, capex tranches).
  const [isGf, setIsGf] = useState(false);
  const [tranches, setTranches] = useState<TrancheView[]>([]);
  const [reco, setReco] = useState<DealStructureReco | null>(null);
  // ADR-0167: the chosen establishment mode decides which structure section is shown.
  const [modeState, setModeState] = useState<ModeState | null>(null);
  const [buForm, setBuForm] = useState<BusinessUnitForm | "">("");
  const isBu = isGf && modeState?.active_mode === "business_unit";
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/deal-structure`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadInvestmentStructure")));
    // Track detection: greenfield_scope is null for brownfield / unrouted projects (brownfield view unchanged).
    api.get<{ greenfield_scope: unknown | null }>(`/api/projects/${encodeURIComponent(projectId)}/greenfield-scope`)
      .then((r) => {
        const gf = !!r.data.greenfield_scope;
        setIsGf(gf);
        if (gf) {
          api.get<{ tranches: TrancheView[] }>(`/api/projects/${encodeURIComponent(projectId)}/capex-tranches`)
            .then((t) => setTranches(t.data.tranches))
            .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheCapex")));
        }
      })
      .catch(() => setIsGf(false));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  /** Records the drafted structure hypothesis (the form's own submit; the header primary opens and focuses the form). */
  function saveStructure() {
    if (!newHyp.rationale.trim()) { setError(t("theRationaleIsRequired")); return; }
    // 사업부 신설 형태 has no DB field: it is recorded as a labelled prefix in the free-text 책임 격리 note, and no 설립 법인 형태 is sent.
    const form = isBu ? { ...newHyp, vehicle: "", liability_isolation_note: withBusinessUnitForm(newHyp.liability_isolation_note, buForm) } : newHyp;
    void post(buildHypothesisPayload(isGf, form), t("investmentStructureHypothesisRecorded"));
    setBuForm("");
    setFormOpen(false);
    setNewHyp({ vehicle: "", asset_or_stock: "", stake_type: "", instrument_mix: "", tax_structure_note: "", liability_isolation_note: "", financing_leverage_note: "", exit_structure_note: "", rationale: "" });
  }

  async function generateReco() {
    if (recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<DealStructureReco>(`/api/projects/${encodeURIComponent(projectId)}/deal-structure-recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : t("failedToGenerateRecommendation"));
    } finally {
      setRecoLoading(false);
    }
  }

  function applyReco() {
    if (!reco) return;
    const r = reco.recommendation;
    setNewHyp((h) => ({
      ...h,
      vehicle: r.vehicle ?? h.vehicle,
      // Greenfield: M&A-only suggestions (stake, instrument mix) are never copied into the form.
      stake_type: isGf ? h.stake_type : r.stake_type ?? h.stake_type,
      instrument_mix: isGf ? h.instrument_mix : r.instrument_mix ?? h.instrument_mix,
      tax_structure_note: r.four_axis.tax_structure_note !== KO_DATA.needsVerification ? r.four_axis.tax_structure_note : h.tax_structure_note,
      liability_isolation_note: r.four_axis.liability_isolation_note !== KO_DATA.needsVerification ? r.four_axis.liability_isolation_note : h.liability_isolation_note,
      financing_leverage_note: r.four_axis.financing_leverage_note !== KO_DATA.needsVerification ? r.four_axis.financing_leverage_note : h.financing_leverage_note,
      exit_structure_note: r.four_axis.exit_structure_note !== KO_DATA.needsVerification ? r.four_axis.exit_structure_note : h.exit_structure_note,
      rationale: r.rationale_draft || h.rationale,
    }));
  }

  async function post(body: Record<string, unknown>, successMsg?: string) {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/deal-structure`, body);
      if (successMsg) toast(successMsg);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function completeFourAxis(h: HypothesisRow) {
    const ref = (artifactRef[h.id] ?? "").trim();
    if (!ref) {
      setError(t("theP1ArtifactReferenceIs", { p1: tr(RECORD_KEY_MAP.deal_structure_review) }));
      return;
    }
    confirm(t("markReviewComplete"), () => { void post({ action: "complete_four_axis", hypothesis_id: h.id, artifact_ref: ref }); },
      { body: t("completionIsRecordedInThe") });
  }

  function addEntry() {
    const amount = Number(newEntry.amount_krw_m);
    if (!newEntry.name.trim() || !Number.isFinite(amount) || amount < 0) {
      setError(t("itemNameAndAnAmount"));
      return;
    }
    if ((newEntry.evidence_kind === "") !== (newEntry.evidence_ref.trim() === "")) {
      setError(t("recordTheDocumentationTypeAnd"));
      return;
    }
    void post({ action: "add_financing_entry", kind: newEntry.kind, name: newEntry.name.trim(), amount_krw_m: amount, note: newEntry.note || null, evidence_kind: newEntry.evidence_kind || null, evidence_ref: newEntry.evidence_ref.trim() || null });
    setNewEntry({ kind: newEntry.kind, name: "", amount_krw_m: "", note: "", evidence_kind: "", evidence_ref: "" });
  }

  // i18n (T3-6): GF vehicles resolve common.gfVehicle.* through the ROOT translator; non-GF keys resolve through the catalog too.
  const vehicleLabel = (v: string) => tr(isGf ? (GF_VEHICLE_KEY[v] ?? v) : (VEHICLE_LABEL(tr)[v] ?? v));
  const vis = hypothesisFieldVisibility(isGf, newHyp.vehicle);
  const axisLabel = (k: string) => (isGf && k === "tax_structure_note" ? t("taxAndRegionalIncentivesIncluding") : AXIS_LABEL(tr)[k]);
  const totals = data?.financing.totals;
  const balance = isGf ? balanceView(totals) : null;
  const diff = totals ? Math.round((totals.sources - totals.uses) * 10) / 10 : 0;

  return (
<>
      {/* 리뷰 2026-10-22 (사용자 리포트): StageTabs는 레일 슬롯으로 — h1·스트립이 탭 행
          아래로 밀리지 않고 S1~S7 딜 화면과 같은 머리 위치를 유지한다. */}
      <StageFrame
        stageId="S10"
        heading={isGf ? t("s10P1P2ReviewFunding", { p1: tr(GF_HEADING_KEY.s10Stage), p2: isBu ? tc("newDivisionForm") : tc("establishedEntityForm") }) : t("s10InvestmentStructureDesignInvesting")}
        railSlot={<StageTabs projectId={projectId} />}
      >
        {/* 3차 사용자 리포트: 종료… 제외 모든 컨트롤이 한 줄 — 검토 버킷과 1차 액션도
            프레임 머리(레일 슬롯 아래)에 둔다. */}
        <ReviewBuckets entityType="project" entityId={projectId} artifacts={stageArtifactTabs("S10")} />
        <PrimaryAction
          label={t("recordInvestmentStructureHypothesis")}
          onClick={() => {
            setTab("hypotheses");
            setFormOpen(true);
            window.setTimeout(() => {
              formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              formRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus({ preventScroll: true });
            }, 80);
          }}
          disabled={!canAct}
          disabledReason={t("recordingInvestmentStructureHypothesesRequires")}
        />
        {/* INTERIM-WORDING: "투자 주체"/"설립 법인 형태" replace the transliterated "vehicle" term */}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          {isGf ? (isBu ? tc("newDivisionForm") : t("establishedEntityFormIncludingSpc")) : t("investingEntityIncludingSpc")}{t("andReviewsTheFourAxes")}
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

        {isGf && <EstablishmentModePanel projectId={projectId} canAct={canAct} onState={setModeState} />}

        <TabNav
          className="mb-3"
          label={t("s10InvestmentStructureDesignScreen")}
          active={tab}
          onSelect={setTab}
          tabs={[
            ...(canAct ? [{ key: "reco", label: tc("aiRecommendation") }] : []),
            { key: "hypotheses", label: t("investmentStructureHypothesis"), count: data?.hypotheses.length },
            { key: "financing", label: t("fundingPlan") },
            ...(isGf ? [{ key: "capex", label: t("capexExecutionStage"), count: tranches.length }] : []),
          ]}
        />

        {/* ── AI 추천 검토/안건구조 (결정 지원) — ADR-0118: 제안은 LLM, 가설 등록은 사람 ── */}
        {tab === "reco" && canAct && (
          <section className="market-section sizing-step mb-3" aria-label={t("aiRecommendationReviewDealStructure")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("aiRecommendationReviewDealStructure2")}</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("principleBoundaryAPersonRegisters")}
            </p>
            {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
            {!reco && !recoLoading && !recoError && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button type="button" className="btn-ghost" onClick={() => void generateReco()}>{t("generateRecommendationAi")}</button>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{isGf ? tc("establishedEntityForm") : t("investingEntity")}{t("draftsTheStakeAndConsideration")}</span>
              </div>
            )}
            {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">{t("draftingFromTheAdoptedBc")}</p>}
            {reco && (
              <>
                <p className="mb-1 flex flex-wrap items-center gap-1">
                  <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                    {reco.source === "llm" ? t("aiRecommendationP1", { p1: reco.provider ? ` · ${reco.provider}` : "" }) : tc("deterministicFallback")}
                  </span>
                  {reco.recommendation.vehicle && <span className="status-chip status-amber">{vehicleLabel(reco.recommendation.vehicle)}</span>}
                  {!isGf && reco.recommendation.stake_type && <span className="status-chip status-not-started">{t("stake")} {STAKE_LABEL(tr)[reco.recommendation.stake_type] ?? reco.recommendation.stake_type}</span>}
                  {!isGf && reco.recommendation.instrument_mix && <span className="status-chip status-not-started">{t("considerationMix")} {INSTRUMENT_LABEL(tr)[reco.recommendation.instrument_mix] ?? reco.recommendation.instrument_mix}</span>}
                </p>
                {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{reco.note}</p>}
                {reco.recommendation.rationale_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">{t("structureEvidenceDraft")}</span> {reco.recommendation.rationale_draft}</p>}
                <table className="data-table mb-2" aria-label={t("noteDraft")}>
                  <caption className="sr-only">{t("noteDraft2")}</caption>
                  <tbody>
                    {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                      <tr key={k}>
                        <th scope="row" style={{ width: "8rem" }}>{axisLabel(k)}</th>
                        <td className="text-[length:var(--fs-caption)]">{reco.recommendation.four_axis[k]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {reco.recommendation.cautions.length > 0 && (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ {reco.recommendation.cautions.join(" / ")}</p>
                )}
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{tc("proposalArtifactColon")} {reco.manifest.join(" · ")}</p>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => confirm(t("applyTheAiRecommendationTo"), applyReco, {
                    body: t("fillsTheFormWithA"),
                    confirmLabel: tc("reflect"),
                  })}
                >
                  {t("applyToHypothesisForm")}
                </button>
              </>
            )}
          </section>
        )}

        {tab === "hypotheses" && (
        <section className="market-section sizing-step mb-3" aria-label={t("investmentStructureHypothesis2")}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("investmentStructureHypothesis3")}{data?.hypotheses.length ?? 0}{tc("countSuffixParen")}</h3>
          {(data?.hypotheses ?? []).map((h) => (
            <div key={h.id} className="sizing-grade-card mb-2">
              <div className="flex flex-wrap items-center gap-1 mb-1">
                {h.vehicle && <span className="status-chip status-amber">{vehicleLabel(h.vehicle)}</span>}
                {h.asset_or_stock && <span className="status-chip status-not-started">{h.asset_or_stock === "asset" ? t("assetAcquisition") : h.asset_or_stock === "stock" ? t("shareAcquisition") : t("mixed")}</span>}
                {h.stake_type && <span className="status-chip status-not-started">{t("stake2")} {STAKE_LABEL(tr)[h.stake_type] ?? h.stake_type}</span>}
                {h.instrument_mix && <span className="status-chip status-not-started">{t("considerationMix2")} {INSTRUMENT_LABEL(tr)[h.instrument_mix] ?? h.instrument_mix}</span>}
                {h.four_axis_review_completed === 1
                  ? <span className="status-chip status-green" title={h.four_axis_artifact_ref ? t("evidenceArtifactP1", { p1: h.four_axis_artifact_ref }) : undefined}>{t("reviewComplete")}</span>
                  : <span className="status-chip status-red">{t("reviewIncomplete")}</span>}
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{h.hypothesized_at.slice(0, 10)} · {h.hypothesized_by}</span>
              </div>
              {h.four_axis_review_completed === 1 && h.four_axis_artifact_ref && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="four-axis-artifact">
                  {t("reviewEvidenceArtifacts")} <code className="dd-item-id">{h.four_axis_artifact_ref}</code>
                  {h.four_axis_reviewed_by && <> {t("reviewer")} {h.four_axis_reviewed_by}{h.four_axis_reviewed_at ? ` · ${h.four_axis_reviewed_at.slice(0, 10)}` : ""}</>}
                </p>
              )}
              <table className="data-table" aria-label={t("reviewNotes")}>
                <caption className="sr-only">{t("reviewContent")}</caption>
                <tbody>
                  {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                    <tr key={k}>
                      <th scope="row" style={{ width: "8rem" }}>{axisLabel(k)}</th>
                      <td>{h[k] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{tc("evidenceColon")} {h.rationale}</p>
              {canAct && h.four_axis_review_completed !== 1 && (() => {
                const missingAxes = AXIS_FIELDS.filter((k) => !h[k]?.trim());
                return (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <input
                      className="sizing-new-input text-[length:var(--fs-caption)]"
                      style={{ minWidth: "18rem" }}
                      placeholder={t("p1ArtifactReferenceRequired", { p1: tr(RECORD_KEY_MAP.deal_structure_review) })}
                      value={artifactRef[h.id] ?? ""}
                      onChange={(e) => setArtifactRef({ ...artifactRef, [h.id]: e.target.value })}
                      aria-label={t("artifactReference")}
                    />
                    <button type="button" className="btn-ghost btn-sm" disabled={busy || missingAxes.length > 0} onClick={() => completeFourAxis(h)}
                      title={missingAxes.length > 0 ? t("allFourAxisNotesMust") : undefined}>{t("reviewComplete2")}</button>
                    {missingAxes.length > 0 && (
                      <span className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" data-testid="four-axis-missing">
                        {t("axesNotWritten")} {missingAxes.map((k) => AXIS_LABEL(tr)[k]).join(" · ")} {t("allFourAxesMustBe")}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
          {data && data.hypotheses.length === 0 && (
            <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noHypothesesRegisteredRecordA")}</p>
          )}

          {canAct && (
            <details className="mt-2" ref={formRef} open={formOpen} onToggle={(e) => setFormOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("investmentStructureHypothesisInputFields")} {formOpen ? tc("collapse") : t("expand")}</summary>
              <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
                {isBu ? (
                <label>{tc("newDivisionForm")}
                  <select className="sizing-new-input ml-1" value={buForm} onChange={(e) => setBuForm(e.target.value as BusinessUnitForm | "")}>
                    <option value="">—</option>
                    {BUSINESS_UNIT_FORMS.map((k) => <option key={k} value={k}>{BUSINESS_UNIT_FORM_LABEL[k]}</option>)}
                  </select>
                </label>
                ) : (
                <label>{isGf ? tc("establishedEntityForm") : t("investingEntity2")}
                  <select className="sizing-new-input ml-1" value={newHyp.vehicle} onChange={(e) => setNewHyp({ ...newHyp, vehicle: e.target.value })}>
                    <option value="">—</option>
                    {Object.entries(isGf ? GF_VEHICLE_KEY : VEHICLE_LABEL(tr)).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
                  </select>
                </label>
                )}
                {vis.assetOrStock && (
                <label>{t("assetShare")}
                  <select className="sizing-new-input ml-1" value={newHyp.asset_or_stock} onChange={(e) => setNewHyp({ ...newHyp, asset_or_stock: e.target.value })}>
                    <option value="">—</option>
                    <option value="asset">{t("assetAcquisition2")}</option>
                    <option value="stock">{t("shareAcquisition2")}</option>
                    <option value="mixed">{t("mixed2")}</option>
                  </select>
                </label>
                )}
                {vis.stakeType && (
                <label>{isGf ? t("jvStakeOurShare") : t("stake3")}
                  <select className="sizing-new-input ml-1" value={newHyp.stake_type} onChange={(e) => setNewHyp({ ...newHyp, stake_type: e.target.value })}>
                    <option value="">—</option>
                    {Object.entries(isGf ? GF_JV_STAKE_KEY : STAKE_LABEL(tr)).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
                  </select>
                </label>
                )}
                {vis.instrumentMix && (
                <label>{t("considerationMix3")}
                  <select className="sizing-new-input ml-1" value={newHyp.instrument_mix} onChange={(e) => setNewHyp({ ...newHyp, instrument_mix: e.target.value })}>
                    <option value="">—</option>
                    {Object.entries(INSTRUMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                )}
              </div>
              {isBu && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                  {t("theNewDivisionFormIs")} {BUSINESS_UNIT_NO_ISOLATION_NOTE}
                </p>
              )}
              {isGf && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                  {t("theEstablishmentStructureDoesNot")}
                </p>
              )}
              <div className="grid grid-1 gap-1 mt-2 text-[length:var(--fs-caption)]">
                {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                  <label key={k}>{axisLabel(k)}
                    <input className="sizing-new-input w-full" value={newHyp[k]} onChange={(e) => setNewHyp({ ...newHyp, [k]: e.target.value })} />
                  </label>
                ))}
                <label>{tc("evidenceRequiredMark")}
                  <textarea className="sizing-new-input w-full" rows={2} value={newHyp.rationale} onChange={(e) => setNewHyp({ ...newHyp, rationale: e.target.value })} />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy || !newHyp.rationale.trim()}
                  aria-describedby={!newHyp.rationale.trim() ? "hyp-reason" : undefined}
                  onClick={saveStructure}
                >
                  {busy ? tc("recording") : t("recordHypothesis")}
                </button>
                {!newHyp.rationale.trim() && <span id="hyp-reason" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("recordingUnlocksOnceTheRequired")}</span>}
              </div>
            </details>
          )}
        </section>
        )}

        {tab === "financing" && (
        <section className="market-section sizing-step" aria-label={t("fundingPlan2")}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("fundingPlanSourcesAndUses")}</h3>
          {totals && (
            <p className="text-[length:var(--fs-caption)] mb-1">
              {tc("funding")} <span className="mono-num">{fmt(totals.sources)}</span> {t("inUse")} <span className="mono-num">{fmt(totals.uses)}</span> {t("difference")}{" "}
              <span className="mono-num">{fmt(diff)}</span> {tc("krwMillionKrw")}{" "}
              {totals.balanced
                ? <span className="status-chip status-green">{t("balanced")}</span>
                : <span className="status-chip status-red">{t("imbalanceS10CompletionRequirementUnmet")}</span>}
            </p>
          )}
          {balance && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{balance.balanced ? "✓" : "✕"} {balance.text}</p>}
          {data?.financing.certainty && data.financing.certainty.source_lines > 0 && (
            <p className="text-[length:var(--fs-caption)] mb-1" data-testid="financing-certainty">
              {t("fundingCertaintyDocumentation")}{" "}
              {data.financing.certainty.all_sources_evidenced
                ? <span className="status-chip status-green">{tc("funding")} {data.financing.certainty.source_lines}{t("itemSAllDocumented")}</span>
                : <span className="status-chip status-amber">{t("fundingWithoutDocumentation")} {data.financing.certainty.unevidenced_lines}{t("itemS")} {fmt(data.financing.certainty.unevidenced_amount_krw_m)} {tc("krwMillionKrw")}</span>}
              <span className="text-[color:var(--muted-fg)] ml-1">{t("theS10CompletionRequirementIs")}</span>
            </p>
          )}
          {isGf && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
              {t("recordEquityProjectFinancingAnd")}
            </p>
          )}
          <table className="data-table" aria-label={t("fundingItems")}>
            <caption className="sr-only">{t("fundingSourcesAndUsesItems")}</caption>
            <thead>
              <tr><th scope="col">{tc("division")}</th><th scope="col">{tc("items")}</th><th scope="col" className="mono-num">{t("amountMillionsOfKrw")}</th><th scope="col">{tc("notes")}</th><th scope="col"></th></tr>
            </thead>
            <tbody>
              {(data?.financing.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{e.kind === "source" ? tc("funding") : t("inUse2")}</td>
                  <td>{e.name}</td>
                  <td className="mono-num">{fmt(e.amount_krw_m)}</td>
                  <td>
                    {e.kind === "source" && (
                      e.evidence_kind && e.evidence_ref
                        ? <span className="status-chip status-green mr-1" title={e.evidence_ref}>{EVIDENCE_KIND_LABEL(tr)[e.evidence_kind] ?? e.evidence_kind}</span>
                        : <span className="status-chip status-amber mr-1" title={t("noDocumentationReferencesSuchAs")}>{t("noDocumentation")}</span>
                    )}
                    {e.note ?? (e.kind === "source" ? "" : "—")}
                  </td>
                  <td>
                    {canAct && (
                      <button type="button" className="btn-danger btn-sm" disabled={busy}
                        onClick={() => confirm(t("deleteItem"), () => { void post({ action: "remove_financing_entry", entry_id: e.id }); }, { body: t("deletionIsRecordedInThe"), confirmLabel: tc("delete") })}>
                        {tc("delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.financing.entries.length ?? 0) === 0 && (
                <tr><td colSpan={5}>{t("noItemsRegistered")}</td></tr>
              )}
            </tbody>
          </table>
          {canAct && (
            <div className="flex flex-wrap items-end gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>{tc("division")}
                <select className="sizing-new-input ml-1" value={newEntry.kind} onChange={(e) => setNewEntry({ ...newEntry, kind: e.target.value as "source" | "use" })}>
                  <option value="source">{tc("funding")}</option>
                  <option value="use">{t("inUse3")}</option>
                </select>
              </label>
              <label>{tc("itemName")}
                <input className="sizing-new-input ml-1" list={isGf ? "gf-entry-presets" : undefined} value={newEntry.name} onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })} />
              </label>
              <label>{t("amountMillionsOfKrw2")}
                <input className="sizing-new-input mono-num ml-1" style={{ width: "8rem" }} value={newEntry.amount_krw_m} onChange={(e) => setNewEntry({ ...newEntry, amount_krw_m: e.target.value })} />
              </label>
              <label>{tc("notes")}
                <input className="sizing-new-input ml-1" value={newEntry.note} onChange={(e) => setNewEntry({ ...newEntry, note: e.target.value })} />
              </label>
              {newEntry.kind === "source" && (
                <>
                  <label>{t("documentationType")}
                    <select className="sizing-new-input ml-1" value={newEntry.evidence_kind} onChange={(e) => setNewEntry({ ...newEntry, evidence_kind: e.target.value })}>
                      <option value="">{t("none")}</option>
                      {Object.entries(EVIDENCE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label>{t("documentationReference")}
                    <input className="sizing-new-input ml-1" placeholder={t("commitmentLetterBoardResolution")} value={newEntry.evidence_ref} onChange={(e) => setNewEntry({ ...newEntry, evidence_ref: e.target.value })} />
                  </label>
                </>
              )}
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={addEntry}>{tc("add")}</button>
              {isGf && (
                <datalist id="gf-entry-presets">
                  {(newEntry.kind === "source" ? KO_GF_FUNDING_SOURCE_PRESETS : KO_GF_FUNDING_USE_PRESETS).map((n) => <option key={n} value={n} />)}
                </datalist>
              )}
            </div>
          )}
        </section>
        )}

        {tab === "capex" && isGf && (
          <CapexTrancheTable projectId={projectId} tranches={tranches} canAct={canAct} onChanged={load} meUserId={me?.userId ?? null} />
        )}
      </StageFrame>
      {confirmDialog}
</>
  );
}

