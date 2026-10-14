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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { CapabilityJudgementEditor } from "./CapabilityJudgementEditor.tsx";
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
import { EntryStrategySection } from "./EntryStrategySection.tsx";
import { parseEntryStrategy, serializeEntryStrategy, type EntryFormState, type EntryModes } from "../../lib/greenfield-entry-strategy.ts";
import {
  AMOUNT_UNIT_KRW_M, amountUnitLabel, applySelection, buildInvestmentSummary, DEFAULT_HORIZON_YEARS, deriveCapabilityCostLines, findDuplicateWarnings, formatKrwM, hasUnsavedReflection, investmentTotals, isCapabilityEntry, isFxUnit, isPlanMetaEntry, lineSaveStates, manualLineIssues, manualLineKrwM, MAX_HORIZON_YEAR_LIMIT, MIN_HORIZON_YEARS, normalizeLegacyLine, planMetaOf, reflectionBody, reflectionSummary, sanityLineOversize, sanityTotalOversize, selectionPayload, unifiedFooter, unifiedInvestmentRows, validateLineYears,
  type AmountUnit, type CapabilityCostView, type CostCategory, type CostSelection, type DuplicateWarning, type ManualCostLine, type MilestoneCandidateView, type PlanMetaEntry,
} from "../../lib/capability-cost-lines.ts";
import type { AttainabilityRowView } from "../../lib/capability-attainability.ts";

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
    investment_items: Array<{ line: string; category: "labor" | "opex" | "capex" | "revenue" | "gov_rnd"; note: string }> | null;
    key_evidence: string[];
    cautions: string[];
  };
}

// ADR-0137 — S8 business_case_line.category/period/currency 어휘(승격 시 그대로 이관).
type BcCategory = NonNullable<BcLine["category"]>;
type BcCurrency = NonNullable<BcLine["currency"]>;
type BcPeriod = NonNullable<BcLine["period"]>;
const CATEGORY_LABEL: Record<BcCategory, string> = { labor: "인건비", opex: "운영비", capex: "설비투자", revenue: "수익", gov_rnd: "정부 R&D" };
const PERIOD_LABEL: Record<BcPeriod, string> = { monthly: "월", quarterly: "분기", yearly: "년", lumpsum: "일시불(총액)" };
const CURRENCY_LABEL: Record<BcCurrency, string> = { KRW: "원화", USD: "달러", EUR: "유로", JPY: "엔화", CNY: "위안" };
// Unified investment item table: 10 shared columns (Onyx table-fixed-pct system).
const INVEST_ITEM_COL_PCT = [16, 12, 9, 9, 7, 7, 8, 10, 14, 8] as const;

export function GreenfieldStage({ opportunityId, onSaved }: { opportunityId: string; onSaved?: () => void }) {
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
  const [attRows, setAttRows] = useState<AttainabilityRowView[] | null>(null);
  // ADR-0118 — S5 투자비 검토 요건 LLM 추천(제안). 저장은 사람의 행위다.
  const [reco, setReco] = useState<InvestmentReco | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

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
          // Legacy manual lines are shown as-entered: the unit is unknown, so nothing is converted
          // and the row keeps a "단위 확인 필요" chip until a person picks a unit.
          const manual = (all.filter((l) => !isCapabilityEntry(l) && !isPlanMetaEntry(l)) as Array<Record<string, unknown>>).map(normalizeLegacyLine);
          setBcLines(manual);
          setSavedManualLines(manual);
          setStoredCapEntries(all.filter((l) => isCapabilityEntry(l)));
          setCapSel({});
          setCapStartYear({});
        }
        if (scope === "all") setRationale(r.data.assessment?.rationale ?? "");
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "평가 불러오기 실패"));
  }, []);

  const loadGaps = useCallback((oppId: string) => {
    api.get<GapGetResponse>(`/api/opportunities/${encodeURIComponent(oppId)}/capability-gap`)
      .then((r) => { setGapRows(r.data.rows); setGapStored(r.data.stored); })
      .catch((e) => setError(e instanceof Error ? e.message : "필요 역량 불러오기 실패"));
  }, []);

  useEffect(() => {
    setSelected(null); setGapRows([]); setReco(null); setRecoError(null);
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
      setRecoError(err instanceof Error ? err.message : "추천 생성 실패");
    } finally {
      setRecoLoading(false);
    }
  }, [selected, recoLoading]);

  // 추천 항목 추가 — 기존 목록을 덮어쓰지 않고 뒤에 이어붙인다. 금액은 사람이
  // 입력한다(LLM은 금액을 지어내지 않음, 경계 #2).
  function addRecoItem(item: { line: string; category: BcCategory; note: string }) {
    setBcLines((prev) => [...prev, { line: item.line, category: item.category, amount: 0, amountUnit: AMOUNT_UNIT_KRW_M, amountUnitConfirmed: true, note: item.note, currency: "KRW" }]);
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
      return Number.isInteger(y) && y >= 1 ? { ...l, startYear: y } : l;
    }),
    [capLines, capStartYear],
  );
  const reflectedLines = capLines.filter((l) => l.reflected);
  const invTotals = investmentTotals(costView, new Set(reflectedLines.map((l) => l.capabilityKey)), bcLines);
  const dupWarnings = findDuplicateWarnings(reflectedLines, bcLines);
  const reflectedKeySet = useMemo(() => new Set(reflectedLines.map((l) => l.capabilityKey)), [reflectedLines]);
  // ADR-0174 slice 1 — 투자비 요약 recomputed from the page state (read-only, decision support).
  const summary = useMemo(
    () => buildInvestmentSummary(bcLines, capLinesEff, horizon, reflectedKeySet),
    [bcLines, capLinesEff, horizon, reflectedKeySet],
  );
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
  const investDirty = manualDirty || reflectDirty;
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

  const setBc = (i: number, patch: Partial<BcLine>) => setBcLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // plan_meta entry prepended to every business_case_lines payload (ADR-0174 slice 1); horizon clamped client-side.
  const metaEntry = (): PlanMetaEntry => ({ source: "plan_meta", horizonYears: Math.min(MAX_HORIZON_YEAR_LIMIT, Math.max(MIN_HORIZON_YEARS, Math.floor(horizon) || DEFAULT_HORIZON_YEARS)) });
  // Capability entries carry the person's choices plus any spend-year override (startYear).
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
      setError(err instanceof Error ? err.message : "필요 역량 저장 실패");
    } finally {
      setSavingGaps(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
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
      setError(err instanceof Error ? err.message : "저장 실패");
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
      setEntryNote(`저장됨 · ${hhmm()}`);
      onSaved?.();
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : "진출전략 저장 실패");
    } finally {
      setEntrySaving(false);
    }
  }

  // 선택한 비용을 투자비에 반영 — POSTs ONLY business_case_lines; reloads so every line shows its saved state.
  async function reflectCosts() {
    if (!selected || costSaving) return;
    setCostSaving(true); setCostError(null); setCostNote(null);
    try {
      const body = reflectionBody(bcLines, capLines, capSel);
      await api.post(`/api/greenfield/${selected.opportunity.id}`, { business_case_lines: [metaEntry(), ...body.business_case_lines.map((l) => (isCapabilityEntry(l) && capStartYear[(l as { capabilityKey: string }).capabilityKey] !== undefined ? { ...l, startYear: capStartYear[(l as { capabilityKey: string }).capabilityKey] } : l))] });
      await loadDetail(selected.opportunity.id, "cost");
      setCostNote("__pending__");
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "amount_mismatch") {
        setAttRows(null);
        await loadDetail(selected.opportunity.id, "cost");
        setCostError(`${err.message} 최신 판정으로 다시 불러왔습니다 — 금액을 확인한 뒤 다시 반영하세요.`);
      } else {
        setCostError(err instanceof Error ? err.message : "투자비 반영 실패");
      }
    } finally {
      setCostSaving(false);
    }
  }

  // 투자비 항목 저장 — lines-only partial POST: manual lines as held + capability selections
  // (selectionPayload). 다른 평가 필드는 보내지 않으므로 라우트가 저장값을 그대로 유지한다.
  async function saveInvestmentLines() {
    if (!selected || linesSaving || !investDirty) return;
    setLinesSaving(true); setLinesError(null); setLinesNote(null);
    try {
      const body = reflectionBody(bcLines, capLines, capSel);
      await api.post(`/api/greenfield/${selected.opportunity.id}`, {
        business_case_lines: [metaEntry(), ...body.business_case_lines.map((l) => (isCapabilityEntry(l) && capStartYear[(l as { capabilityKey: string }).capabilityKey] !== undefined ? { ...l, startYear: capStartYear[(l as { capabilityKey: string }).capabilityKey] } : l))],
      });
      const savedCount = body.business_case_lines.length;
      await loadDetail(selected.opportunity.id, "cost");
      setLinesNote(`${savedCount}건 저장 · 합계 ${formatKrwM(invTotals.grandKrwM)}`);
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "amount_mismatch") {
        setAttRows(null);
        await loadDetail(selected.opportunity.id, "cost");
        setLinesError(`${err.message} 최신 판정으로 다시 불러왔습니다 — 금액을 확인한 뒤 다시 저장하세요.`);
      } else {
        setLinesError(err instanceof Error ? err.message : "투자비 항목 저장 실패");
      }
    } finally {
      setLinesSaving(false);
    }
  }

  if (!selected) {
    return (
      <>
        <PrimaryAction label="타당성 검토 실행" disabled disabledReason="평가할 기회를 불러오면 실행할 수 있습니다." />
        <p role="status" aria-live="polite">
          {error
            ? <span role="alert" className="text-[color:var(--red-fg)]">{error}</span>
            : "불러오는 중..."}
        </p>
      </>
    );
  }

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S5")} />

      <section aria-label="자체 진출" className="market-section">
        <SectionToolbar
          title={`${selected.opportunity.name} — 자체 진출`}
          icon=""
          summary={
            <span className="flex items-center gap-1">
              <span className="status-chip status-not-started" title="P4 실행형: 평가 구성요소 진행 — S11 설립실행과 동일 상태 어휘">
                {selected.opportunity.assessed_at ? "완료" : "진행 중"} · {[entryStrategy !== "" || entryModes.modes.length > 0, gapRows.length > 0, bcLines.length > 0 || reflectedLines.length > 0].filter(Boolean).length}/3 구성요소
              </span>
              {selected.opportunity.assessed_at && <span className="status-chip status-green">평가 기록 v1+</span>}
            </span>
          }
        />
        <PrimaryAction
          form="greenfield-eval-form"
          label="타당성 검토 실행"
          disabled={!canAct || busy || (entryStrategy.trim() === "" && entryModes.modes.length === 0)}
          disabledReason={!canAct ? "평가 기록은 analyst 권한이 필요합니다." : busy ? "저장 중입니다." : "진출 방식을 선택하거나 선택 근거를 입력하면 실행할 수 있습니다."}
        />
        <form id="greenfield-eval-form" onSubmit={save} className="sizing-new-form">
          <fieldset disabled={!canAct} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {/* 1. 진출전략 */}
          <EntryStrategySection
            opportunityId={selected.opportunity.id}
            value={{ modes: entryModes, rationale: entryStrategy, alternatives }}
            onChange={(v: EntryFormState) => { entryDirty.current = true; setEntryIsDirty(true); setEntryModes(v.modes); setEntryStrategy(v.rationale); setAlternatives(v.alternatives); }}
            canAct={canAct}
            rows={(attRows ?? gapRows.map((r) => ({ capability: r.capability, resolution: r.resolution }))).map((r) => ({ capability: r.capability, resolution: r.resolution }))}
            resetKey={entryReset}
            save={{ dirty: entryIsDirty, saving: entrySaving, onSave: () => void saveStrategy(), note: entryNote, error: entryError, onDismissNote: () => setEntryNote(null) }}
          />

          {/* 2. 필요 역량 — S3 정의 읽기 전용 + S5 달성 가능성 판정 편집 (ADR-0171) */}
          <h3 id="cap-judgement-section" className="text-[length:var(--fs-body)] mb-2">2️⃣ 필요 역량 (S3) 확인 · 달성 가능성 판정</h3>
          {gapRows.length === 0 ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
              아직 S3에 필요 역량이 정의되지 않았습니다 — <a href={`/synergy?opportunity=${encodeURIComponent(selected.opportunity.id)}`} className="text-[color:var(--accent)] underline">시너지·전략적 적합성(S3)</a>에서 먼저 정의·판정하세요.
            </p>
          ) : !gapStored ? (
            <div className="mb-3">
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                S2 스케치에서 가져온 필요 역량이 아직 S3 레지스터에 저장되지 않았습니다 — 저장한 뒤 달성 가능성을 판정할 수 있습니다.
              </p>
              {canAct && (
                <button type="button" className="btn-ghost btn-sm" disabled={savingGaps} onClick={() => void saveGaps()}>
                  {savingGaps ? "저장 중..." : "S3 레지스터에 저장"}
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
              />
            </div>
          )}

          {/* 3. 투자비 검토 요건 */}
          <h3 className="text-[length:var(--fs-body)] mb-1">3️⃣ 투자비 검토 요건 (S8 사업성 분석 입력)</h3>
          {canAct && (
            <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="invest-item-save-actions">
              <button
                type="button"
                className={investDirty && !hasYearErrors ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
                disabled={linesSaving || !investDirty || hasYearErrors}
                title={hasYearErrors ? "연차 입력을 확인하세요" : undefined}
                aria-describedby="invest-item-save-hint"
                onClick={() => void saveInvestmentLines()}
              >
                {linesSaving ? "저장 중…" : "투자비 항목 저장"}
              </button>
              {investDirty
                ? <span className="status-chip status-amber" role="status" data-testid="invest-item-dirty-chip"><span aria-hidden="true">!</span> 저장하지 않은 변경</span>
                : <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="invest-item-clean-hint">저장할 변경 없음</span>}
              {hasYearErrors && <span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">연차 입력을 확인하세요</span>}
              <span id="invest-item-save-hint" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="invest-item-save-hint">항목 변경 후 투자비 항목 저장을 누르세요</span>
            </div>
          )}
          {linesNote && (
            <div className="legacy-model-notice mb-2 flex items-start justify-between gap-2" role="status" data-testid="invest-item-note">
              <p className="legacy-model-notice-text">{linesNote}</p>
              <button type="button" className="btn-ghost btn-sm" aria-label="저장 결과 닫기" onClick={() => setLinesNote(null)}>닫기</button>
            </div>
          )}
          {linesError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2" data-testid="invest-item-error">{linesError}</p>}
          <div className="flex items-center gap-2 mb-2">
            <label htmlFor="s5-horizon" className="text-[length:var(--fs-caption)]">검토 기간(년)</label>
            <input
              id="s5-horizon"
              aria-label="검토 기간(년)"
              type="number"
              min={MIN_HORIZON_YEARS}
              max={MAX_HORIZON_YEAR_LIMIT}
              value={horizon}
              disabled={!canAct}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= MIN_HORIZON_YEARS && v <= MAX_HORIZON_YEAR_LIMIT) setHorizon(v); }}
              onBlur={(e) => { const v = Math.floor(Number(e.target.value) || DEFAULT_HORIZON_YEARS); setHorizon(Math.min(MAX_HORIZON_YEAR_LIMIT, Math.max(MIN_HORIZON_YEARS, v))); }}
              className="sizing-new-input sizing-new-input-sm"
              style={{ width: "4.5rem" }}
            />
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">S8 사업계획 기간의 초기값이 됩니다</span>
          </div>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-unit-note">금액 단위는 항목마다 선택합니다 (기본 백만원) — 단위·분류·주기가 확인된 항목만 합계에 포함됩니다.</p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-xref">반영된 항목은 아래 투자비 항목 목록에 포함됩니다.</p>
          <CapabilityCostBlock
            lines={capLines}
            orphans={costView.orphans}
            totals={invTotals}
            warnings={dupWarnings}
            candidates={candidates}
            canAct={canAct}
            onToggle={(key, reflected) => setCapSel((p) => ({ ...p, [key]: { ...p[key], reflected } }))}
            onCategory={(key, category: CostCategory) => setCapSel((p) => ({ ...p, [key]: { ...p[key], category } }))}
            onDismiss={dismissDup}
            reflection={{
              states: lineStates, dirty: reflectDirty, saving: costSaving, onReflect: () => void reflectCosts(),
              note: costNote === "__pending__" ? reflectedNote : costNote, error: costError, onDismissNote: () => setCostNote(null),
              saved: savedReflected, promoted: !!(selected.opportunity.promoted_at || selected.opportunity.project_id),
            }}
          />
          <div className="table-scroll mb-1">
          <table className="data-table table-fixed-pct tmin-56" aria-label="투자비 항목 목록" data-testid="invest-item-list">
            <ColGroup widths={INVEST_ITEM_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">항목명</th>
                <th scope="col">출처</th>
                <th scope="col">분류</th>
                <th scope="col">금액(백만원)</th>
                <th scope="col">단위</th>
                <th scope="col">통화</th>
                <th scope="col">주기</th>
                <th scope="col">시작·종료 연차</th>
                <th scope="col">비고</th>
                <th scope="col">작업</th>
              </tr>
            </thead>
            <tbody>
          {unifiedRows.map((row) => {
            if (row.kind === "capability") {
              const capLine = capLinesEff.find((c) => c.capabilityKey === row.capabilityKey);
              const capStart = capLine?.startYear ?? 1;
              const capYearErr = yearErrors[`c${row.capabilityKey}`];
              return (
                <tr key={`c${row.capabilityKey}`} data-testid={`invest-cap-row-${row.capabilityKey}`}>
                  <td>
                    <input aria-label="항목명" value={row.name} readOnly className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} />
                  </td>
                  <td>
                    <span className="status-chip status-not-started"><span aria-hidden="true">⛓</span> 역량 해소 연동</span>
                    {row.saveState === "saved" && !row.pendingRemoval && <><br /><span className="status-chip status-green"><span aria-hidden="true">✓</span> 반영됨 · 저장됨</span></>}
                    {(row.saveState === "unsaved" || row.pendingRemoval) && <><br /><span className="status-chip status-amber"><span aria-hidden="true">!</span> 저장 전{row.pendingRemoval ? " · 반영 해제" : ""}</span></>}
                    {row.needsRejudge && <><br /><span className="status-chip status-amber">재판정 필요</span></>}
                  </td>
                  <td>
                    <select aria-label={`${row.name} 분류`} value={row.category} disabled={!canAct} onChange={(e) => setCapSel((p) => ({ ...p, [row.capabilityKey]: { ...p[row.capabilityKey], category: e.target.value as CostCategory } }))} className="sizing-new-input sizing-new-input-sm">
                      {(["labor", "opex", "capex"] as CostCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                    </select>
                  </td>
                  <td>
                    <input aria-label="금액(백만원)" value={row.krwM} readOnly className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} />
                  </td>
                  <td><span className="text-[length:var(--fs-caption)]">백만원</span></td>
                  <td><span className="text-[length:var(--fs-caption)]">원화</span></td>
                  <td><span className="text-[length:var(--fs-caption)]">{PERIOD_LABEL.lumpsum}</span></td>
                  <td>
                    <label className="text-[length:var(--fs-caption)] flex items-center gap-0.5">
                      집행 연차
                      <input
                        aria-label={`${row.name} 집행 연차`}
                        type="number"
                        min={1}
                        max={horizon}
                        value={capStart}
                        disabled={!canAct}
                        onChange={(e) => { const raw = e.target.value; const v = Number(raw); setCapStartYear((p) => ({ ...p, [row.capabilityKey]: raw === "" || !Number.isFinite(v) ? Number.NaN : v })); }}
                        onBlur={(e) => { const v = Math.floor(Number(e.target.value) || 1); setCapStartYear((p) => ({ ...p, [row.capabilityKey]: Math.min(horizon, Math.max(1, v)) })); }}
                        className="sizing-new-input sizing-new-input-sm"
                        style={{ width: "3.5rem" }}
                      />
                    </label>
                    {capYearErr && <span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{capYearErr}</span>}
                  </td>
                  <td>
                    <input aria-label="비고" value={row.note} readOnly className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} />
                  </td>
                  <td>
                    <a href="#cap-judgement-section" className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline">판정 보기</a>
                    {canAct && !row.pendingRemoval && <button type="button" className="btn-ghost btn-sm" aria-label={`${row.name} 반영 해제`} onClick={() => setCapSel((p) => ({ ...p, [row.capabilityKey]: { ...p[row.capabilityKey], reflected: false } }))}>반영 해제</button>}
                  </td>
                </tr>
              );
            }
            const i = row.manualIndex;
            const l = bcLines[i];
            const issues = manualLineIssues(l);
            const canonical = manualLineKrwM(l);
            const unitSel = l.amountUnit;
            const unitLabel = unitSel ? amountUnitLabel(unitSel, l.currency ?? "KRW") : null;
            const confirmChip = issues.length > 0;
            const chipText = issues.includes("unit") ? "단위 확인 필요" : "확인 필요";
            const issueText = issues.length === 0 ? null : `확인 필요: ${issues.map((iss) => ({ category: "분류", period: "주기", currency: "통화", unit: "단위" }[iss])).join("·")}`;
            const oversize = sanityLineOversize(canonical) && !sanityDismissed.has(i);
            return (
              <tr key={`m${i}`} data-testid={`invest-manual-row-${i}`}>
                <td>
                  <input aria-label="항목명" placeholder="항목명 (예: 설비 투자, 연매출)" value={l.line} onChange={(e) => setBc(i, { line: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} />
                </td>
                <td>
                  <span className="status-chip status-not-started">수동</span>
                  {manualRowDirty(i)
                    ? <><br /><span className="status-chip status-amber"><span aria-hidden="true">!</span> 저장 전</span></>
                    : <><br /><span className="status-chip status-green"><span aria-hidden="true">✓</span> 저장됨</span></>}
                  {confirmChip && <><br /><span className="status-chip status-amber" title={issueText ?? undefined} data-testid={`invest-confirm-chip-${i}`}><span aria-hidden="true">!</span> {chipText}</span></>}
                  {oversize && canAct && <><br /><button type="button" className="btn-ghost btn-sm" data-testid={`invest-sanity-${i}`} onClick={() => setSanityDismissed((prev) => new Set(prev).add(i))}>닫기</button></>}
                  {yearErrors[`m${i}`] && <><br /><span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" data-testid={`invest-year-error-${i}`}>{yearErrors[`m${i}`]}</span></>}
                </td>
                <td>
                  <select aria-label="분류" value={l.category ?? ""} onChange={(e) => setBc(i, { category: e.target.value as BcCategory })} className="sizing-new-input sizing-new-input-sm">
                    <option value="" disabled>선택</option>
                    {(Object.keys(CATEGORY_LABEL) as BcCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </td>
                <td>
                  <input aria-label="금액" type="number" placeholder="금액" value={l.amount || ""} onChange={(e) => setBc(i, { amount: Number(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "7rem" }} />
                  <br /><span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid={`invest-unit-text-${i}`}>{canonical !== null ? `= ${formatKrwM(canonical)}` : unitSel && isFxUnit(l.amountUnit) ? `= ${l.amount.toLocaleString("ko-KR")} ${unitLabel} (환율 미반영 — 합계 제외)` : "단위를 고르면 금액이 계산됩니다"}</span>
                </td>
                <td>
                  <select aria-label="금액 단위" value={l.amountUnit ?? ""} onChange={(e) => { const u = e.target.value as AmountUnit; setBc(i, { amountUnit: u, amountUnitConfirmed: true }); }} className="sizing-new-input sizing-new-input-sm">
                    <option value="" disabled>선택</option>
                    {((l.currency === "KRW" ? ["krw", "krw_k", "krw_m", "krw_eok"] : ["fx_m", "fx_eok"]) as AmountUnit[]).map((u) => <option key={u} value={u}>{amountUnitLabel(u, l.currency ?? "KRW")}</option>)}
                  </select>
                </td>
                <td>
                  <select aria-label="기준 통화" value={l.currency ?? "KRW"} onChange={(e) => { const c = e.target.value as BcCurrency; setBc(i, { currency: c, amountUnit: c === "KRW" ? "krw_m" : "fx_m" }); }} className="sizing-new-input sizing-new-input-sm">
                    {(Object.keys(CURRENCY_LABEL) as BcCurrency[]).map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
                  </select>
                </td>
                <td>
                  <select aria-label="금액 기준 (반복 주기 또는 일시불)" value={l.period ?? ""} onChange={(e) => setBc(i, { period: e.target.value as BcPeriod })} className="sizing-new-input sizing-new-input-sm">
                    <option value="" disabled>선택</option>
                    {(Object.keys(PERIOD_LABEL) as BcPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
                  </select>
                </td>
                <td>
                  <label className="text-[length:var(--fs-caption)] flex items-center gap-0.5">
                    시작
                    <input
                      aria-label={`${l.line || "항목"} 시작 연차`}
                      type="number"
                      min={1}
                      max={horizon}
                      value={l.startYear ?? ""}
                      disabled={!canAct}
                      placeholder="Y1"
                      onChange={(e) => { const raw = e.target.value; const v = Number(raw); setBc(i, { startYear: raw === "" ? undefined : v }); }}
                      onBlur={(e) => { const v = Math.floor(Number(e.target.value) || 1); setBc(i, { startYear: Math.min(horizon, Math.max(1, v)) }); }}
                      className="sizing-new-input sizing-new-input-sm"
                      style={{ width: "3.5rem" }}
                    />
                  </label>
                  {l.period !== "lumpsum" && (
                    <label className="text-[length:var(--fs-caption)] flex items-center gap-0.5">
                      종료
                      <input
                        aria-label={`${l.line || "항목"} 종료 연차`}
                        type="number"
                        min={1}
                        max={horizon}
                        value={l.endYear ?? ""}
                        disabled={!canAct}
                        placeholder={`Y${horizon}`}
                        onChange={(e) => { const raw = e.target.value; const v = Number(raw); setBc(i, { endYear: raw === "" ? undefined : v }); }}
                        onBlur={(e) => { const v = Math.floor(Number(e.target.value) || horizon); setBc(i, { endYear: Math.min(horizon, Math.max(1, v)) }); }}
                        className="sizing-new-input sizing-new-input-sm"
                        style={{ width: "3.5rem" }}
                      />
                    </label>
                  )}
                </td>
                <td>
                  <input aria-label="비고" placeholder="비고" value={l.note ?? ""} onChange={(e) => setBc(i, { note: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} />
                </td>
                <td>
                  {canAct && <button type="button" className="btn-ghost btn-sm" aria-label="항목 삭제" onClick={() => setBcLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>}
                </td>
              </tr>
            );
          })}
            </tbody>
          </table>
          </div>
          <p className="text-[length:var(--fs-caption)] mb-2" role="status" data-testid="invest-item-footer">{footer.text}</p>
          {invTotals.manualExcludedNeedsConfirm > 0 && (
            <p className="text-[length:var(--fs-caption)] mb-2" role="status" data-testid="invest-excluded-note">확인 필요 {invTotals.manualExcludedNeedsConfirm}건은 합계에서 제외됨</p>
          )}
          {sanityTotalOversize(invTotals.grandKrwM) && !totalSanityDismissed && (
            <div className="flex items-center gap-1 mb-2" data-testid="invest-total-sanity">
              <span className="status-chip status-amber"><span aria-hidden="true">!</span> 금액이 매우 큽니다 — 단위를 확인하세요</span>
              {canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => setTotalSanityDismissed(true)}>닫기</button>}
            </div>
          )}
          {canAct && <button type="button" className="btn-ghost btn-sm mb-3" onClick={() => setBcLines((prev) => [...prev, { line: "", category: undefined, amount: 0, amountUnit: AMOUNT_UNIT_KRW_M, amountUnitConfirmed: true, period: undefined, currency: "KRW" }])}>＋ 항목 추가</button>}

          {/* ── 투자비 요약 (ADR-0174 slice 1) — read-only, decision support ── */}
          <div className="sizing-grade-card mb-3" data-testid="invest-summary">
            <h4 className="text-[length:var(--fs-caption)] mb-2">투자비 요약</h4>
            <div className="summary-cards mb-2">
              <div className="summary-card glass" data-testid="invest-summary-annual">
                <span className="summary-value mono-num">{summary.annualRecurringKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</span>
                <span className="text-label">연간(반복) 투자비 (백만원/년)</span>
              </div>
              <div className="summary-card glass" data-testid="invest-summary-lumpsum">
                <span className="summary-value mono-num">{summary.lumpsumKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</span>
                <span className="text-label">일시 투자비 (백만원)</span>
              </div>
              <div className="summary-card glass" data-testid="invest-summary-total">
                <span className="summary-value mono-num">{summary.totalKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</span>
                <span className="text-label">총 투자비 (검토 기간 {summary.horizon}년, 백만원)</span>
              </div>
            </div>
            <p className="text-[length:var(--fs-caption)] mb-1" data-testid="invest-summary-capex-subtotal">
              설비 투자 소계 (capex, 백만원): <span className="mono-num">{summary.capexSubtotalKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</span>
            </p>
            <div className="overflow-x-auto mb-2">
              <table className="sizing-table" data-testid="invest-summary-by-category">
                <thead>
                  <tr><th scope="col">분류</th><th scope="col">연간</th><th scope="col">일시</th><th scope="col">기간총액</th></tr>
                </thead>
                <tbody>
                  {summary.byCategory.map((r) => (
                    <tr key={r.category}>
                      <td>{CATEGORY_LABEL[r.category]}</td>
                      <td className="mono-num">{r.annualKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                      <td className="mono-num">{r.lumpsumKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                      <td className="mono-num">{r.totalKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>합계</td>
                    <td className="mono-num">{summary.annualRecurringKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                    <td className="mono-num">{summary.lumpsumKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                    <td className="mono-num">{summary.totalKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto mb-2">
              <table className="sizing-table" data-testid="invest-summary-schedule">
                <caption className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left">연도별 투자 계획 (백만원)</caption>
                <thead>
                  <tr>
                    <th scope="col">구분</th>
                    {summary.schedule.map((s) => <th scope="col" key={s.year}>Y{s.year}</th>)}
                    <th scope="col">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {(["labor", "opex", "capex"] as const).map((c) => (
                    <tr key={c}>
                      <td>{CATEGORY_LABEL[c]}</td>
                      {summary.schedule.map((s) => <td className="mono-num" key={s.year}>{s[c].toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>)}
                      <td className="mono-num">{summary.schedule.reduce((a, s) => a + s[c], 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>투자비 합계</td>
                    {summary.schedule.map((s) => <td className="mono-num" key={s.year}>{s.investmentTotal.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>)}
                    <td className="mono-num">{summary.totalKrwM.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                  </tr>
                  <tr>
                    <td>매출</td>
                    {summary.schedule.map((s) => <td className="mono-num" key={s.year}>{s.revenue.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>)}
                    <td className="mono-num">{summary.schedule.reduce((a, s) => a + s.revenue, 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                  </tr>
                  <tr>
                    <td>정부 R&D</td>
                    {summary.schedule.map((s) => <td className="mono-num" key={s.year}>{s.govRnd.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>)}
                    <td className="mono-num">{summary.schedule.reduce((a, s) => a + s.govRnd, 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">매출·정부 R&D 행은 투자비 제외 — 유입 참고용입니다.</p>
            <ul className="list-none p-0 m-0" data-testid="invest-summary-flags">
              {summary.excludedNonKrw > 0 && <li className="text-[length:var(--fs-caption)]">외화 항목 {summary.excludedNonKrw}건은 합계에서 제외 (환율 미반영)</li>}
              {summary.excludedNeedsConfirm > 0 && <li className="text-[length:var(--fs-caption)]">확인 필요 항목 {summary.excludedNeedsConfirm}건은 합계에서 제외</li>}
              {summary.endYearExceedsHorizon > 0 && <li className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))]">종료 연차가 검토 기간을 넘는 항목 {summary.endYearExceedsHorizon}건 — 검토 기간 안에서 집계됨</li>}
              {summary.capabilitySpendFromMilestone > 0 && <li className="text-[length:var(--fs-caption)]">판정 기간에서 산정한 집행 연차 {summary.capabilitySpendFromMilestone}건</li>}
            </ul>
          </div>
          {/* ── LLM 투자비 항목 추천 — ADR-0118: 제안은 LLM, 저장은 사람 ── */}
          <div className="sizing-grade-card mb-3">
            <h4 className="text-[length:var(--fs-caption)] mb-2">
              투자비 항목 추천 <span className="status-chip status-amber">제안 · AI</span>
            </h4>
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              진출전략·필요 역량 해소 방식을 근거로 검토할 만한 인건비/운영비/설비투자/수익 항목명을 제안합니다.
              금액은 제안하지 않습니다 — 항목을 추가한 뒤 금액은 사람이 입력합니다 (경계 #2).
            </p>
            {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
            {canAct && !reco && !recoLoading && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => void generateReco()}>▶ 항목 추천 생성</button>
            )}
            {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">진출전략·S3 해소 방식을 근거로 항목을 제안하는 중...</p>}
            {reco && (
              <>
                <p className="mb-1 text-[length:var(--fs-caption)]">
                  <span className={`status-chip mr-1 ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                    {reco.source === "llm" ? `LLM 제안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                  </span>
                </p>
                {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
                {reco.recommendation.investment_items ? (
                  <ul className="sizing-note-list mb-2">
                    {reco.recommendation.investment_items.map((item, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 mb-1">
                        <span>
                          <span className="font-semibold">{item.line}</span>
                          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> ({CATEGORY_LABEL[item.category]}) — {item.note}</span>
                        </span>
                        {canAct && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => addRecoItem(item)}>추가</button>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">제안된 항목이 없습니다.</p>
                )}
                {reco.recommendation.cautions.length > 0 && (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-2">{reco.recommendation.cautions.join(" / ")}</p>
                )}
                {canAct && <button type="button" className="btn-ghost btn-sm" disabled={recoLoading} onClick={() => void generateReco()}>{recoLoading ? "재생성 중..." : "재생성"}</button>}
              </>
            )}
          </div>

          <input aria-label="평가 근거" placeholder="평가 근거 (S1 시장분석·S3 적합성 판단 인용, 선택)" value={rationale} onChange={(e) => setRationale(e.target.value)} className="sizing-new-input mb-3" style={{ width: "100%" }} />

          {canAct && <button type="submit" className="btn-ghost" disabled={busy || hasYearErrors} title={hasYearErrors ? "연차 입력을 확인하세요" : undefined}>저장</button>}
          </fieldset>
        </form>
      </section>

      <GateDecisionPanel opportunityId={selected.opportunity.id} gates={["pre_fs"]} />
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        ↓ 위 예비타당성 검토 게이트가 <b>진행</b>으로 기록되어야 아래 프로젝트 추진이 가능합니다 — 승인 기록은 판단, 추진은 그 판단을 전제로 한 장부상 전환입니다.
      </p>
      <PromotionPanel
        opportunityId={selected.opportunity.id}
        heading={`${selected.opportunity.name} — 프로젝트로 추진 (예비타당성 검토 승인 이후, S5 → S8)`}
      />
    </>
  );
}
