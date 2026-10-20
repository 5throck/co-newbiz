"use client";

// S10 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/deal-structure 페이지와
// /deals/[id]/s10 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.
// 탭 상태는 독립 페이지에서 URL ?tab= 동기, embedded(deals 탭) 모드에서는 내부 상태로
// 유지한다 — router로 프로젝트 페이지를 건드리지 않는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { StageTabs } from "../StageTabs.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { PrimaryAction, useToast } from "../ui.tsx";
import { TabNav } from "../TabNav.tsx";
import { RECORD_KEY_LABEL, GF_FUNDING_SOURCE_PRESETS, GF_FUNDING_USE_PRESETS, GF_JV_STAKE_LABEL, GF_S10_STAGE_LABEL, GF_VEHICLE_LABEL } from "../../lib/labels.ts";
import { balanceView, buildHypothesisPayload, hypothesisFieldVisibility, type TrancheView } from "../../lib/greenfield-structure-view.ts";
import { CapexTrancheTable } from "./CapexTrancheTable.tsx";
import { useConfirm } from "../crud.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { EstablishmentModePanel } from "./EstablishmentModePanel.tsx";
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
const EVIDENCE_KIND_LABEL: Record<string, string> = { commitment_letter: "커밋먼트 레터", internal_approval: "내부 자금 승인", term_sheet: "텀시트", subsidy_grant: "보조금 교부", other: "기타" };
const AXIS_FIELDS = ["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const;
interface View {
  hypotheses: HypothesisRow[];
  financing: { entries: FinancingEntry[]; totals: { sources: number; uses: number; balanced: boolean }; certainty?: FinancingCertainty };
}

const VEHICLE_LABEL: Record<string, string> = {
  direct: "직접 투자(direct)",
  spc: "SPC/SPV(목적법인)",
  holdco: "홀딩스 경유(holdco)",
  internal_venture_spinoff: "내부 벤처 스핀오프",
  jv: "합작(JV)",
};
// Korean labels for the stored enum values (display only; the stored values are unchanged).
const STAKE_LABEL: Record<string, string> = { full: "전량 인수", majority: "과반 지분", minority: "소수 지분", joint_control: "공동 통제" };
const INSTRUMENT_LABEL: Record<string, string> = { primary: "신주 인수", secondary: "구주 매입", mixed: "신주·구주 혼합" };
const AXIS_LABEL: Record<string, string> = {
  tax_structure_note: "절세 구조",
  liability_isolation_note: "책임 격리",
  financing_leverage_note: "재무 레버리지",
  exit_structure_note: "엑싯 구조",
};

function fmt(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

export function DealStructureStage({ projectId, embedded }: { projectId: string; embedded?: boolean }) {
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
      .catch((e) => setError(e instanceof Error ? e.message : "투자구조 데이터를 불러오지 못했습니다."));
    // Track detection: greenfield_scope is null for brownfield / unrouted projects (brownfield view unchanged).
    api.get<{ greenfield_scope: unknown | null }>(`/api/projects/${encodeURIComponent(projectId)}/greenfield-scope`)
      .then((r) => {
        const gf = !!r.data.greenfield_scope;
        setIsGf(gf);
        if (gf) {
          api.get<{ tranches: TrancheView[] }>(`/api/projects/${encodeURIComponent(projectId)}/capex-tranches`)
            .then((t) => setTranches(t.data.tranches))
            .catch((e) => setError(e instanceof Error ? e.message : "설비투자 트랜치를 불러오지 못했습니다."));
        }
      })
      .catch(() => setIsGf(false));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  /** Records the drafted structure hypothesis (the form's own submit; the header primary opens and focuses the form). */
  function saveStructure() {
    if (!newHyp.rationale.trim()) { setError("근거(rationale)는 필수입니다."); return; }
    // 사업부 신설 형태 has no DB field: it is recorded as a labelled prefix in the free-text 책임 격리 note, and no 설립 법인 형태 is sent.
    const form = isBu ? { ...newHyp, vehicle: "", liability_isolation_note: withBusinessUnitForm(newHyp.liability_isolation_note, buForm) } : newHyp;
    void post(buildHypothesisPayload(isGf, form), "투자구조 가설을 기록했습니다.");
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
      setRecoError(err instanceof Error ? err.message : "추천 생성 실패");
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
      tax_structure_note: r.four_axis.tax_structure_note !== "검증 필요" ? r.four_axis.tax_structure_note : h.tax_structure_note,
      liability_isolation_note: r.four_axis.liability_isolation_note !== "검증 필요" ? r.four_axis.liability_isolation_note : h.liability_isolation_note,
      financing_leverage_note: r.four_axis.financing_leverage_note !== "검증 필요" ? r.four_axis.financing_leverage_note : h.financing_leverage_note,
      exit_structure_note: r.four_axis.exit_structure_note !== "검증 필요" ? r.four_axis.exit_structure_note : h.exit_structure_note,
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
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  function completeFourAxis(h: HypothesisRow) {
    const ref = (artifactRef[h.id] ?? "").trim();
    if (!ref) {
      setError(`4축 검토 완료에는 ${RECORD_KEY_LABEL.deal_structure_review} 아티팩트 참조가 필수입니다.`);
      return;
    }
    confirm("4축 검토 완료 처리", () => { void post({ action: "complete_four_axis", hypothesis_id: h.id, artifact_ref: ref }); },
      { body: "완료 처리는 감사 로그에 아티팩트 참조와 함께 기록되며 되돌릴 수 없습니다." });
  }

  function addEntry() {
    const amount = Number(newEntry.amount_krw_m);
    if (!newEntry.name.trim() || !Number.isFinite(amount) || amount < 0) {
      setError("항목명과 0 이상 금액(백만 KRW)이 필요합니다.");
      return;
    }
    if ((newEntry.evidence_kind === "") !== (newEntry.evidence_ref.trim() === "")) {
      setError("증빙 종류와 증빙 참조는 함께 기록합니다 — 종류만 또는 참조만으로는 증빙이 아닙니다.");
      return;
    }
    void post({ action: "add_financing_entry", kind: newEntry.kind, name: newEntry.name.trim(), amount_krw_m: amount, note: newEntry.note || null, evidence_kind: newEntry.evidence_kind || null, evidence_ref: newEntry.evidence_ref.trim() || null });
    setNewEntry({ kind: newEntry.kind, name: "", amount_krw_m: "", note: "", evidence_kind: "", evidence_ref: "" });
  }

  const vehicleLabels = isGf ? GF_VEHICLE_LABEL : VEHICLE_LABEL;
  const vis = hypothesisFieldVisibility(isGf, newHyp.vehicle);
  const axisLabel = (k: string) => (isGf && k === "tax_structure_note" ? "절세·지역 인센티브 (환수 조건 포함)" : AXIS_LABEL[k]);
  const totals = data?.financing.totals;
  const balance = isGf ? balanceView(totals) : null;
  const diff = totals ? Math.round((totals.sources - totals.uses) * 10) / 10 : 0;

  return (
<>
      <StageTabs projectId={projectId} />
      <ReviewBuckets entityType="project" entityId={projectId} artifacts={stageArtifactTabs("S10")} />
      <PrimaryAction
        label="투자구조 가설 기록"
        onClick={() => {
          setTab("hypotheses");
          setFormOpen(true);
          window.setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            formRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus({ preventScroll: true });
          }, 80);
        }}
        disabled={!canAct}
        disabledReason="투자구조 가설 기록은 analyst 권한이 필요합니다."
      />
      {/* INTERIM-WORDING: "투자 주체"/"설립 법인 형태" replace the transliterated "vehicle" term */}
      <StageFrame stageId="S10" heading={isGf ? `S10 ${GF_S10_STAGE_LABEL} — ${isBu ? "사업부 신설 형태" : "설립 법인 형태"}·4축 검토·자금조달·집행 단계` : "S10 투자구조 설계 — 투자 주체·4축 검토·자금조달"}>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          {isGf ? (isBu ? "사업부 신설 형태" : "설립 법인 형태(SPC 포함)") : "투자 주체(SPC 포함)"}와 절세 구조·책임 격리·재무 레버리지·엑싯 구조 4대 축을 검토하고,
          자금조달 sources &amp; uses를 균형시킵니다. 이 산출물이 S11 투자심의 자료의 입력입니다.
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

        {isGf && <EstablishmentModePanel projectId={projectId} canAct={canAct} onState={setModeState} />}

        <TabNav
          className="mb-3"
          label="S10 투자구조 설계 화면"
          active={tab}
          onSelect={setTab}
          tabs={[
            ...(canAct ? [{ key: "reco", label: "AI 추천" }] : []),
            { key: "hypotheses", label: "투자구조 가설", count: data?.hypotheses.length },
            { key: "financing", label: "자금조달 계획" },
            ...(isGf ? [{ key: "capex", label: "설비투자 집행 단계", count: tranches.length }] : []),
          ]}
        />

        {/* ── AI 추천 검토/안건구조 (결정 지원) — ADR-0118: 제안은 LLM, 가설 등록은 사람 ── */}
        {tab === "reco" && canAct && (
          <section className="market-section sizing-step mb-3" aria-label="AI 추천 검토/안건구조">
            <h3 className="sizing-step-title text-[0.9rem]">🤖 AI 추천 검토/안건구조 (제안)</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              원칙 (경계 #2): 가설 등록·4축 확정은 사람이 합니다 — S8 채택 BC·S9 발견사항·WACC·현재 상태에서 만든 제안입니다.
            </p>
            {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
            {!reco && !recoLoading && !recoError && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button type="button" className="btn-ghost" onClick={() => void generateReco()}>▶ AI 추천 생성</button>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{isGf ? "설립 법인 형태" : "투자 주체"}·지분·수단과 4축 노트·구조 근거 초안을 작성해 가설 등록을 돕습니다.</span>
              </div>
            )}
            {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">채택 BC·DD 발견사항·WACC를 근거로 초안을 작성하는 중...</p>}
            {reco && (
              <>
                <p className="mb-1 flex flex-wrap items-center gap-1">
                  <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                    {reco.source === "llm" ? `AI 추천${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                  </span>
                  {reco.recommendation.vehicle && <span className="status-chip status-amber">{vehicleLabels[reco.recommendation.vehicle] ?? reco.recommendation.vehicle}</span>}
                  {!isGf && reco.recommendation.stake_type && <span className="status-chip status-not-started">지분: {STAKE_LABEL[reco.recommendation.stake_type] ?? reco.recommendation.stake_type}</span>}
                  {!isGf && reco.recommendation.instrument_mix && <span className="status-chip status-not-started">지급 수단 구성: {INSTRUMENT_LABEL[reco.recommendation.instrument_mix] ?? reco.recommendation.instrument_mix}</span>}
                </p>
                {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{reco.note}</p>}
                {reco.recommendation.rationale_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">구조 근거 초안:</span> {reco.recommendation.rationale_draft}</p>}
                <table className="data-table mb-2" aria-label="4축 노트 초안">
                  <caption className="sr-only">4축 노트 초안</caption>
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
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">이 제안이 본 산출물: {reco.manifest.join(" · ")}</p>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => confirm("AI 추천을 가설 폼에 반영할까요?", applyReco, {
                    body: "'새 투자구조 가설 기록' 폼에 초안을 채웁니다 — 검토·수정 후 사람이 등록합니다.",
                    confirmLabel: "반영",
                  })}
                >
                  ▶ 가설 폼에 반영
                </button>
              </>
            )}
          </section>
        )}

        {tab === "hypotheses" && (
        <section className="market-section sizing-step mb-3" aria-label="투자구조 가설">
          <h3 className="sizing-step-title text-[0.9rem]">투자구조 가설 ({data?.hypotheses.length ?? 0}건)</h3>
          {(data?.hypotheses ?? []).map((h) => (
            <div key={h.id} className="sizing-grade-card mb-2">
              <div className="flex flex-wrap items-center gap-1 mb-1">
                {h.vehicle && <span className="status-chip status-amber">{vehicleLabels[h.vehicle] ?? h.vehicle}</span>}
                {h.asset_or_stock && <span className="status-chip status-not-started">{h.asset_or_stock === "asset" ? "자산 인수" : h.asset_or_stock === "stock" ? "주식 인수" : "혼합"}</span>}
                {h.stake_type && <span className="status-chip status-not-started">지분: {STAKE_LABEL[h.stake_type] ?? h.stake_type}</span>}
                {h.instrument_mix && <span className="status-chip status-not-started">지급 수단 구성: {INSTRUMENT_LABEL[h.instrument_mix] ?? h.instrument_mix}</span>}
                {h.four_axis_review_completed === 1
                  ? <span className="status-chip status-green" title={h.four_axis_artifact_ref ? `근거 아티팩트: ${h.four_axis_artifact_ref}` : undefined}>4축 검토 완료</span>
                  : <span className="status-chip status-red">4축 검토 미완료</span>}
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{h.hypothesized_at.slice(0, 10)} · {h.hypothesized_by}</span>
              </div>
              {h.four_axis_review_completed === 1 && h.four_axis_artifact_ref && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="four-axis-artifact">
                  검토 근거 아티팩트 <code className="dd-item-id">{h.four_axis_artifact_ref}</code>
                  {h.four_axis_reviewed_by && <> · 검토자 {h.four_axis_reviewed_by}{h.four_axis_reviewed_at ? ` · ${h.four_axis_reviewed_at.slice(0, 10)}` : ""}</>}
                </p>
              )}
              <table className="data-table" aria-label="4축 검토 노트">
                <caption className="sr-only">4대 축 검토 내용</caption>
                <tbody>
                  {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                    <tr key={k}>
                      <th scope="row" style={{ width: "8rem" }}>{axisLabel(k)}</th>
                      <td>{h[k] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">근거: {h.rationale}</p>
              {canAct && h.four_axis_review_completed !== 1 && (() => {
                const missingAxes = AXIS_FIELDS.filter((k) => !h[k]?.trim());
                return (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <input
                      className="sizing-new-input text-[length:var(--fs-caption)]"
                      style={{ minWidth: "18rem" }}
                      placeholder={`${RECORD_KEY_LABEL.deal_structure_review} 아티팩트 참조 (필수)`}
                      value={artifactRef[h.id] ?? ""}
                      onChange={(e) => setArtifactRef({ ...artifactRef, [h.id]: e.target.value })}
                      aria-label="아티팩트 참조"
                    />
                    <button type="button" className="btn-ghost btn-sm" disabled={busy || missingAxes.length > 0} onClick={() => completeFourAxis(h)}
                      title={missingAxes.length > 0 ? "네 축의 노트가 모두 기록되어야 완료할 수 있습니다" : undefined}>4축 검토 완료</button>
                    {missingAxes.length > 0 && (
                      <span className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" data-testid="four-axis-missing">
                        미작성 축: {missingAxes.map((k) => AXIS_LABEL[k]).join(" · ")} — 새 가설에 네 축을 모두 적어야 완료할 수 있습니다
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
          {data && data.hypotheses.length === 0 && (
            <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">등록된 가설이 없습니다 — 아래에서 새 가설을 기록하세요.</p>
          )}

          {canAct && (
            <details className="mt-2" ref={formRef} open={formOpen} onToggle={(e) => setFormOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">투자구조 가설 입력란 {formOpen ? "접기" : "펼치기"}</summary>
              <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
                {isBu ? (
                <label>사업부 신설 형태
                  <select className="sizing-new-input ml-1" value={buForm} onChange={(e) => setBuForm(e.target.value as BusinessUnitForm | "")}>
                    <option value="">—</option>
                    {BUSINESS_UNIT_FORMS.map((k) => <option key={k} value={k}>{BUSINESS_UNIT_FORM_LABEL[k]}</option>)}
                  </select>
                </label>
                ) : (
                <label>{isGf ? "설립 법인 형태" : "투자 주체"}
                  <select className="sizing-new-input ml-1" value={newHyp.vehicle} onChange={(e) => setNewHyp({ ...newHyp, vehicle: e.target.value })}>
                    <option value="">—</option>
                    {Object.entries(vehicleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                )}
                {vis.assetOrStock && (
                <label>자산/주식
                  <select className="sizing-new-input ml-1" value={newHyp.asset_or_stock} onChange={(e) => setNewHyp({ ...newHyp, asset_or_stock: e.target.value })}>
                    <option value="">—</option>
                    <option value="asset">자산 인수</option>
                    <option value="stock">주식 인수</option>
                    <option value="mixed">혼합</option>
                  </select>
                </label>
                )}
                {vis.stakeType && (
                <label>{isGf ? "합작 지분(우리 몫)" : "지분"}
                  <select className="sizing-new-input ml-1" value={newHyp.stake_type} onChange={(e) => setNewHyp({ ...newHyp, stake_type: e.target.value })}>
                    <option value="">—</option>
                    {Object.entries(isGf ? GF_JV_STAKE_LABEL : STAKE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                )}
                {vis.instrumentMix && (
                <label>지급 수단 구성
                  <select className="sizing-new-input ml-1" value={newHyp.instrument_mix} onChange={(e) => setNewHyp({ ...newHyp, instrument_mix: e.target.value })}>
                    <option value="">—</option>
                    {Object.entries(INSTRUMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                )}
              </div>
              {isBu && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                  사업부 신설 형태는 별도 항목으로 저장되지 않고, 아래 '책임 격리' 칸의 맨 앞에 '사업부 신설 형태: …'로 함께 기록됩니다. {BUSINESS_UNIT_NO_ISOLATION_NOTE}
                </p>
              )}
              {isGf && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                  설립 구조에서는 자산/주식 인수 형태와 지급 수단 구성을 쓰지 않습니다. 자금 조달 구성은 '자금조달 계획' 탭의 조달 항목으로, 집행 단계는 '설비투자 집행 단계' 탭으로 기록합니다.
                </p>
              )}
              <div className="grid grid-1 gap-1 mt-2 text-[length:var(--fs-caption)]">
                {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                  <label key={k}>{axisLabel(k)}
                    <input className="sizing-new-input w-full" value={newHyp[k]} onChange={(e) => setNewHyp({ ...newHyp, [k]: e.target.value })} />
                  </label>
                ))}
                <label>근거 (필수)
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
                  {busy ? "기록 중..." : "가설 기록"}
                </button>
                {!newHyp.rationale.trim() && <span id="hyp-reason" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">근거(필수)를 입력하면 기록할 수 있습니다.</span>}
              </div>
            </details>
          )}
        </section>
        )}

        {tab === "financing" && (
        <section className="market-section sizing-step" aria-label="자금조달 계획">
          <h3 className="sizing-step-title text-[0.9rem]">자금조달 계획 (자금 조달·사용)</h3>
          {totals && (
            <p className="text-[length:var(--fs-caption)] mb-1">
              조달 <span className="mono-num">{fmt(totals.sources)}</span> · 사용 <span className="mono-num">{fmt(totals.uses)}</span> · 차액{" "}
              <span className="mono-num">{fmt(diff)}</span> 백만 KRW{" "}
              {totals.balanced
                ? <span className="status-chip status-green">균형</span>
                : <span className="status-chip status-red">불균형 — S10 완료 요건 미충족</span>}
            </p>
          )}
          {balance && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{balance.balanced ? "✓" : "✕"} {balance.text}</p>}
          {data?.financing.certainty && data.financing.certainty.source_lines > 0 && (
            <p className="text-[length:var(--fs-caption)] mb-1" data-testid="financing-certainty">
              자금 확정성 증빙:{" "}
              {data.financing.certainty.all_sources_evidenced
                ? <span className="status-chip status-green">조달 {data.financing.certainty.source_lines}건 모두 증빙</span>
                : <span className="status-chip status-amber">증빙 없는 조달 {data.financing.certainty.unevidenced_lines}건 · {fmt(data.financing.certainty.unevidenced_amount_krw_m)} 백만 KRW</span>}
              <span className="text-[color:var(--muted-fg)] ml-1">— S10 완료 요건은 균형이며, 확정성은 투자심사 선결조건(step 4)으로 사실 확인됩니다.</span>
            </p>
          )}
          {isGf && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
              조달 항목에는 자기자본, 프로젝트 파이낸싱, 정부 자금·보조금을, 사용 항목에는 부지·설비 임차 대 자체 건설 선택을 기록하세요. 지역 인센티브를 받는 경우 환수 조건을 비고에 함께 적습니다.
            </p>
          )}
          <table className="data-table" aria-label="자금조달 항목">
            <caption className="sr-only">자금 조달·사용 항목</caption>
            <thead>
              <tr><th scope="col">구분</th><th scope="col">항목</th><th scope="col" className="mono-num">금액 (백만 KRW)</th><th scope="col">비고</th><th scope="col"></th></tr>
            </thead>
            <tbody>
              {(data?.financing.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{e.kind === "source" ? "조달" : "사용"}</td>
                  <td>{e.name}</td>
                  <td className="mono-num">{fmt(e.amount_krw_m)}</td>
                  <td>
                    {e.kind === "source" && (
                      e.evidence_kind && e.evidence_ref
                        ? <span className="status-chip status-green mr-1" title={e.evidence_ref}>{EVIDENCE_KIND_LABEL[e.evidence_kind] ?? e.evidence_kind}</span>
                        : <span className="status-chip status-amber mr-1" title="커밋먼트 레터·내부 승인 등 증빙 참조가 없습니다">증빙 없음</span>
                    )}
                    {e.note ?? (e.kind === "source" ? "" : "—")}
                  </td>
                  <td>
                    {canAct && (
                      <button type="button" className="btn-danger btn-sm" disabled={busy}
                        onClick={() => confirm("항목 삭제", () => { void post({ action: "remove_financing_entry", entry_id: e.id }); }, { body: "삭제는 감사 로그에 기록됩니다.", confirmLabel: "삭제" })}>
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.financing.entries.length ?? 0) === 0 && (
                <tr><td colSpan={5}>등록된 항목이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
          {canAct && (
            <div className="flex flex-wrap items-end gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>구분
                <select className="sizing-new-input ml-1" value={newEntry.kind} onChange={(e) => setNewEntry({ ...newEntry, kind: e.target.value as "source" | "use" })}>
                  <option value="source">조달</option>
                  <option value="use">사용</option>
                </select>
              </label>
              <label>항목명
                <input className="sizing-new-input ml-1" list={isGf ? "gf-entry-presets" : undefined} value={newEntry.name} onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })} />
              </label>
              <label>금액 (백만 KRW)
                <input className="sizing-new-input mono-num ml-1" style={{ width: "8rem" }} value={newEntry.amount_krw_m} onChange={(e) => setNewEntry({ ...newEntry, amount_krw_m: e.target.value })} />
              </label>
              <label>비고
                <input className="sizing-new-input ml-1" value={newEntry.note} onChange={(e) => setNewEntry({ ...newEntry, note: e.target.value })} />
              </label>
              {newEntry.kind === "source" && (
                <>
                  <label>증빙 종류
                    <select className="sizing-new-input ml-1" value={newEntry.evidence_kind} onChange={(e) => setNewEntry({ ...newEntry, evidence_kind: e.target.value })}>
                      <option value="">— 없음</option>
                      {Object.entries(EVIDENCE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label>증빙 참조
                    <input className="sizing-new-input ml-1" placeholder="커밋먼트 레터 2026-10-15 / 이사회 결의 #12" value={newEntry.evidence_ref} onChange={(e) => setNewEntry({ ...newEntry, evidence_ref: e.target.value })} />
                  </label>
                </>
              )}
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={addEntry}>추가</button>
              {isGf && (
                <datalist id="gf-entry-presets">
                  {(newEntry.kind === "source" ? GF_FUNDING_SOURCE_PRESETS : GF_FUNDING_USE_PRESETS).map((n) => <option key={n} value={n} />)}
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

