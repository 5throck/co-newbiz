"use client";

// S5 자체 진출 본문 — ADR-0120 Wave 2 Phase A 추출(/greenfield 페이지와
// /deals/[id]/s5 탭이 동일 컴포넌트를 소비한다). StageFrame·main 셸·기회 선택
// 칩은 호출자가 제공한다(공통 규칙 #6): 이 컴포넌트는 opportunityId 하나에 고정된
// 작업 화면만 렌더링한다.
//
// Greenfield는 Target Company가 없음 — "우리 스스로 진입 가능한가, 무엇을
// 구축해야 하는가"를 평가한다: 진출전략(Build/Partner/Hire/Invest 결정) →
// 필요 역량 확인 → 투자비 검토 요건 (greenfield-capability-assessment 절차, B-7).
// ADR-0136 / ADR-0172: 필요 역량 정의(필요도·필요 수준·보유 판정·보유 수준·보유 근거)는
//   S3 역량 갭 레지스터(opportunity.capability_gap_json)가 유일한 출처다. S5는 그것을
//   읽기 전용으로 보여준다. ADR-0171: S5가 달성 가능성 판정의 편집 화면이다 — 해소 방식,
//   기대 수준, 비용, 기간, 달성 가능성, 근거·증빙과 사람의 확정(CapabilityJudgementEditor)
//   및 자유 서술 비고.
import { TranslatorFn } from "../../i18n/config.ts";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TabNav } from "../TabNav.tsx";
import { InvestmentSummaryCharts } from "./InvestmentSummaryCharts.tsx";
import { aggregateDirty, buildCompletionChecklist, buildSourceSummary, dirtyIndicatorText, filledComponentCount, GF_TAB_KEYS, GF_TAB_LABELS, parseGfTab, tabMarker, type GfTabKey } from "../../lib/greenfield-tabs.ts";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { CapabilityJudgementEditor } from "./CapabilityJudgementEditor.tsx";
import type { JudgementDraft } from "./CapabilityJudgementTable.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { api, ApiError } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { SectionToolbar } from "../layout.tsx";
import { GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { PromotionPanel } from "../PromotionPanel.tsx";
import { ColGroup, PrimaryAction } from "../ui.tsx";
import type { CapabilityGapRow } from "../../lib/capability-gap.ts";
import { CapabilityCostBlock } from "./CapabilityCostBlock.tsx";
import { StaffingPlanSection } from "./StaffingPlanSection.tsx";
import { emptyStaffingPlan, findStaffingDuplicateWarnings, fitPlanToHorizon, isStaffingPlanEntry, normalizeStaffingPlanEntry, staffingPlanOf, type StaffingDuplicateWarning, type StaffingPlanEntry } from "../../lib/staffing-plan.ts";
import type { SimulationResults, TornadoKey } from "../../lib/investment-simulation.ts";
import { buildInvestmentVectors, effectiveAssumptions, SALARY_RANGE, SALARY_INCREASE_RANGE_PP, ON_COST_RANGE_PP, RAMP_SHIFT_HALF_YEARS, CAPABILITY_RANGE, MANUAL_LINE_RANGE } from "../../lib/investment-vectors.ts";
import { EntryStrategySection } from "./EntryStrategySection.tsx";
import { SiteAnnouncementPanel } from "./SiteAnnouncementPanel.tsx";
import { parseEntryStrategy, serializeEntryStrategy, type EntryFormState, type EntryModes } from "../../lib/greenfield-entry-strategy.ts";
import {
  AMOUNT_UNIT_KRW_M, amountUnitLabel, convertManualLinesToKrw, scheduleTotals, SUB_CATEGORY_LABEL, SUB_CATEGORY_PARENT, SUB_CATEGORY_S8_NOTE, STAFFING_SUB_CATEGORY, subCategoriesOf, subCategoryDef, validSubCategory, type SubCategoryKey, applySelection, buildInvestmentSummary, DEFAULT_HORIZON_YEARS, deriveCapabilityCostLines, findDuplicateWarnings, formatKrwM, hasUnsavedReflection, confirmUnitOnAmountEdit, unitOnCurrencyChange, investmentTotals, isCapabilityEntry, manualLineAmounts, isPlanMetaEntry, lineSaveStates, manualLineIssues, manualLineKrwM, MAX_HORIZON_YEAR_LIMIT, MIN_HORIZON_YEARS, normalizeLegacyLine, planMetaOf, reflectionBody, reflectionSummary, sanityLineOversize, sanityTotalOversize, selectionPayload, unifiedFooter, unifiedInvestmentRows, validateLineYears, capabilityEndYearOf,
  SIM_OVERRIDE_KEYS, simOverridesOf, validateSimOverrides,
  type AmountUnit, type CapabilityCostView, type CostCategory, type CostSelection, type DuplicateWarning, type ManualCostLine, type MilestoneCandidateView, type PlanMetaEntry, type SimOverrideKey, type SimOverrides,
} from "../../lib/capability-cost-lines.ts";
import type { AttainabilityRowView } from "../../lib/capability-attainability.ts";
import { useTranslations } from "next-intl";

type BcLine = ManualCostLine;
interface Assessment {
  id: string; entry_strategy: string | null; alternatives_considered: string | null;
  rationale: string | null; updated_at: string;
  /** Manual lines plus stored capability entries (source: "capability", ADR-0173). */
  business_case_lines: Array<BcLine | Record<string, unknown>> | null;
}
interface OppDetail {
  opportunity: { id: string; name: string; assessed_at?: string | null; promoted_at?: string | null; project_id?: string | null };
  assessment: Assessment | null;
  capability_cost_lines?: CapabilityCostView;
  milestone_candidates?: MilestoneCandidateView[];
  /** ADR-0175: true for read-only callers — the plan arrives with salary/가산율 values removed. */
  staffing_plan_masked?: boolean;
}
interface GapGetResponse {
  opportunity: { id: string; name: string };
  rows: CapabilityGapRow[];
  stored: boolean;
}
interface InvestmentReco {
  source: "llm" | "synthesis";
  provider: string | null;
  note: string | null;
  manifest: string[];
  recommendation: {
    investment_items: Array<{ line: string; category: "labor" | "opex" | "capex" | "revenue" | "gov_rnd"; note: string; sub_category?: SubCategoryKey }> | null;
    key_evidence: string[];
    cautions: string[];
  };
}

// ADR-0137 — S8 business_case_line.category/period/currency 어휘(승격 시 그대로 이관).
type BcCategory = NonNullable<BcLine["category"]>;
type BcCurrency = NonNullable<BcLine["currency"]>;
type BcPeriod = NonNullable<BcLine["period"]>;
const CATEGORY_LABEL = (tr: TranslatorFn): Record<BcCategory, string> => ({ labor: tr("common.laborCost"), opex: tr("common.opex"), capex: tr("common.capex"), revenue: tr("stages.s5.stage.returns"), gov_rnd: tr("stages.s5.stage.governmentRD") });
/** 백만원 number format shared by the 투자비 요약 tiles and tables. */
const fmtM = (n: number): string => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
/** ADR-0176 slice 1: band labels (최저/기준/최고). */
const BAND_LABEL = (tr: TranslatorFn): Record<"low" | "mode" | "high", string> => ({ low: tr("stages.s5.stage.lowest"), mode: tr("common.criteria"), high: tr("stages.s5.stage.highest") });
/** ADR-0176 slice 2: stored run as returned by /api/greenfield/[oppId]/investment-simulation. */
interface InvestSimRun { id: string; input_hash: string; seed: number; draw_count: number; envelope_krw_m: number | null; created_by: string; created_at: string; confirmed_by?: string | null; confirmed_at?: string | null; results: Omit<SimulationResults, "byCategory"> & { byCategory: { capability: SimulationResults["byCategory"]["capability"]; manual: SimulationResults["byCategory"]["manual"]; staffing: SimulationResults["byCategory"]["staffing"] | null } } }
const TORNADO_LABEL = (tr: TranslatorFn): Record<TornadoKey, string> => ({ salary: tr("stages.s5.stage.salary"), salaryIncrease: tr("stages.s5.stage.salaryIncreaseRate"), onCost: tr("stages.s5.stage.upliftRate"), ramp: tr("stages.s5.stage.deploymentTiming"), capability: tr("stages.s5.stage.capabilityCost"), manualLines: tr("stages.s5.stage.generalItems"), fx: tr("stages.s5.stage.fxRateNotApplied") });
const SIM_CATEGORY_LABEL = (tr: TranslatorFn) => ({ capability: tr("stages.s5.stage.capabilityResolution"), manual: tr("stages.s5.stage.investmentItems"), staffing: tr("stages.s5.stage.staffing") }) as const;
const SIM_PARAM_LABELS = (tr: TranslatorFn): Record<SimOverrideKey, string> => ({
  salaryRange: tr("stages.s5.stage.salary2"),
  salaryIncreaseRangePp: tr("stages.s5.stage.increaseRate"),
  onCostRangePp: tr("stages.s5.stage.uplift"),
  rampShiftHalfYears: tr("stages.s5.stage.deploymentTiming2"),
  capabilityRange: tr("stages.s5.stage.capability"),
  manualLineRange: tr("stages.s5.stage.generalItems2"),
});
const SIM_PARAM_DEFAULTS: Record<SimOverrideKey, number> = {
  salaryRange: SALARY_RANGE,
  salaryIncreaseRangePp: SALARY_INCREASE_RANGE_PP,
  onCostRangePp: ON_COST_RANGE_PP,
  rampShiftHalfYears: RAMP_SHIFT_HALF_YEARS,
  capabilityRange: CAPABILITY_RANGE,
  manualLineRange: MANUAL_LINE_RANGE,
};
const PERIOD_LABEL = (tr: TranslatorFn): Record<BcPeriod, string> => ({ monthly: tr("common.month"), quarterly: tr("common.quarter"), yearly: tr("common.year"), lumpsum: tr("stages.s5.stage.lumpSumTotal") });
const CURRENCY_LABEL = (tr: TranslatorFn): Record<BcCurrency, string> => ({ KRW: tr("stages.s5.stage.krw"), USD: tr("stages.s5.stage.usd"), EUR: tr("stages.s5.stage.euro"), JPY: tr("stages.s5.stage.japaneseYen"), CNY: tr("stages.s5.stage.chineseYuan") });
// Unified investment item table: 11 shared columns (Onyx table-fixed-pct system); 세부 과목 after 분류 (ADR-0177).
const INVEST_ITEM_COL_PCT = [15, 9, 8, 11, 10, 8, 7, 7, 12, 7, 6] as const;

/** 세부 과목 options for a category; with no category every key is offered, grouped by parent (picking one sets the parent). */
function SubCategoryOptions({ category }: { category: string | undefined }) {const tr = useTranslations(); const t = useTranslations("stages.s5.stage");
  const parents = category ? [category] : ["capex", "opex", "labor"];
  return (
    <>
      <option value="">{t("doNotSelect")}</option>
      {parents.map((p) => {
        const defs = subCategoriesOf(p);
        const plain = defs.filter((d) => !d.group);
        const groups = [...new Set(defs.filter((d) => d.group).map((d) => d.group as string))];
        const prefix = category ? "" : `${CATEGORY_LABEL(tr)[p as BcCategory]} · `;
        return (
          <optgroup key={p} label={CATEGORY_LABEL(tr)[p as BcCategory]}>
            {plain.map((d) => <option key={d.key} value={d.key}>{prefix}{d.label}</option>)}
            {groups.flatMap((g) => defs.filter((d) => d.group === g).map((d) => <option key={d.key} value={d.key}>{prefix}{g} · {d.label}</option>))}
          </optgroup>
        );
      })}
    </>
  );
}

export function GreenfieldStage({ opportunityId, onSaved }: { opportunityId: string; onSaved?: () => void }) {const tr = useTranslations(); const t = useTranslations("stages.s5.stage"); const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const [selected, setSelected] = useState<OppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gapRows, setGapRows] = useState<CapabilityGapRow[]>([]);
  const [gapStored, setGapStored] = useState(false);
  const [savingGaps, setSavingGaps] = useState(false);
  const [entryStrategy, setEntryStrategy] = useState("");
  const [alternatives, setAlternatives] = useState("");
  // ADR-0171 amendment (2): selected modes (+ main) live beside the rationale text (entryStrategy); unsaved text survives refetches.
  const [entryModes, setEntryModes] = useState<EntryModes>({ modes: [], main: null });
  const entryDirty = useRef(false);
  const [entryReset, setEntryReset] = useState(0);
  // Own save of the strategy fields and own "reflect capability costs" action (partial POSTs).
  const [entryIsDirty, setEntryIsDirty] = useState(false);
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryNote, setEntryNote] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [costSaving, setCostSaving] = useState(false);
  const [costNote, setCostNote] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  // 투자비 항목 저장 — the section's own explicit save (lines + capability selections only).
  const [linesSaving, setLinesSaving] = useState(false);
  const [linesNote, setLinesNote] = useState<string | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [bcLines, setBcLines] = useState<BcLine[]>([]);
  // Last saved manual lines (as loaded) — per-row "✓ 저장됨 / 저장 전" chips and section dirty tracking.
  const [savedManualLines, setSavedManualLines] = useState<BcLine[]>([]);
  // Per-row dismissals of the "금액이 매우 큽니다" sanity chip (decision support only).
  const [sanityDismissed, setSanityDismissed] = useState<Set<number>>(new Set());
  const [totalSanityDismissed, setTotalSanityDismissed] = useState(false);
  const [rationale, setRationale] = useState("");
  // ADR-0173 slice 1: stored capability entries stay out of the manual list; the person's unsaved choices overlay the derived lines.
  const [storedCapEntries, setStoredCapEntries] = useState<unknown[]>([]);
  const [capSel, setCapSel] = useState<Record<string, CostSelection>>({});
  // ADR-0174 slice 1: 검토 기간 (plan_meta horizonYears, default 5) and per-capability spend-year overrides.
  const [horizon, setHorizon] = useState(DEFAULT_HORIZON_YEARS);
  const [capStartYear, setCapStartYear] = useState<Record<string, number>>({});
  // 2026-10-18 decider ask — 창구 끝 연차 override (연간 균분의 마지막 해). 저장은 시작 연차와 함께.
  const [capEndYear, setCapEndYear] = useState<Record<string, number>>({});
  // ADR-0176: decider-entered simulation assumption-range overrides (plan_meta.simOverrides) + last saved snapshot for dirty tracking.
  const [simOv, setSimOv] = useState<SimOverrides>({});
  const [savedSimOvJson, setSavedSimOvJson] = useState<string>("{}");
  // ADR-0176 slice 2: latest stored probabilistic run (server-side, saved plan only) + run controls.
  const [simRun, setSimRun] = useState<InvestSimRun | null>(null);
  const [simStale, setSimStale] = useState(false);
  const [simEnvelope, setSimEnvelope] = useState("");
  const [simDraws, setSimDraws] = useState("");
  const [simRunning, setSimRunning] = useState(false);
  const [simRunError, setSimRunError] = useState<string | null>(null);
  const [simConfirming, setSimConfirming] = useState(false);
  // ADR-0175 slice 1: 인력 운영 계획 draft + last saved snapshot (JSON) for dirty tracking.
  const [staffPlan, setStaffPlan] = useState<StaffingPlanEntry>(() => emptyStaffingPlan(DEFAULT_HORIZON_YEARS));
  const [savedStaffJson, setSavedStaffJson] = useState<string>("");
  const [attRows, setAttRows] = useState<AttainabilityRowView[] | null>(null);
  // ADR-0173 amendment 2026-10-15: the judgement editor exposes patchDraft so the investment table's 분류 select writes back into the row's judgement draft (marks dirty; saved via the S5 judgement PUT).
  const judgeApiRef = useRef<{ patchDraft: (id: string, p: Partial<JudgementDraft>) => void; saveDirty: () => Promise<void> } | null>(null);
  // ADR-0118 — S5 투자비 검토 요건 LLM 추천(제안). 저장은 사람의 행위다.
  const [reco, setReco] = useState<InvestmentReco | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoOpen, setRecoOpen] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);
  // S5 tabs (presentation only): URL ?tab= keeps the active tab; every panel stays mounted so switching never drops unsaved edits.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseGfTab(searchParams.get("tab"));
  // Only the chart body (not the panel) is gated on the active tab: ECharts needs a visible, non-zero-width container.
  const investTabActive = tab === "investment";
  const setTab = useCallback((key: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", key);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);
  // "판정 보기" in the investment table hops to the capability tab, then scrolls once that panel is visible.
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => {
    if (pendingScroll.current && tab === "capability") {
      document.getElementById(pendingScroll.current)?.scrollIntoView?.({ block: "start" });
      pendingScroll.current = null;
    }
  }, [tab]);
  const goToCapabilityJudgement = useCallback(() => { pendingScroll.current = "cap-judgement-section"; setTab("capability"); }, [setTab]);
  // Judgement drafts / notes held inside CapabilityJudgementEditor (reported up for the page-level indicator).
  const [judgeDirty, setJudgeDirty] = useState(false);
  // Last saved 평가 근거, for the review tab's dirty state.
  const [savedRationale, setSavedRationale] = useState("");

  // scope: "all" (page load / whole save), "strategy" (own strategy save) or "cost" (own reflection save): a partial scope never touches the other parts' unsaved state.
  const loadDetail = useCallback((oppId: string, scope: "all" | "strategy" | "cost" = "all") => {
    return api.get<OppDetail>(`/api/greenfield/${encodeURIComponent(oppId)}`)
      .then((r) => {
        setSelected(r.data);
        if (scope !== "cost" && !entryDirty.current) {
          const parsed = parseEntryStrategy(r.data.assessment?.entry_strategy);
          setEntryModes({ modes: parsed.modes, main: parsed.main });
          setEntryStrategy(parsed.rationale);
          setAlternatives(r.data.assessment?.alternatives_considered ?? "");
        }
        if (scope !== "strategy") {
          const all = r.data.assessment?.business_case_lines ?? [];
          // The plan_meta entry carries the 검토 기간; it never joins the unified line list.
          const meta = planMetaOf(all);
          setHorizon(meta ? meta.horizonYears : DEFAULT_HORIZON_YEARS);
          // ADR-0176: restore the decider's simulation assumption overrides (undefined = ADR defaults).
          const simOvStored = simOverridesOf(meta);
          setSimOv(simOvStored ?? {});
          setSavedSimOvJson(JSON.stringify(simOvStored ?? {}));
          // Legacy manual lines are shown as-entered: the unit is unknown, so nothing is converted
          // and the unit select shows its placeholder and the row is excluded from totals until a person picks a unit.
          const storedStaff = staffingPlanOf(all);
          const fitted = fitPlanToHorizon(storedStaff ?? emptyStaffingPlan(meta ? meta.horizonYears : DEFAULT_HORIZON_YEARS), meta ? meta.horizonYears : DEFAULT_HORIZON_YEARS);
          setStaffPlan(fitted);
          setSavedStaffJson(JSON.stringify(fitted));
          const manual = (all.filter((l) => !isCapabilityEntry(l) && !isPlanMetaEntry(l) && !isStaffingPlanEntry(l)) as Array<Record<string, unknown>>).map(normalizeLegacyLine);
          setBcLines(manual);
          setSavedManualLines(manual);
          setStoredCapEntries(all.filter((l) => isCapabilityEntry(l)));
          setCapSel({});
          setCapStartYear({});
        }
        if (scope === "all") { setRationale(r.data.assessment?.rationale ?? ""); setSavedRationale(r.data.assessment?.rationale ?? ""); }
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheEvaluation")));
  }, []);

  const loadGaps = useCallback((oppId: string) => {
    api.get<GapGetResponse>(`/api/opportunities/${encodeURIComponent(oppId)}/capability-gap`)
      .then((r) => { setGapRows(r.data.rows); setGapStored(r.data.stored); })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadRequiredCapabilities")));
  }, []);

  // ADR-0176 slice 2: latest stored run (read-only fetch; a failed fetch just shows "no run").
  const loadSimRun = useCallback((oppId: string) => {
    return api.get<{ run: InvestSimRun | null; stale: boolean }>(`/api/greenfield/${encodeURIComponent(oppId)}/investment-simulation`)
      .then((r) => { setSimRun(r.data.run); setSimStale(r.data.stale); })
      .catch(() => { setSimRun(null); setSimStale(false); });
  }, []);

  useEffect(() => {
    setSimRun(null); setSimStale(false); setSimRunError(null); setSimEnvelope(""); setSimDraws("");
    void loadSimRun(opportunityId);
  }, [opportunityId, loadSimRun]);

  useEffect(() => {
    setSelected(null); setGapRows([]); setReco(null); setRecoError(null); setJudgeDirty(false);
    setSanityDismissed(new Set()); setTotalSanityDismissed(false);
    entryDirty.current = false; setEntryReset((n) => n + 1);
    setEntryIsDirty(false); setEntryNote(null); setEntryError(null); setCostNote(null); setCostError(null);
    setLinesSaving(false); setLinesNote(null); setLinesError(null); setSavedManualLines([]);
    void loadDetail(opportunityId);
    loadGaps(opportunityId);
  }, [opportunityId, loadDetail, loadGaps]);

  const generateReco = useCallback(async () => {
    if (!selected || recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<InvestmentReco>(`/api/greenfield/${encodeURIComponent(selected.opportunity.id)}/recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : t("failedToGenerateRecommendation"));
    } finally {
      setRecoLoading(false);
    }
  }, [selected, recoLoading]);

  // 추천 항목 추가 — 기존 목록을 덮어쓰지 않고 뒤에 이어붙인다. 금액은 사람이
  // 입력한다(LLM은 금액을 지어내지 않음, 경계 #2).
  function addRecoItem(item: { line: string; category: BcCategory; note: string; sub_category?: SubCategoryKey }) {
    // ADR-0177: an AI-proposed 세부 과목 is carried only when it fits the category; amounts stay with the person.
    const sub = validSubCategory(item.category, item.sub_category) ? item.sub_category : undefined;
    setBcLines((prev) => [...prev, { line: item.line, category: item.category, amount: 0, amountUnit: AMOUNT_UNIT_KRW_M, amountUnitConfirmed: true, note: item.note, currency: "KRW", ...(sub ? { subCategory: sub } : {}) }]);
  }

  // Live judgements (saved) drive the derived lines; before the editor loads, the server's derivation is shown.
  const costView = useMemo<CapabilityCostView>(
    () => (attRows ? deriveCapabilityCostLines(attRows, storedCapEntries) : selected?.capability_cost_lines ?? { lines: [], orphans: [], totals: { capabilityKrwM: 0, reflectedKrwM: 0, reflectedCount: 0, needsRejudgeCount: 0 } }),
    [attRows, storedCapEntries, selected],
  );
  const capLines = useMemo(() => applySelection(costView, capSel), [costView, capSel]);
  // Spend-year overrides overlay the derived startYear (override ?? judgement-derived default).
  const capLinesEff = useMemo(
    () => capLines.map((l) => {
      const y = capStartYear[l.capabilityKey];
      const e = capEndYear[l.capabilityKey];
      return {
        ...l,
        ...(Number.isInteger(y) && y >= 1 ? { startYear: y } : {}),
        ...(Number.isInteger(e) && e >= 1 ? { endYear: e } : {}),
      };
    }),
    [capLines, capStartYear, capEndYear],
  );
  const reflectedLines = capLines.filter((l) => l.reflected);
  // The plan is fitted to the live horizon before costing, so a horizon change never silently drops or pads on the server.
  const staffEff = useMemo(() => fitPlanToHorizon(staffPlan, horizon), [staffPlan, horizon]);
  const staffActive = staffEff.rows.length > 0 ? staffEff : null;
  // ADR-0181 seam — 외화 투자비 항목은 사람이 설정한 검토/안건 환율(entry_market_fx)로
  // 백만원 환산해 합계·스케줄·벡터에 반영한다. 환율이 없는 통화는 기존대로 제외된다.
  const [fxRates, setFxRates] = useState<Record<string, number> | undefined>(undefined);
  const fxRatesKey = selected?.opportunity.id ?? null;
  useEffect(() => {
    if (!fxRatesKey) { setFxRates(undefined); return; }
    let alive = true;
    api.get<{ fx: Array<{ currency: string; rate: number }> | null }>(`/api/opportunities/${encodeURIComponent(fxRatesKey)}/entry-market-derivation`)
      .then((r) => { if (alive) setFxRates(Object.fromEntries((r.data.fx ?? []).map((f) => [f.currency, f.rate]))); })
      .catch(() => { if (alive) setFxRates(undefined); });
    return () => { alive = false; };
  }, [fxRatesKey]);
  const bcLinesKrw = useMemo(() => convertManualLinesToKrw(bcLines, fxRates), [bcLines, fxRates]);
  const invTotals = investmentTotals(costView, new Set(reflectedLines.map((l) => l.capabilityKey)), bcLinesKrw, staffActive, horizon);
  const dupWarnings = findDuplicateWarnings(reflectedLines, bcLines);
  const reflectedKeySet = useMemo(() => new Set(reflectedLines.map((l) => l.capabilityKey)), [reflectedLines]);
  // ADR-0174 slice 1 — 투자비 요약 recomputed from the page state (read-only, decision support).
  const summary = useMemo(
    () => buildInvestmentSummary(bcLinesKrw, capLinesEff, horizon, reflectedKeySet, staffActive),
    [bcLinesKrw, capLinesEff, horizon, reflectedKeySet, staffActive],
  );
  const schedTotals = useMemo(() => scheduleTotals(summary), [summary]);
  const hasPreLaunch = (summary.preLaunchKrwM ?? 0) > 0;
  // ADR-0176 slice 1 — deterministic low/mode/high bands over the same inputs as the summary.
  const vectors = useMemo(
    () => buildInvestmentVectors({ manual: bcLinesKrw, capLines: capLinesEff, horizon, reflectedKeys: reflectedKeySet, staffing: staffActive, overrides: simOv }),
    [bcLinesKrw, capLinesEff, horizon, reflectedKeySet, staffActive, simOv],
  );
  const effA = effectiveAssumptions(simOv);
  // Per-line timing errors (Korean messages from validateLineYears); any error blocks save.
  const yearErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    bcLines.forEach((l, i) => {
      const e = validateLineYears(l, horizon);
      if (e) errs[`m${i}`] = e;
    });
    for (const [key, y] of Object.entries(capStartYear)) {
      const e = validateLineYears({ startYear: y }, horizon);
      if (e) errs[`c${key}`] = e;
    }
    for (const [key, e] of Object.entries(capEndYear)) {
      const start = capStartYear[key];
      const err = validateLineYears({ startYear: Number.isFinite(start) ? start : 1, endYear: e, period: "yearly" }, horizon);
      if (err) errs[`ce${key}`] = err;
    }
    return errs;
  }, [bcLines, capStartYear, horizon]);
  const hasYearErrors = Object.keys(yearErrors).length > 0;
  const lineStates = useMemo(() => lineSaveStates(capLines, storedCapEntries, capSel), [capLines, storedCapEntries, capSel]);
  const reflectDirty = hasUnsavedReflection(lineStates);
  // 투자비 항목 저장 dirty tracking: any manual line differs from the last saved snapshot, or any capability selection is unsaved.
  const manualDirty = useMemo(() => JSON.stringify(bcLines) !== JSON.stringify(savedManualLines), [bcLines, savedManualLines]);
  // Per-row: saved when the line at the same index still equals the last saved snapshot.
  const manualRowDirty = useCallback((i: number): boolean => {
    const s = savedManualLines[i];
    return !s || JSON.stringify(s) !== JSON.stringify(bcLines[i]);
  }, [bcLines, savedManualLines]);
  const staffDirty = useMemo(() => JSON.stringify(staffEff) !== savedStaffJson, [staffEff, savedStaffJson]);
  // Client-side validation mirrors the route so the precise message shows before the POST.
  const staffError = useMemo(() => { const v = normalizeStaffingPlanEntry(staffEff, horizon); return v.ok ? null : v.message; }, [staffEff, horizon]);
  const staffWarnings = useMemo(() => findStaffingDuplicateWarnings(staffEff.rows, bcLines), [staffEff, bcLines]);
  const dismissStaffDup = (w: StaffingDuplicateWarning) => setBcLines((prev) => prev.map((l, i) => (i === w.manualIndex ? { ...l, dupDismissed: [...(l.dupDismissed ?? []), `staffing:${w.rowId}`] } : l)));
  // ADR-0176: simulation assumption overrides dirty state + client validation (mirrors the route's hard-400).
  const savedSimOvClean = useMemo(() => JSON.stringify(simOverridesOf(savedSimOvJson ? JSON.parse(savedSimOvJson) : {})), [savedSimOvJson]);
  const simOvDirty = useMemo(() => JSON.stringify(simOverridesOf(simOv)) !== savedSimOvClean, [simOv, savedSimOvClean]);
  const simOvError = useMemo(() => validateSimOverrides(simOv), [simOv]);
  // ADR-0176 slice 2: person-entered envelope/draws are validated client-side (the route hard-400s the same way).
  const simEnvNum = simEnvelope.trim() === "" ? null : Number(simEnvelope);
  const simDrawsNum = simDraws.trim() === "" ? null : Number(simDraws);
  const simInputError = simEnvNum !== null && (!Number.isFinite(simEnvNum) || simEnvNum <= 0)
    ? t("theBudgetCapMustBe")
    : simDrawsNum !== null && !Number.isFinite(simDrawsNum) ? t("theDrawCountMustBe") : null;
  // ADR-0176 slice 3: a person confirms the run so S8 may consume it (human-only route; the server re-checks).
  const confirmSimulation = useCallback(async () => {
    if (!selected || !simRun || simConfirming) return;
    setSimConfirming(true); setSimRunError(null);
    try {
      const r = await api.post<{ run: InvestSimRun; stale: boolean }>(`/api/greenfield/${encodeURIComponent(selected.opportunity.id)}/investment-simulation/confirm`, { run_id: simRun.id });
      setSimRun(r.data.run); setSimStale(r.data.stale);
    } catch (e) {
      setSimRunError(e instanceof Error ? e.message : t("failedToConfirmTheInvestment"));
    } finally {
      setSimConfirming(false);
    }
  }, [selected, simRun, simConfirming]);
  const runSimulation = useCallback(async () => {
    if (!selected || simRunning || simInputError) return;
    setSimRunning(true); setSimRunError(null);
    try {
      const body: Record<string, number> = {};
      if (simEnvNum !== null) body.envelope_krw_m = simEnvNum;
      if (simDrawsNum !== null) body.draws = simDrawsNum;
      const r = await api.post<{ run: InvestSimRun; stale: boolean }>(`/api/greenfield/${encodeURIComponent(selected.opportunity.id)}/investment-simulation`, body);
      setSimRun(r.data.run); setSimStale(r.data.stale);
    } catch (e) {
      setSimRunError(e instanceof Error ? e.message : t("investmentSimulationRunFailed"));
    } finally {
      setSimRunning(false);
    }
  }, [selected, simRunning, simInputError, simEnvNum, simDrawsNum]);
  // 판정 dialog의 시작 연차 override(capStartYear)도 저장 대상 변경이다 — 저장 시 startYear로 실린다.
  const startYearDirty = useMemo(
    () => Object.values(capStartYear).some((v) => typeof v === "number" && Number.isFinite(v) && v >= 1),
    [capStartYear],
  );
  const investDirty = manualDirty || reflectDirty || staffDirty || simOvDirty || startYearDirty;
  const savedReflected = useMemo(() => {
    const saved = capLines.filter((l) => lineStates[l.capabilityKey] === "saved");
    return { count: saved.length, krwM: saved.reduce((n, l) => n + l.costKrwM, 0) };
  }, [capLines, lineStates]);
  // Shown right after a successful reflection (totals reflect the page state, which equals the saved state then).
  const reflectedNote = reflectionSummary(invTotals);
  const unifiedRows = unifiedInvestmentRows(bcLines, capLines, capSel, lineStates);
  const footer = unifiedFooter(unifiedRows, invTotals);
  const dismissDup = (w: DuplicateWarning) => setBcLines((prev) => prev.map((l, i) => (i === w.manualIndex ? { ...l, dupDismissed: [...(l.dupDismissed ?? []), w.capabilityKey] } : l)));
  const candidates = useMemo(
    () => (attRows ? attRows.flatMap((r) => (r.milestone_candidate ? [r.milestone_candidate] : [])) : selected?.milestone_candidates ?? []),
    [attRows, selected],
  );

  const setBc = (i: number, patch: Partial<BcLine>) => setBcLines((prev) => prev.map((l, idx) => (idx === i ? ((m) => ("amount" in patch ? confirmUnitOnAmountEdit(m) : m))({ ...l, ...patch }) : l)));

  // plan_meta entry prepended to every business_case_lines payload (ADR-0174 slice 1); horizon clamped client-side.
  const metaEntry = (): PlanMetaEntry => {
    const ov = simOverridesOf(simOv);
    const entry: PlanMetaEntry = { source: "plan_meta", horizonYears: Math.min(MAX_HORIZON_YEAR_LIMIT, Math.max(MIN_HORIZON_YEARS, Math.floor(horizon) || DEFAULT_HORIZON_YEARS)) };
    // ADR-0176: decider-entered simulation overrides ride the plan_meta entry (absent = ADR defaults);
    // never auto-derived, never overwritten by AI.
    if (ov && Object.keys(ov).length > 0) entry.simOverrides = ov;
    return entry;
  };
  // Capability entries carry the person's choices plus any spend-year override (startYear).
  // The staffing_plan entry rides the investment-lines save ONLY when it changed; otherwise the route keeps the stored plan.
  const staffingPayload = (): unknown[] => (staffDirty ? [staffEff] : []);
  const capEntriesWithYears = () => selectionPayload(capLines, capSel).map((e) => {
    const y = capStartYear[e.capabilityKey];
    return Number.isInteger(y) && y >= 1 ? { ...e, startYear: y as number } : e;
  });

  async function saveGaps() {
    if (!selected || savingGaps) return;
    setSavingGaps(true); setError(null);
    try {
      const res = await api.put<GapGetResponse>(`/api/opportunities/${encodeURIComponent(selected.opportunity.id)}/capability-gap`, { rows: gapRows });
      setGapRows(res.data.rows);
      setGapStored(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveRequiredCapabilities"));
    } finally {
      setSavingGaps(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      // 표에서 바꾼 판정 분류·주기를 먼저 판정 PUT으로 기록 (2026-10-18 decider ask).
      await judgeApiRef.current?.saveDirty?.();
      await api.post(`/api/greenfield/${selected.opportunity.id}`, {
        entry_strategy: serializeEntryStrategy(entryModes, entryStrategy) || undefined,
        alternatives_considered: alternatives || undefined,
        // Capability entries carry only the person's choices; the server rebuilds amount, name and hash from the live judgement.
        business_case_lines: [metaEntry(), ...bcLines.filter((l) => l.line.trim()), ...capEntriesWithYears()],
        rationale: rationale || undefined,
      });
      entryDirty.current = false; setEntryIsDirty(false); setEntryReset((n) => n + 1);
      void loadDetail(selected.opportunity.id);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const hhmm = () => new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  // 진출전략 저장 — ONLY the strategy fields; omitted fields (business_case_lines, rationale) keep their stored values.
  async function saveStrategy() {
    if (!selected || entrySaving || !entryIsDirty) return;
    setEntrySaving(true); setEntryError(null);
    try {
      await api.post(`/api/greenfield/${selected.opportunity.id}`, {
        entry_strategy: serializeEntryStrategy(entryModes, entryStrategy) || undefined,
        alternatives_considered: alternatives || undefined,
      });
      entryDirty.current = false; setEntryIsDirty(false); setEntryReset((n) => n + 1);
      await loadDetail(selected.opportunity.id, "strategy");
      setEntryNote(t("savedP1", { p1: hhmm() }));
      onSaved?.();
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : t("failedToSaveTheEntry"));
    } finally {
      setEntrySaving(false);
    }
  }

  // 선택한 비용을 투자비에 반영 — POSTs ONLY business_case_lines; reloads so every line shows its saved state.
  async function reflectCosts() {
    if (!selected || costSaving) return;
    setCostSaving(true); setCostError(null); setCostNote(null);
    try {
      await judgeApiRef.current?.saveDirty?.();
      const body = reflectionBody(bcLines, capLines, capSel);
      await api.post(`/api/greenfield/${selected.opportunity.id}`, { business_case_lines: [metaEntry(), ...body.business_case_lines.map((l) => {
        if (!isCapabilityEntry(l)) return l;
        const key = (l as { capabilityKey: string }).capabilityKey;
        return { ...l, ...(capStartYear[key] !== undefined ? { startYear: capStartYear[key] } : {}), ...(capEndYear[key] !== undefined && Number.isFinite(capEndYear[key]) ? { endYear: capEndYear[key] } : {}) };
      })] });
      await loadDetail(selected.opportunity.id, "cost");
      setCostNote("__pending__");
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "amount_mismatch") {
        setAttRows(null);
        await loadDetail(selected.opportunity.id, "cost");
        setCostError(t("p1ReloadedFromTheLatest", { p1: err.message }));
      } else {
        setCostError(err instanceof Error ? err.message : t("failedToReflectIntoInvestment"));
      }
    } finally {
      setCostSaving(false);
    }
  }

  // 투자비 항목 저장 — lines-only partial POST: manual lines as held + capability selections
  // (selectionPayload). 다른 평가 필드는 보내지 않으므로 라우트가 저장값을 그대로 유지한다.
  async function saveInvestmentLines() {
    if (!selected || linesSaving || !investDirty || staffError || simOvError) return;
    setLinesSaving(true); setLinesError(null); setLinesNote(null);
    try {
      await judgeApiRef.current?.saveDirty?.();
      const body = reflectionBody(bcLines, capLines, capSel);
      await api.post(`/api/greenfield/${selected.opportunity.id}`, {
        business_case_lines: [metaEntry(), ...staffingPayload(), ...body.business_case_lines.map((l) => {
          if (!isCapabilityEntry(l)) return l;
          const key = (l as { capabilityKey: string }).capabilityKey;
          return { ...l, ...(capStartYear[key] !== undefined ? { startYear: capStartYear[key] } : {}), ...(capEndYear[key] !== undefined && Number.isFinite(capEndYear[key]) ? { endYear: capEndYear[key] } : {}) };
        })],
      });
      const savedCount = body.business_case_lines.length;
      await loadDetail(selected.opportunity.id, "cost");
      setLinesNote(t("p1ItemSSavedTotal", { p1: savedCount, p2: formatKrwM(invTotals.grandKrwM) }));
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "amount_mismatch") {
        setAttRows(null);
        await loadDetail(selected.opportunity.id, "cost");
        setLinesError(t("p1ReloadedFromTheLatest2", { p1: err.message }));
      } else {
        setLinesError(err instanceof Error ? err.message : t("failedToSaveTheInvestment"));
      }
    } finally {
      setLinesSaving(false);
    }
  }

  if (!selected) {
    return (
      <>
        <PrimaryAction inline label={t("evaluationRecordConfirmedByA")} disabled disabledReason={t("runningUnlocksOnceTheOpportunity")} />
        <p role="status" aria-live="polite">
          {error
            ? <span role="alert" className="text-[color:var(--red-fg)]">{error}</span>
            : tc("loading")}
        </p>
      </>
    );
  }


  const issueCounts = { cap: attRows ? attRows.filter((r) => r.stale || !r.grade).length : 0, staff: invTotals.staffingNeedConfirmCount, invest: invTotals.manualExcludedNeedsConfirm + invTotals.needsRejudgeCount };
  const rationaleDirty = rationale !== savedRationale;
  const dirtyAgg = aggregateDirty({ entry: entryIsDirty, capability: judgeDirty, staffing: staffDirty, investment: manualDirty || reflectDirty, review: rationaleDirty });
  const dirtyText = dirtyIndicatorText(dirtyAgg);
  const checklist = buildCompletionChecklist({
    entry: { filled: entryStrategy !== "" || entryModes.modes.length > 0, dirty: entryIsDirty },
    capability: { filled: gapRows.length > 0, dirty: judgeDirty, issues: issueCounts.cap },
    staffing: { filled: staffEff.rows.length > 0, dirty: staffDirty, issues: issueCounts.staff },
    investment: { filled: bcLines.length > 0 || reflectedLines.length > 0, dirty: manualDirty || reflectDirty, issues: issueCounts.invest },
  });
  const sourceChips = buildSourceSummary({ reflectedCapabilityCount: invTotals.reflectedCount, staffingKrwM: invTotals.staffingKrwM, manualCount: bcLines.filter((l) => l.line.trim()).length, needsConfirmCount: issueCounts.invest + issueCounts.staff });
  const markerOf = (key: GfTabKey) => (key === "review" ? tabMarker(rationaleDirty ? { status: "dirty", issues: 0 } : null) : tabMarker(checklist.find((c) => c.key === key) ?? null));
  const markerNode = (key: GfTabKey) => {
    const m = markerOf(key);
    if (m.kind === "none") return null;
    return (
      <span className={`status-chip ml-1 ${m.kind === "done" ? "status-green" : "status-amber"}`} data-testid={`gf-tab-marker-${key}`}>
        <span aria-hidden="true">{m.kind === "done" ? "✓" : "!"}</span>{m.kind === "done" ? <span className="sr-only"> {tc("done")}</span> : <> {m.text}</>}
      </span>
    );
  };
  // All panels stay mounted (hidden when inactive): local drafts in child components survive tab switches.
  const panel = (key: GfTabKey, children: React.ReactNode) => (
    <div role="tabpanel" id={`gf-panel-${key}`} aria-labelledby={`gf-tab-${key}`} hidden={tab !== key} aria-hidden={tab !== key} data-testid={`gf-panel-${key}`}>{children}</div>
  );
  // One handler/state for both placements (투자비 tab and 인력 운영 계획 tab); the label names the scope per placement.
  const linesSaveButton = (label: string) => (
    <button
      type="button"
      className={investDirty && !hasYearErrors ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
      disabled={linesSaving || !investDirty || hasYearErrors || !!staffError}
      title={hasYearErrors ? tc("checkTenureInput") : staffError ?? undefined}
      aria-describedby="invest-item-save-hint"
      aria-label={label}
      onClick={() => void saveInvestmentLines()}
    >
      {linesSaving ? t("item") : label}
    </button>
  );

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S5")} />

      <section aria-label={t("greenfieldEntry")} className="market-section">
        <SectionToolbar
          title={t("p1GreenfieldEntry", { p1: selected.opportunity.name })}
          icon=""
          summary={
            <span className="flex items-center gap-1">
              <span className="status-chip status-not-started" title={t("p4ExecutionEvaluationComponentProgress")}>
                {selected.opportunity.assessed_at ? tc("done") : t("inProgress")} · {filledComponentCount(checklist)}{t("n4Components")}
              </span>
              {selected.opportunity.assessed_at && <span className="status-chip status-green">{t("evaluationRecordsV1")}</span>}
            </span>
          }
        />
        {dirtyText && (
          <p className="status-chip status-amber mb-2" role="status" data-testid="gf-dirty-indicator">
            <span aria-hidden="true">!</span> {dirtyText} · {dirtyAgg.labels.join(", ")}
          </p>
        )}
        <TabNav
          label={t("greenfieldStageTabs")}
          active={tab}
          onSelect={setTab}
          tabs={GF_TAB_KEYS.map((k) => ({ key: k, label: GF_TAB_LABELS[k], id: `gf-tab-${k}`, panelId: `gf-panel-${k}`, marker: markerNode(k) }))}
        />
        <form id="greenfield-eval-form" onSubmit={save} className="sizing-new-form">
          <fieldset disabled={!canAct} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {/* ① 진출전략 */}
          {panel("entry", (
            <>
          <EntryStrategySection
            opportunityId={selected.opportunity.id}
            value={{ modes: entryModes, rationale: entryStrategy, alternatives }}
            onChange={(v: EntryFormState) => { entryDirty.current = true; setEntryIsDirty(true); setEntryModes(v.modes); setEntryStrategy(v.rationale); setAlternatives(v.alternatives); }}
            canAct={canAct}
            rows={(attRows ?? gapRows.map((r) => ({ capability: r.capability, resolution: r.resolution }))).map((r) => ({ capability: r.capability, resolution: r.resolution }))}
            resetKey={entryReset}
            save={{ dirty: entryIsDirty, saving: entrySaving, onSave: () => void saveStrategy(), note: entryNote, error: entryError, onDismissNote: () => setEntryNote(null) }}
          />
            </>
          ))}

          {/* ② 필요 역량 — S3 정의 읽기 전용 + S5 달성 가능성 판정 편집 (ADR-0171) */}
          {panel("capability", (
            <>
          <h3 id="cap-judgement-section" className="text-[length:var(--fs-body)] mb-2">{t("verifyRequiredCapabilitiesS3And")}</h3>
          {gapRows.length === 0 ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
              {t("requiredCapabilitiesAreNotYet")} <a href={`/synergy?opportunity=${encodeURIComponent(selected.opportunity.id)}`} className="text-[color:var(--accent)] underline">{t("synergyAndStrategicFitS3")}</a>{t("defineAndJudgeThemFirst")}
            </p>
          ) : !gapStored ? (
            <div className="mb-3">
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                {t("requiredCapabilitiesImportedFromThe")}
              </p>
              {canAct && (
                <button type="button" className="btn-ghost btn-sm" disabled={savingGaps} onClick={() => void saveGaps()}>
                  {savingGaps ? tc("saving") : t("saveToTheS3Register")}
                </button>
              )}
            </div>
          ) : (
            <div className="mb-3">
              <CapabilityJudgementEditor
                endpoint={`/api/opportunities/${encodeURIComponent(selected.opportunity.id)}/capability-attainability`}
                s3Href={`/deals/${encodeURIComponent(selected.opportunity.id)}/s3`}
                gap={{ opportunityId: selected.opportunity.id, rows: gapRows, setRows: setGapRows }}
                aiDraft
                onRowsChange={setAttRows}
                onEditorApi={(api) => { judgeApiRef.current = api; }}
                onDirtyChange={setJudgeDirty}
                /* 판정 dialog의 시작 연차 = 투자비 항목과 같은 cost-entry override (저장은 투자비 저장과 함께). */
                startYearFor={(id) => {
                  const v = capStartYear[id];
                  if (typeof v === "number" && Number.isFinite(v)) return v;
                  // 저장된 cost-entry override(있으면) — 없으면 판정 개월 기본값(라인의 유효 시작 연차).
                  return costView.lines.find((l) => l.capabilityKey === id)?.startYear ?? null;
                }}
                onStartYearChange={(id, v) => setCapStartYear((p) => ({ ...p, [id]: v ?? Number.NaN }))}
              />
            </div>
          )}
            </>
          ))}

          {/* ③ 인력 운영 계획 (ADR-0175) — saved through the investment lines save */}
          {panel("staffing", (
            <>
              <h3 className="text-[length:var(--fs-body)] mb-1">{t("staffingPlan")}</h3>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="staffing-save-note-text">{t("thisButtonSavesTheInvestment")}</p>
              {canAct && (
                <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="staffing-save-actions">
                  {linesSaveButton(t("saveLaborCostItems"))}
                  {investDirty
                    ? <span className="status-chip status-amber" role="status"><span aria-hidden="true">!</span> {tc("unsavedChanges")}</span>
                    : <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noChangesToSave")}</span>}
                </div>
              )}
              {linesNote && <p className="legacy-model-notice-text mb-2" role="status" data-testid="staffing-save-feedback">{linesNote}</p>}
              {linesError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{linesError}</p>}
          <StaffingPlanSection
            plan={staffEff}
            horizon={horizon}
            canAct={canAct}
            masked={selected.staffing_plan_masked === true}
            error={staffDirty ? staffError : null}
            warnings={staffWarnings}
            onChange={setStaffPlan}
            onDismiss={dismissStaffDup}
          />
            </>
          ))}

          {/* ④ 투자비 검토 요건 */}
          {panel("investment", (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="invest-source-summary" aria-label={t("investmentSourceSummary")}>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("sourceSummary")}</span>
                {sourceChips.map((c) => (
                  <button key={c.key} type="button" className={`status-chip ${c.key === "confirm" && issueCounts.invest + issueCounts.staff > 0 ? "status-amber" : "status-not-started"}`} title={t("goToTheP1Tab", { p1: GF_TAB_LABELS[c.tab] })} data-testid={`invest-source-chip-${c.key}`} onClick={() => setTab(c.tab)}>
                    <span aria-hidden="true">{c.icon}</span> {c.text}
                  </button>
                ))}
              </div>
          {/* ── LLM 투자비 항목 추천 — ADR-0118: 제안은 LLM, 저장은 사람 ── */}
          <div className="sizing-grade-card mb-3" data-testid="invest-reco">
            <h4 className="text-[length:var(--fs-caption)] mb-2 flex items-center justify-between gap-2">
              <span>{t("investmentItemRecommendation")} <span className="status-chip status-amber">{t("proposalAi")}</span></span>
              {!reco && (
                <button type="button" className="btn-ghost btn-sm" aria-expanded={recoOpen} aria-controls="invest-reco-body" data-testid="invest-reco-toggle" onClick={() => setRecoOpen((v) => !v)}>{recoOpen ? tc("collapse") : t("open")}</button>
              )}
            </h4>
            <div id="invest-reco-body" hidden={!reco && !recoOpen}>
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("entryStrategyAndRequiredCapability")}
            </p>
            {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
            {canAct && !reco && !recoLoading && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => void generateReco()}>{t("generateItemRecommendation")}</button>
            )}
            {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">{t("proposingItemsBasedOnThe")}</p>}
            {reco && (
              <>
                <p className="mb-1 text-[length:var(--fs-caption)]">
                  <span className={`status-chip mr-1 ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                    {reco.source === "llm" ? t("llmProposalP1", { p1: reco.provider ? ` · ${reco.provider}` : "" }) : tc("deterministicFallback")}
                  </span>
                </p>
                {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
                {reco.recommendation.investment_items ? (
                  <ul className="sizing-note-list mb-2">
                    {reco.recommendation.investment_items.map((item, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 mb-1">
                        <span>
                          <span className="font-semibold">{item.line}</span>
                          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> ({CATEGORY_LABEL(tr)[item.category]}{item.sub_category && validSubCategory(item.category, item.sub_category) ? t("p1", { p1: SUB_CATEGORY_LABEL[item.sub_category] }) : ""}) — {item.note}</span>
                        </span>
                        {canAct && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => addRecoItem(item)}>{tc("add")}</button>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("noProposedItems")}</p>
                )}
                {reco.recommendation.cautions.length > 0 && (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-2">{reco.recommendation.cautions.join(" / ")}</p>
                )}
                {canAct && <button type="button" className="btn-ghost btn-sm" disabled={recoLoading} onClick={() => void generateReco()}>{recoLoading ? tc("regenerating") : t("regenerateAi")}</button>}
              </>
            )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h3 className="text-[length:var(--fs-body)] m-0">{t("investmentItemsS8BusinessCase")}</h3>
            <div className="flex items-center gap-2" data-testid="invest-horizon">
              <label htmlFor="s5-horizon" className="text-[length:var(--fs-caption)]">{t("reviewPeriodYears")}</label>
              <input
                id="s5-horizon"
                type="number"
                min={MIN_HORIZON_YEARS}
                max={MAX_HORIZON_YEAR_LIMIT}
                value={horizon}
                disabled={!canAct}
                aria-describedby="s5-horizon-hint"
                onChange={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= MIN_HORIZON_YEARS && v <= MAX_HORIZON_YEAR_LIMIT) setHorizon(v); }}
                onBlur={(e) => { const v = Math.floor(Number(e.target.value) || DEFAULT_HORIZON_YEARS); setHorizon(Math.min(MAX_HORIZON_YEAR_LIMIT, Math.max(MIN_HORIZON_YEARS, v))); }}
                className="sizing-new-input sizing-new-input-sm"
                style={{ width: "4.5rem" }}
              />
              <span id="s5-horizon-hint" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("yearInputRangeSummaryAggregation")}</span>
            </div>
          </div>
          {canAct && <button type="button" className="btn-ghost btn-sm mb-2" onClick={() => setBcLines((prev) => [...prev, { line: "", category: undefined, amount: 0, amountUnit: AMOUNT_UNIT_KRW_M, amountUnitConfirmed: true, period: undefined, currency: "KRW" }])}>{t("addItem")}</button>}
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-unit-note">{t("chooseTheAmountUnitPer")}</p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-xref">{t("itemsReflectedFromCapabilityResolution")}</p>
          <div className="table-scroll mb-1">
          <table className="data-table table-fixed-pct tmin-80 invest-item-table" aria-label={t("investmentItemList")} data-testid="invest-item-list">
            <ColGroup widths={INVEST_ITEM_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{tc("itemName")}</th>
                <th scope="col">{tc("source")}</th>
                <th scope="col">{tc("classification")}</th>
                <th scope="col">{t("item2")}</th>
                <th scope="col">{t("amountAnnualizedOrPeriodTotal")}</th>
                <th scope="col">{tc("unit")}</th>
                <th scope="col">{tc("currency")}</th>
                <th scope="col">{tc("cycle")}</th>
                <th scope="col">{t("startAndEndYears")}</th>
                <th scope="col">{tc("notes")}</th>
                <th scope="col">{tc("actions")}</th>
              </tr>
            </thead>
            <tbody>
          {unifiedRows.map((row) => {
            if (row.kind === "capability") {
              const capLine = capLinesEff.find((c) => c.capabilityKey === row.capabilityKey);
              const capStart = capLine?.startYear ?? 1;
              const capEnd = capEndYear[row.capabilityKey] !== undefined && Number.isFinite(capEndYear[row.capabilityKey])
                ? Math.min(horizon, Math.max(capStart, capEndYear[row.capabilityKey]))
                : (capLine?.endYear ?? capStart);
              const capYearErr = yearErrors[`c${row.capabilityKey}`];
              return (
                <tr key={`c${row.capabilityKey}`} data-testid={`invest-cap-row-${row.capabilityKey}`}>
                  <td>
                    <input aria-label={tc("itemName")} value={row.name} readOnly className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-ro" />
                  </td>
                  <td><div className="invest-cell-chips">
                    <span className="status-chip status-not-started"><span aria-hidden="true">⛓</span> {t("capabilityResolutionLinkage")}</span>
                    {row.saveState === "saved" && !row.pendingRemoval && <span className="status-chip status-green"><span aria-hidden="true">✓</span> {t("reflectedSaved")}</span>}
                    {(row.saveState === "unsaved" || row.pendingRemoval) && <span className="status-chip status-amber"><span aria-hidden="true">!</span> {tc("unsaved")}{row.pendingRemoval ? t("unreflect") : ""}</span>}
                    {row.savedUnreflected && <span className="status-chip status-not-started" title={t("thisItemHasUnreflectionSaved")}>{t("notReflectedExcludedFromTotals")}</span>}
                    {row.needsRejudge && <span className="status-chip status-amber">{tc("rejudgeNeeded")}</span>}
                  </div></td>
                  <td>
                    <select aria-label={t("p1Classification", { p1: row.name })} value={row.category} disabled={!canAct} onChange={(e) => { const cat = e.target.value as CostCategory; setCapSel((p) => ({ ...p, [row.capabilityKey]: { ...p[row.capabilityKey], category: cat } })); judgeApiRef.current?.patchDraft(row.capabilityKey, { category: cat }); }} className="sizing-new-input sizing-new-input-sm invest-ctl">
                      {(["labor", "opex", "capex"] as CostCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL(tr)[c]}</option>)}
                    </select>
                  </td>
                  <td>
                    {/* ADR-0177: the judgement does not own a 세부 과목 yet, so the capability row's pick is editable here and stored on the entry. */}
                    <select aria-label={t("p12", { p1: row.name })} value={row.subCategory ?? ""} disabled={!canAct} onChange={(e) => { const v = e.target.value; setCapSel((p) => ({ ...p, [row.capabilityKey]: { ...p[row.capabilityKey], subCategory: v ? (v as SubCategoryKey) : null } })); }} className="sizing-new-input sizing-new-input-sm invest-ctl" data-testid={`invest-cap-sub-${row.capabilityKey}`}>
                      <SubCategoryOptions category={row.category} />
                    </select>
                    <div className="invest-cell-chips">
                      {!row.subCategory && row.suggestedSubCategory && (canAct
                        ? <button type="button" className="btn-ghost btn-sm" data-testid={`invest-cap-sub-suggest-${row.capabilityKey}`} onClick={() => setCapSel((p) => ({ ...p, [row.capabilityKey]: { ...p[row.capabilityKey], subCategory: row.suggestedSubCategory } }))}>{t("proposal")} {SUB_CATEGORY_LABEL[row.suggestedSubCategory]} {tc("apply")}</button>
                        : <span className="status-chip status-not-started">{t("proposal2")} {SUB_CATEGORY_LABEL[row.suggestedSubCategory]}</span>)}
                    </div>
                  </td>
                  <td>
                    <input aria-label={t("amountKrwMillions")} value={row.krwM} readOnly className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num invest-ctl-ro" />
                  </td>
                  <td><select aria-label={t("amountUnit")} value="krw_m" disabled className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-ro"><option value="krw_m">{tc("krwMillionUnit")}</option></select></td>
                  <td><select aria-label={t("baseCurrency")} value="KRW" disabled className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-ro"><option value="KRW">{CURRENCY_LABEL(tr).KRW}</option></select></td>
                  <td>
                    {/* 2026-10-18 decider ask — the linked line's cadence is person-editable (일시불 총액 or 연간 반복). */}
                    <select
                      aria-label={t("p1AmountBasisRecurringCycle", { p1: row.name })}
                      value={row.period ?? "lumpsum"}
                      disabled={!canAct}
                      data-testid={`invest-cap-period-${row.capabilityKey}`}
                      onChange={(e) => { const v = e.target.value as "lumpsum" | "yearly"; setCapSel((p) => ({ ...p, [row.capabilityKey]: { ...p[row.capabilityKey], period: v } })); judgeApiRef.current?.patchDraft(row.capabilityKey, { period: v }); }}
                      className="sizing-new-input sizing-new-input-sm invest-ctl"
                    >
                      {(Object.keys(PERIOD_LABEL) as BcPeriod[]).map((p2) => <option key={p2} value={p2}>{PERIOD_LABEL(tr)[p2]}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="invest-year-cell">
                      <label className="invest-year-field">
                        {t("start")}
                        <input
                          aria-label={t("p1ExecutionYear", { p1: row.name })}
                          type="number"
                          min={1}
                          max={horizon}
                          value={capStart}
                          disabled={!canAct}
                          onChange={(e) => { const raw = e.target.value; const v = Number(raw); setCapStartYear((p) => ({ ...p, [row.capabilityKey]: raw === "" || !Number.isFinite(v) ? Number.NaN : v })); }}
                          onBlur={(e) => { const v = Math.floor(Number(e.target.value) || 1); setCapStartYear((p) => ({ ...p, [row.capabilityKey]: Math.min(horizon, Math.max(1, v)) })); }}
                          className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num"
                        />
                      </label>
                      <label className="invest-year-field">
                        {t("end")}
                        <input
                          aria-label={t("p1EndYear", { p1: row.name })}
                          data-testid={`invest-cap-end-year-${row.capabilityKey}`}
                          type="number"
                          min={capStart}
                          max={horizon}
                          value={capEnd}
                          disabled={!canAct}
                          onChange={(e) => { const raw = e.target.value; const v = Number(raw); setCapEndYear((p) => ({ ...p, [row.capabilityKey]: raw === "" || !Number.isFinite(v) ? Number.NaN : v })); }}
                          onBlur={(e) => { const v = Math.floor(Number(e.target.value) || capStart); setCapEndYear((p) => ({ ...p, [row.capabilityKey]: Math.min(horizon, Math.max(capStart, v)) })); }}
                          className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num"
                        />
                      </label>
                    </div>
                    {capYearErr && <span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{capYearErr}</span>}
                  </td>
                  <td>
                    <input aria-label={tc("notes")} value={row.note} readOnly className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-ro" />
                  </td>
                  <td><div className="invest-action-cell">
                    <a href="#cap-judgement-section" onClick={(e) => { e.preventDefault(); goToCapabilityJudgement(); }} className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline">{t("viewJudgement")}</a>
                    {canAct && !row.pendingRemoval && <button type="button" className="btn-ghost btn-sm" aria-label={t("p1Unreflect", { p1: row.name })} onClick={() => setCapSel((p) => ({ ...p, [row.capabilityKey]: { ...p[row.capabilityKey], reflected: false } }))}>{t("unreflect2")}</button>}
                    {canAct && (row.pendingRemoval || row.savedUnreflected) && <button type="button" className="btn-ghost btn-sm" data-testid={`invest-cap-rereflect-${row.capabilityKey}`} aria-label={t("p1ReflectAgain", { p1: row.name })} onClick={() => setCapSel((p) => { const cur = p[row.capabilityKey] ?? {}; const { reflected: _d, ...rest } = cur; return { ...p, [row.capabilityKey]: { ...rest, reflected: true } }; })}>{t("reflectAgain")}</button>}
                  </div></td>
                </tr>
              );
            }
            const i = row.manualIndex;
            const l = bcLines[i];
            const issues = manualLineIssues(l);
            const canonical = manualLineKrwM(bcLinesKrw[i]);
            const fieldIssues = issues.filter((iss) => iss !== "unit");
            const confirmChip = fieldIssues.length > 0;
            const issueText = fieldIssues.length === 0 ? null : t("needsReviewP1", { p1: fieldIssues.map((iss) => ({ category: tc("classification"), period: tc("cycle"), currency: tc("currency"), unit: tc("unit") }[iss])).join("·") });
            const oversize = sanityLineOversize(canonical) && !sanityDismissed.has(i);
            return (
              <tr key={`m${i}`} data-testid={`invest-manual-row-${i}`}>
                <td>
                  <input aria-label={tc("itemName")} placeholder={t("itemNameEGEquipment")} value={l.line} onChange={(e) => setBc(i, { line: e.target.value })} className="sizing-new-input sizing-new-input-sm invest-ctl" />
                </td>
                <td>
                  <div className="invest-cell-chips">
                  <span className="status-chip status-not-started">{t("manual")}</span>
                  {manualRowDirty(i)
                    ? <span className="status-chip status-amber"><span aria-hidden="true">!</span> {tc("unsaved")}</span>
                    : <span className="status-chip status-green"><span aria-hidden="true">✓</span> {t("saved")}</span>}
                  {confirmChip && <span className="status-chip status-amber" title={issueText ?? undefined} data-testid={`invest-confirm-chip-${i}`}><span aria-hidden="true">!</span> {tc("needsCheck")}</span>}
                  {oversize && canAct && <button type="button" className="btn-ghost btn-sm" data-testid={`invest-sanity-${i}`} onClick={() => setSanityDismissed((prev) => new Set(prev).add(i))}>{tc("close")}</button>}
                  {yearErrors[`m${i}`] && <span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" data-testid={`invest-year-error-${i}`}>{yearErrors[`m${i}`]}</span>}
                  </div>
                </td>
                <td>
                  <select aria-label={tc("classification")} value={l.category ?? ""} onChange={(e) => { const cat = e.target.value as BcCategory; if (l.subCategory && !validSubCategory(cat, l.subCategory)) { setBc(i, { category: cat, subCategory: undefined }); } else setBc(i, { category: cat }); }} className={`sizing-new-input sizing-new-input-sm invest-ctl${l.amountUnit && l.amountUnitConfirmed ? "" : " invest-ctl-unset"}`} data-unit-unset={l.amountUnit && l.amountUnitConfirmed ? undefined : "true"}>
                    <option value="" disabled>{tc("select")}</option>
                    {(Object.keys(CATEGORY_LABEL) as BcCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL(tr)[c]}</option>)}
                  </select>
                </td>
                <td>
                  {l.category === "revenue" || l.category === "gov_rnd"
                    ? <select aria-label={t("p13", { p1: l.line || tc("items") })} value="" disabled className="sizing-new-input sizing-new-input-sm invest-ctl"><option value="">—</option></select>
                    : (
                      <select
                        aria-label={t("p14", { p1: l.line || tc("items") })}
                        value={l.subCategory ?? ""}
                        disabled={!canAct}
                        data-testid={`invest-manual-sub-${i}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) { setBc(i, { subCategory: undefined, legacySubCategory: undefined }); return; }
                          const d = subCategoryDef(v);
                          if (!d) return;
                          // Parent auto-derived on a row with no category; the default period is a suggestion for a row with none set.
                          setBc(i, { subCategory: d.key, legacySubCategory: undefined, ...(l.category ? {} : { category: SUB_CATEGORY_PARENT[d.key] }), ...(l.period ? {} : { period: d.defaultPeriod }) });
                        }}
                        className="sizing-new-input sizing-new-input-sm invest-ctl"
                      >
                        <SubCategoryOptions category={l.category} />
                      </select>
                    )}
                  <div className="invest-cell-chips">
                    {l.subCategory && subCategoryDef(l.subCategory)?.hint && <span className="status-chip status-not-started">{subCategoryDef(l.subCategory)?.hint}</span>}
                  </div>
                </td>
                <td>
                  <input aria-label={tc("amount")} type="number" placeholder={tc("amount")} value={l.amount || ""} onChange={(e) => setBc(i, { amount: Number(e.target.value) })} className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num" />
                  {(() => {
                    const lKrw = bcLinesKrw[i];
                    const amt = issues.length === 0 ? manualLineAmounts(lKrw, horizon) : null;
                    const fxApplied = (l.currency ?? "KRW") !== "KRW" && (lKrw.currency ?? "KRW") === "KRW";
                    if (!amt) return null;
                    return (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mono-num text-right whitespace-nowrap" data-testid={`invest-row-annualised-${i}`}>
                        {amt.annualKrwM !== null && <>{t("yr")} {fmtM(amt.annualKrwM)} · </>}{t("duration")} {fmtM(amt.totalKrwM)}{fxApplied ? t("fxApplied") : ""}
                      </span>
                    );
                  })()}
                </td>
                <td>
                  <select aria-label={t("amountUnit2")} value={l.amountUnit ?? ""} onChange={(e) => { const u = e.target.value as AmountUnit; setBc(i, { amountUnit: u, amountUnitConfirmed: true }); }} className="sizing-new-input sizing-new-input-sm invest-ctl">
                    <option value="" disabled>{tc("select")}</option>
                    {((l.currency === "KRW" ? ["krw", "krw_k", "krw_m", "krw_eok"] : ["fx_m", "fx_eok"]) as AmountUnit[]).map((u) => <option key={u} value={u}>{amountUnitLabel(u, l.currency ?? "KRW")}</option>)}
                  </select>
                </td>
                <td>
                  <select aria-label={t("baseCurrency2")} value={l.currency ?? "KRW"} onChange={(e) => { const c = e.target.value as BcCurrency; setBc(i, { currency: c, ...unitOnCurrencyChange(l, c) }); }} className="sizing-new-input sizing-new-input-sm invest-ctl">
                    {(Object.keys(CURRENCY_LABEL) as BcCurrency[]).map((c) => <option key={c} value={c}>{CURRENCY_LABEL(tr)[c]}</option>)}
                  </select>
                </td>
                <td>
                  <select aria-label={t("amountBasisRecurringCycleOr")} value={l.period ?? ""} onChange={(e) => setBc(i, { period: e.target.value as BcPeriod })} className="sizing-new-input sizing-new-input-sm invest-ctl">
                    <option value="" disabled>{tc("select")}</option>
                    {(Object.keys(PERIOD_LABEL) as BcPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL(tr)[p]}</option>)}
                  </select>
                </td>
                <td><div className="invest-year-cell">
                  {(l.startYear === 0 || (l.category === "capex" && l.period === "lumpsum")) && (
                    <label className="invest-year-field" data-testid={`invest-prelaunch-toggle-${i}`}>
                      <input
                        type="checkbox"
                        aria-label={t("p1Investment", { p1: l.line || tc("items") })}
                        checked={l.startYear === 0}
                        disabled={!canAct}
                        onChange={(e) => setBc(i, e.target.checked ? { startYear: 0, endYear: undefined } : { startYear: undefined })}
                      />
                      {t("investment")}
                    </label>
                  )}
                  {l.startYear === 0 ? (
                    <span className="status-chip status-amber" data-testid={`invest-prelaunch-chip-${i}`}>{t("item3")}</span>
                  ) : (
                  <label className="invest-year-field">
                    {t("start2")}
                    <input
                      aria-label={t("p1StartYear", { p1: l.line || tc("items") })}
                      type="number"
                      min={1}
                      max={horizon}
                      value={l.startYear ?? ""}
                      disabled={!canAct}
                      placeholder="Y1"
                      onChange={(e) => { const raw = e.target.value; const v = Number(raw); setBc(i, { startYear: raw === "" ? undefined : v }); }}
                      onBlur={(e) => { const v = Math.floor(Number(e.target.value) || 1); setBc(i, { startYear: Math.min(horizon, Math.max(1, v)) }); }}
                      className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num"
                    />
                  </label>
                  )}
                  {l.startYear !== 0 && l.period !== "lumpsum" && (
                    <label className="invest-year-field">
                      {t("end2")}
                      <input
                        aria-label={t("p1EndYear2", { p1: l.line || tc("items") })}
                        type="number"
                        min={1}
                        max={horizon}
                        value={l.endYear ?? ""}
                        disabled={!canAct}
                        placeholder={`Y${horizon}`}
                        onChange={(e) => { const raw = e.target.value; const v = Number(raw); setBc(i, { endYear: raw === "" ? undefined : v }); }}
                        onBlur={(e) => { const v = Math.floor(Number(e.target.value) || horizon); setBc(i, { endYear: Math.min(horizon, Math.max(1, v)) }); }}
                        className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num"
                      />
                    </label>
                  )}
                  {l.period === "lumpsum" && <span className="invest-year-field" aria-hidden="true" />}
                </div></td>
                <td>
                  <input aria-label={tc("notes")} placeholder={tc("notes")} value={l.note ?? ""} onChange={(e) => setBc(i, { note: e.target.value })} className="sizing-new-input sizing-new-input-sm invest-ctl" />
                </td>
                <td><div className="invest-action-cell">
                  {canAct && <button type="button" className="btn-ghost btn-sm whitespace-nowrap" aria-label={t("deleteP1", { p1: l.line || tc("items") })} title={t("deleteP12", { p1: l.line || tc("items") })} onClick={() => setBcLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>}
                </div></td>
              </tr>
            );
          })}
            </tbody>
          </table>
          </div>
          <p className="text-[length:var(--fs-caption)] mb-2" role="status" data-testid="invest-item-footer">{footer.text}</p>
          {invTotals.manualExcludedNeedsConfirm > 0 && (
            <p className="text-[length:var(--fs-caption)] mb-2" role="status" data-testid="invest-excluded-note">{tc("needsCheck")} {invTotals.manualExcludedNeedsConfirm}{t("itemSExcludedFromThe")}</p>
          )}
          {sanityTotalOversize(invTotals.grandKrwM) && !totalSanityDismissed && (
            <div className="flex items-center gap-1 mb-2" data-testid="invest-total-sanity">
              <span className="status-chip status-amber"><span aria-hidden="true">!</span> {t("theAmountIsVeryLarge")}</span>
              {canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => setTotalSanityDismissed(true)}>{tc("close")}</button>}
            </div>
          )}
          {canAct && (
            <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="invest-item-save-actions">
              {linesSaveButton(t("saveInvestmentItems"))}
              {investDirty
                ? <span className="status-chip status-amber" role="status" data-testid="invest-item-dirty-chip"><span aria-hidden="true">!</span> {tc("unsavedChanges")}</span>
                : <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="invest-item-clean-hint">{t("noChangesToSave2")}</span>}
              {hasYearErrors && <span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{tc("checkTenureInput")}</span>}
              <span id="invest-item-save-hint" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="invest-item-save-hint">{t("afterChangingItemsPressSave")}</span>
            </div>
          )}
          {linesNote && (
            <div className="legacy-model-notice mb-2 flex items-start justify-between gap-2" role="status" data-testid="invest-item-note">
              <p className="legacy-model-notice-text">{linesNote}</p>
              <button type="button" className="btn-ghost btn-sm" aria-label={t("closeSaveResult")} onClick={() => setLinesNote(null)}>{tc("close")}</button>
            </div>
          )}
          {linesError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2" data-testid="invest-item-error">{linesError}</p>}
          <CapabilityCostBlock
            lines={capLines}
            orphans={costView.orphans}
            totals={invTotals}
            warnings={dupWarnings}
            candidates={candidates}
            canAct={canAct}
            onToggle={(key, reflected) => setCapSel((p) => ({ ...p, [key]: { ...p[key], reflected } }))}
            onCategory={(key, category: CostCategory) => { setCapSel((p) => ({ ...p, [key]: { ...p[key], category } })); judgeApiRef.current?.patchDraft(key, { category }); }}
            onDismiss={dismissDup}
            reflection={{
              states: lineStates, dirty: reflectDirty, saving: costSaving, onReflect: () => void reflectCosts(),
              note: costNote === "__pending__" ? reflectedNote : costNote, error: costError, onDismissNote: () => setCostNote(null),
              saved: savedReflected, promoted: !!(selected.opportunity.promoted_at || selected.opportunity.project_id),
            }}
          />
          {/* ── 투자비 요약 (ADR-0174 slice 1) — read-only, decision support; last block of the tab ── */}
          <section className="sizing-grade-card mb-3" data-testid="invest-summary" aria-labelledby="invest-summary-title">
            <h4 id="invest-summary-title" className="text-[length:var(--fs-body)] mb-1">{t("investmentSummary")}</h4>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-summary-basis">
              {t("reviewPeriod")} {summary.horizon}{t("yrUnitKrwMillionsMonthly")}
            </p>
            <div className="summary-cards mb-2">
              <div className="summary-card glass" data-testid="invest-summary-annual">
                <span className="summary-value mono-num">{fmtM(summary.annualRecurringKrwM)}</span>
                <span className="text-label">{t("annualRecurringInvestmentKrwMillions")}</span>
              </div>
              <div className="summary-card glass" data-testid="invest-summary-lumpsum">
                <span className="summary-value mono-num">{fmtM(summary.lumpsumKrwM)}</span>
                <span className="text-label">{t("investmentKrwMillions")}</span>
              </div>
              <div className="summary-card glass" data-testid="invest-summary-total">
                <span className="summary-value mono-num">{fmtM(summary.totalKrwM)}</span>
                <span className="text-label">{t("totalInvestmentReviewPeriod")} {summary.horizon}{t("yrKrwMillions")}</span>
              </div>
              {hasPreLaunch && (
                <div className="summary-card glass" data-testid="invest-prelaunch-tile">
                  <span className="summary-value mono-num">{fmtM(summary.preLaunchKrwM ?? 0)}</span>
                  <span className="text-label">{t("investmentKrwMillionsIncludedIn")}</span>
                </div>
              )}
            </div>
            {hasPreLaunch && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" role="note" data-testid="invest-prelaunch-note">
                {t("investmentIsTheCapexLump")}
              </p>
            )}
            {/* Charts mount only while this tab is active (hidden panels give ECharts a 0-width container); every other panel stays mounted. */}
            {investTabActive && <InvestmentSummaryCharts summary={summary} />}
            <div className="table-scroll mb-2">
              <table className="data-table invest-summary-table invest-sticky-first" data-testid="invest-summary-schedule">
                <caption className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left">{t("investmentPlanByYearUnit")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{tc("division")}</th>
                    {hasPreLaunch && <th scope="col" className="col-num" data-testid="invest-prelaunch-col">{t("notStarted")}</th>}
                    {summary.schedule.map((s) => <th scope="col" className="col-num" key={s.year}>Y{s.year}</th>)}
                    <th scope="col" className="col-num">{tc("total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bySubCategory.map((g) => (
                    <Fragment key={g.category}>
                      <tr className="invest-total-row" data-testid={`invest-summary-cat-${g.category}`}>
                        <th scope="row">{CATEGORY_LABEL(tr)[g.category]}</th>
                        {hasPreLaunch && <td className="col-num mono-num" data-testid={`invest-prelaunch-cell-${g.category}`}>{fmtM(g.category === "capex" ? summary.preLaunchKrwM ?? 0 : 0)}</td>}
                        {summary.schedule.map((s) => <td className="col-num mono-num" key={s.year}>{fmtM(s[g.category])}</td>)}
                        <td className="col-num mono-num">{fmtM(schedTotals.rowTotals[g.category])}</td>
                      </tr>
                      {g.rows.map((r) => (
                        <tr key={`${g.category}:${r.key ?? "none"}`} data-testid={`invest-summary-sub-${g.category}-${r.key ?? "none"}`}>
                          <th scope="row" className="invest-sub-row-label">
                            {r.key === null ? t("p15", { p1: r.label }) : r.label}
                            {r.s5PlanExcluded && <span className="status-chip status-amber ml-1">{t("excludesNpvOnTheBasis")}</span>}
                            {r.hint && <span className="status-chip status-not-started ml-1">{r.hint}</span>}
                            {g.category === "labor" && staffActive && (r.key === STAFFING_SUB_CATEGORY.salary || r.key === STAFFING_SUB_CATEGORY.recruiting) && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] ml-1">{t("includingTheStaffingPlanLinkage")}</span>}
                          </th>
                          {hasPreLaunch && <td className="col-num mono-num">{fmtM(r.preLaunchKrwM ?? 0)}</td>}
                          {r.yearly.map((v, idx) => <td className="col-num mono-num" key={idx}>{fmtM(v)}</td>)}
                          <td className="col-num mono-num">{fmtM(r.totalKrwM)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  <tr className="invest-total-row" data-testid="invest-summary-year-total">
                    <th scope="row">{t("totalInvestmentExcludingRevenueAnd")}</th>
                    {hasPreLaunch && <td className="col-num mono-num" data-testid="invest-prelaunch-total">{fmtM(summary.preLaunchKrwM ?? 0)}</td>}
                    {schedTotals.yearTotals.map((v, idx) => <td className="col-num mono-num" key={idx}>{fmtM(v)}</td>)}
                    <td className="col-num mono-num">{fmtM(schedTotals.grandKrwM)}</td>
                  </tr>
                  <tr className="invest-inflow-row">
                    <th scope="row">{t("revenueInflowReferenceExcludedFrom")}</th>
                    {hasPreLaunch && <td className="col-num mono-num">{fmtM(0)}</td>}
                    {summary.schedule.map((s) => <td className="col-num mono-num" key={s.year}>{fmtM(s.revenue)}</td>)}
                    <td className="col-num mono-num">{fmtM(schedTotals.inflow.revenue)}</td>
                  </tr>
                  <tr className="invest-inflow-row">
                    <th scope="row">{t("governmentRDInflowReference")}</th>
                    {hasPreLaunch && <td className="col-num mono-num">{fmtM(0)}</td>}
                    {summary.schedule.map((s) => <td className="col-num mono-num" key={s.year}>{fmtM(s.govRnd)}</td>)}
                    <td className="col-num mono-num">{fmtM(schedTotals.inflow.govRnd)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("revenueAndGovernmentRD")}</p>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-subcategory-s8-note">{SUB_CATEGORY_S8_NOTE}</p>
            <ul className="list-none p-0 m-0" data-testid="invest-summary-flags">
              {summary.excludedNonKrw > 0 && <li className="text-[length:var(--fs-caption)]">{t("items")} {summary.excludedNonKrw}{t("itemSExcludedFromThe2")}</li>}
              {summary.excludedNeedsConfirm > 0 && <li className="text-[length:var(--fs-caption)]">{t("itemsNeedingConfirmation")} {summary.excludedNeedsConfirm}{t("itemSExcludedFromThe3")}</li>}
              {summary.endYearExceedsHorizon > 0 && <li className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))]">{t("itemsWhoseEndYearExceeds")} {summary.endYearExceedsHorizon}{t("itemSCountedWithinThe")}</li>}
              {summary.capabilitySpendFromMilestone > 0 && <li className="text-[length:var(--fs-caption)]">{t("executionYearsComputedFromThe")} {summary.capabilitySpendFromMilestone}{tc("countUnit")}</li>}
            </ul>
          </section>
            </>
          ))}

          {/* ⑤ 투자 시뮬레이션 — ADR-0176 slice 1: deterministic low/mode/high bands. */}
          {panel("simulation", (
            <section className="sizing-grade-card mb-3" data-testid="invest-simulation" aria-labelledby="invest-simulation-title">
              <h3 id="invest-simulation-title" className="text-[length:var(--fs-body)] mb-1">{t("investmentSimulationDeterministicBands")}</h3>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-simulation-basis">
                {t("reviewPeriod2")} {vectors.horizon}{t("yrUnitKrwMillionsAssumption")} {`±`}{(effA.salaryRange * 100).toFixed(0)}{t("upliftRates")} {`±`}{effA.salaryIncreaseRangePp}{t("capabilityCost2")} {`±`}{(effA.capabilityRange * 100).toFixed(0)}{t("generalItems3")} {`±`}{(effA.manualLineRange * 100).toFixed(0)}{t("deploymentTiming3")} {`±`}{effA.rampShiftHalfYears}{t("lowestHighestCombinationNoSampling")}
              </p>
              <div className="invest-item-error" role="alert" data-testid="invest-sim-param-error">{simOvError}</div>
              <div className="flex flex-wrap gap-2 items-end mb-2" data-testid="invest-sim-params">
                {SIM_OVERRIDE_KEYS.map((k) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="text-[length:var(--fs-caption)]">{SIM_PARAM_LABELS(tr)[k]}</span>
                    <input
                      type="number" min={0} step="any"
                      className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num"
                      style={{ width: "7.5rem" }}
                      value={simOv[k] ?? ""}
                      placeholder={String(SIM_PARAM_DEFAULTS[k])}
                      disabled={!canAct}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setSimOv((prev) => {
                          const next = { ...prev };
                          if (raw === "") { delete next[k]; return next; }
                          const n = Number(raw);
                          if (!Number.isFinite(n)) return prev;
                          next[k] = n;
                          return next;
                        });
                      }}
                      data-testid={`invest-sim-param-${k}`}
                    />
                  </label>
                ))}
                <button type="button" className="btn-ghost btn-sm" disabled={!canAct} onClick={() => setSimOv({})} data-testid="invest-sim-param-reset">{t("revertToDefault")}</button>
              </div>
              <div className="summary-cards mb-2">
                {([
                  ["low", t("lowest2"), "status-not-started"],
                  ["mode", tc("criteria"), "status-green"],
                  ["high", t("highest2"), "status-amber"],
                ] as const).map(([k, label, chip]) => (
                  <div className="summary-card glass" data-testid={`invest-simulation-${k}`} key={k}>
                    <span className="summary-value mono-num">{fmtM(vectors[k].grandKrwM)}</span>
                    <span className="text-label">{label} {t("totalInvestmentKrwMillions")} <span className={`status-chip ${chip}`} aria-hidden="true">{label}</span></span>
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("capability2")} {fmtM(vectors[k].capabilityKrwM)} {t("items2")} {fmtM(vectors[k].manualKrwM)}{vectors[k].preLaunchKrwM !== undefined && <> {t("notStarted2")} {fmtM(vectors[k].preLaunchKrwM ?? 0)} {t("included")}</>} {t("staffing2")} {fmtM(vectors[k].staffingKrwM)}</span>
                  </div>
                ))}
              </div>
              <div className="table-scroll mb-2">
                <table className="data-table invest-summary-table invest-sticky-first" data-testid="invest-simulation-schedule">
                  <caption className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left">{t("yearlyBandsUnitKrwMillions")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{tc("division")}</th>
                      {vectors.mode.preLaunchKrwM !== undefined && <th scope="col" className="col-num" data-testid="invest-prelaunch-sim-col">{t("notStarted3")}</th>}
                      {Array.from({ length: vectors.horizon }, (_, i) => <th scope="col" className="col-num" key={i}>Y{i + 1}</th>)}
                      <th scope="col" className="col-num">{tc("total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["low", "mode", "high"] as const).map((k) => (
                      <tr key={k} data-testid={`invest-simulation-row-${k}`}>
                        <th scope="row">{BAND_LABEL(tr)[k]}</th>
                        {vectors.mode.preLaunchKrwM !== undefined && <td className="col-num mono-num">{fmtM(vectors[k].preLaunchKrwM ?? 0)}</td>}
                        {vectors[k].totalByYear.map((v, i) => <td className="col-num mono-num" key={i}>{fmtM(v)}</td>)}
                        <td className="col-num mono-num">{fmtM(vectors[k].grandKrwM)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section className="mt-3" data-testid="invest-sim-run-section" aria-labelledby="invest-sim-run-title">
                <h4 id="invest-sim-run-title" className="text-[length:var(--fs-body)] mb-1">{t("probabilitySimulationMonteCarlo")}</h4>
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-sim-run-basis">
                  {t("extractsTriangularDistributionsLowEntered")}
                </p>
                <div className="flex flex-wrap gap-2 items-end mb-2" data-testid="invest-sim-run-controls">
                  <label className="flex flex-col gap-1">
                    <span className="text-[length:var(--fs-caption)]">{t("budgetCapKrwMillionsOptional")}</span>
                    <input type="number" min={0} step="any" className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num" style={{ width: "9rem" }} value={simEnvelope} disabled={!canAct} onChange={(e) => setSimEnvelope(e.target.value)} data-testid="invest-sim-envelope-input" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[length:var(--fs-caption)]">{t("drawCountOptional")}</span>
                    <input type="number" min={100} max={5000} step={1} placeholder="2000" className="sizing-new-input sizing-new-input-sm invest-ctl invest-ctl-num" style={{ width: "7.5rem" }} value={simDraws} disabled={!canAct} onChange={(e) => setSimDraws(e.target.value)} data-testid="invest-sim-draws-input" />
                  </label>
                  <button type="button" className="btn-primary btn-sm" disabled={!canAct || simRunning || !!simInputError} onClick={() => void runSimulation()} data-testid="invest-sim-run-button">{simRunning ? t("item4") : t("runAndSaveSimulation")}</button>
                </div>
                {simInputError && <div className="invest-item-error" role="alert" data-testid="invest-sim-input-error">{simInputError}</div>}
                {simRunError && <div className="invest-item-error" role="alert" data-testid="invest-sim-run-error">{simRunError}</div>}
                <p className="text-[length:var(--fs-caption)] mb-2" aria-live="polite" data-testid="invest-sim-status">
                  {simRun
                    ? <>{t("latestRun")} {new Date(simRun.created_at).toLocaleString("ko-KR")} · {simRun.created_by} · {simRun.draw_count}{t("drawsSeed")} {simRun.seed}{" "}
                      {simStale
                        ? <span className="status-chip status-amber" data-testid="invest-sim-stale"><span aria-hidden="true">!</span> {t("thePlanOrAssumptionScope")}</span>
                        : <span className="status-chip status-green" data-testid="invest-sim-fresh"><span aria-hidden="true">✓</span> {t("matchesTheCurrentPlan")}</span>}</>
                    : t("noSavedRunsRunningSaves")}
                </p>
                {simRun && (
                  <p className="text-[length:var(--fs-caption)] mb-2" data-testid="invest-sim-confirm">
                    {simRun.confirmed_at
                      ? <span className="status-chip status-green" data-testid="invest-sim-confirmed"><span aria-hidden="true">✓</span> {t("confirmed")} {simRun.confirmed_by}, {new Date(simRun.confirmed_at).toLocaleString("ko-KR")} {t("theS8CaseReflectsThis")}</span>
                      : <><span className="status-chip status-gray" data-testid="invest-sim-unconfirmed">{t("unconfirmedS8DoesNotUse")}</span>{" "}
                        <button type="button" className="btn-ghost btn-sm" disabled={!canAct || simConfirming || simStale} title={simStale ? t("thePlanOrAssumptionScope2") : t("onlyAPersonCanConfirm")} onClick={() => void confirmSimulation()} data-testid="invest-sim-confirm-button">{simConfirming ? t("item5") : t("confirmAssumptions")}</button></>}
                  </p>
                )}
                {simRun && (() => {
                  const r = simRun.results;
                  const tmax = Math.max(1e-9, ...r.tornado.map((t) => t.swingKrwM));
                  return (
                    <>
                      <div className="summary-cards mb-2" data-testid="invest-sim-envelope">
                        {([["p05", t("p05Bottom")], ["p50", t("p50Median")], ["p95", t("p95Top")]] as const).map(([k, label]) => (
                          <div className="summary-card glass" key={k} data-testid={`invest-sim-band-${k}`}>
                            <span className="summary-value mono-num">{fmtM(r.total[k])}</span>
                            <span className="text-label">{t("totalInvestment")} {label} {t("krwMillions")}</span>
                            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("basisDeterministic")} {fmtM(r.mode.grandKrwM)}</span>
                          </div>
                        ))}
                      </div>
                      {r.preLaunch && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-prelaunch-sim-note">{t("investmentP05")} {fmtM(r.preLaunch.p05)} · p50 {fmtM(r.preLaunch.p50)} · p95 {fmtM(r.preLaunch.p95)} {t("krwMillionsIncludedInThe")}</p>}
                      <div className="sizing-grade-card mb-2" data-testid="invest-sim-exceed">
                        {r.exceed
                          ? <span>{t("budgetCap")} {fmtM(r.exceed.envelopeKrwM)} {t("probabilityOfExceeding")} <strong className="mono-num">{(r.exceed.probability * 100).toFixed(1)}%</strong> ({r.exceed.exceedCount}/{r.draws}{t("drawsReferenceEstimationOnlyNo")}</span>
                          : <span className="text-[color:var(--muted-fg)]">{t("noBudgetCapSetEnter")}</span>}
                      </div>
                      <div className="table-scroll mb-2">
                        <table className="data-table invest-summary-table invest-sticky-first" data-testid="invest-sim-year-table">
                          <caption className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left">{t("p05P50P95ByYear")}</caption>
                          <thead>
                            <tr>
                              <th scope="col">{tc("division")}</th>
                              {Array.from({ length: r.horizon }, (_, i) => <th scope="col" className="col-num" key={i}>Y{i + 1}</th>)}
                              <th scope="col" className="col-num">{tc("total")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {([["total", tc("total"), r.totalByYear, r.total], ...(Object.keys(SIM_CATEGORY_LABEL(tr)) as Array<keyof ReturnType<typeof SIM_CATEGORY_LABEL>>).map((c) => [c, SIM_CATEGORY_LABEL(tr)[c], r.byCategory[c]?.byYear ?? null, r.byCategory[c]?.total ?? null] as const)] as Array<readonly [string, string, Array<{ p05: number; p50: number; p95: number }> | null, { p05: number; p50: number; p95: number } | null]>).map(([key, label, byYear, tot]) => (
                              <tr key={key} data-testid={`invest-sim-year-row-${key}`}>
                                <th scope="row">{label}</th>
                                {byYear && tot
                                  ? <>{byYear.map((b, i) => <td className="col-num mono-num" key={i}>{fmtM(b.p50)} <span className="text-[color:var(--muted-fg)]">({fmtM(b.p05)}~{fmtM(b.p95)})</span></td>)}<td className="col-num mono-num">{fmtM(tot.p50)} <span className="text-[color:var(--muted-fg)]">({fmtM(tot.p05)}~{fmtM(tot.p95)})</span></td></>
                                  : <td className="col-num" colSpan={r.horizon + 1}>{t("hiddenByPermission")}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mb-2" data-testid="invest-sim-tornado">
                        <div className="text-label mb-1">{t("sensitivityRankingOneAssumptionAt")}</div>
                        <ol className="list-none p-0 m-0">
                          {r.tornado.map((e) => (
                            <li key={e.key} className="flex items-center gap-2 mb-1" data-testid={`invest-sim-tornado-${e.key}`}>
                              <span style={{ width: "9rem" }}>{TORNADO_LABEL(tr)[e.key]}</span>
                              <span aria-hidden="true" style={{ display: "inline-block", height: "0.75rem", width: `${Math.round((e.swingKrwM / tmax) * 12 * 100) / 100}rem`, background: "var(--chart-1)", opacity: e.active ? 1 : 0.3 }} />
                              <span className="mono-num">{e.active ? `${fmtM(e.swingKrwM)} (${(e.share * 100).toFixed(0)}%)` : t("noImpact")}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </>
                  );
                })()}
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="invest-sim-note">
                  {t("thisSimulationOutputIsFor")}
                </p>
              </section>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="invest-simulation-note">
                {t("thisIsReferenceMaterialIt")}
              </p>
            </section>
          ))}
          </fieldset>
        </form>

        {/* ⑥ 검토/확정 — outside the form element (GateDecisionPanel owns its own forms); controls attach through form="greenfield-eval-form" */}
        {panel("review", (
          <>
            <h3 className="text-[length:var(--fs-body)] mb-1">{t("reviewConfirm")}</h3>
            <ul className="list-none p-0 m-0 mb-3" aria-label={t("completionCheck")} data-testid="gf-checklist">
              {checklist.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center gap-2 mb-1" data-testid={`gf-checklist-${c.key}`}>
                  <span className="font-semibold">{c.label}</span>
                  <span className={`status-chip ${c.status === "filled" ? "status-green" : c.status === "empty" ? "status-not-started" : "status-amber"}`}>
                    <span aria-hidden="true">{c.status === "filled" ? "✓" : c.status === "empty" ? "–" : "!"}</span> {c.statusText}
                  </span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setTab(c.tab)}>{GF_TAB_LABELS[c.tab]} {t("goToTheTab")}</button>
                </li>
              ))}
            </ul>
            {/* ADR-0194 item B: the two human-recorded inputs of kill criterion #5 (project-scoped, so only once promoted). Record/review buttons are secondary; the primary action stays below. */}
            {selected.opportunity.project_id && <SiteAnnouncementPanel projectId={selected.opportunity.project_id} canAct={canAct} />}
            <PrimaryAction
              inline
              form="greenfield-eval-form"
              label={t("evaluationRecordConfirmedByA2")}
              disabled={!canAct || busy || (entryStrategy.trim() === "" && entryModes.modes.length === 0)}
              disabledReason={!canAct ? t("evaluationRecordsRequireTheAnalyst") : busy ? tc("savingPolite") : t("runningUnlocksOnceAnEntry")}
            />
            <fieldset disabled={!canAct} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <input form="greenfield-eval-form" aria-label={t("evaluationEvidence")} placeholder={t("evaluationEvidenceCitingTheS1")} value={rationale} onChange={(e) => setRationale(e.target.value)} className="sizing-new-input mb-3" style={{ width: "100%" }} />
              {canAct && <button type="submit" form="greenfield-eval-form" className="btn-ghost" disabled={busy || hasYearErrors} title={hasYearErrors ? tc("checkTenureInput") : undefined}>{tc("save")}</button>}
            </fieldset>

            <GateDecisionPanel opportunityId={selected.opportunity.id} gates={["pre_fs"]} />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("theReviewGateAbove")} <b>{tc("inProgress")}</b>{t("mustBeRecordedBeforeThe")}
            </p>
            <PromotionPanel
              opportunityId={selected.opportunity.id}
              heading={t("p1ProceedAsAProject", { p1: selected.opportunity.name })}
            />
          </>
        ))}
      </section>
    </>
  );
}
