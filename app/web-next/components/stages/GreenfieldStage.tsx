"use client";

// S5 자체 진출 본문 — ADR-0120 Wave 2 Phase A 추출(/greenfield 페이지와
// /deals/[id]/s5 탭이 동일 컴포넌트를 소비한다). StageFrame·main 셸·기회 선택
// 칩은 호출자가 제공한다(공통 규칙 #6): 이 컴포넌트는 opportunityId 하나에 고정된
// 작업 화면만 렌더링한다.
//
// Greenfield는 Target Company가 없음 — "우리 스스로 진입 가능한가, 무엇을
// 구축해야 하는가"를 평가한다: 진출전략(Build/Partner/Hire/Invest 결정) →
// 필요 역량 확인 → 투자비 검토 요건 (greenfield-capability-assessment 절차, B-7).
// ADR-0136: 필요 역량 정의·보유 판정은 S3 역량 갭 레지스터(opportunity.
//   capability_gap_json)가 유일한 출처다. S5는 그 레지스터를 읽기 전용으로
//   보여주고 보유 수준·해소 방식·비고만 확장 편집한다.
import { useCallback, useEffect, useState } from "react";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { SectionToolbar } from "../layout.tsx";
import { GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { PromotionPanel } from "../PromotionPanel.tsx";
import { PrimaryAction } from "../ui.tsx";
import {
  HELD_STATUS_CHIP, HELD_STATUS_LABEL, RESOLUTION_LABEL,
  type CapabilityGapRow, type GapResolution,
} from "../../lib/capability-gap.ts";

interface BcLine {
  line: string; category: "labor" | "opex" | "capex" | "revenue" | "gov_rnd"; amount: number; note?: string;
  period: "monthly" | "quarterly" | "yearly" | "lumpsum"; currency: "KRW" | "USD" | "EUR" | "JPY" | "CNY";
}
interface Assessment {
  id: string; entry_strategy: string | null; alternatives_considered: string | null;
  rationale: string | null; updated_at: string;
  business_case_lines: BcLine[] | null;
}
interface OppDetail { opportunity: { id: string; name: string; assessed_at?: string | null }; assessment: Assessment | null }
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

const RESOLUTIONS = Object.keys(RESOLUTION_LABEL) as GapResolution[];
// ADR-0137 — S8 business_case_line.category와 동일 어휘(승격 시 그대로 이관).
const CATEGORY_LABEL: Record<BcLine["category"], string> = { labor: "인건비", opex: "운영비", capex: "설비투자", revenue: "수익", gov_rnd: "정부 R&D" };
const PERIOD_LABEL: Record<BcLine["period"], string> = { monthly: "월", quarterly: "분기", yearly: "년", lumpsum: "일시불(총액)" };
const CURRENCY_LABEL: Record<BcLine["currency"], string> = { KRW: "원화", USD: "달러", EUR: "유로", JPY: "엔화", CNY: "위안" };

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
  const [bcLines, setBcLines] = useState<BcLine[]>([]);
  const [rationale, setRationale] = useState("");
  // ADR-0118 — S5 투자비 검토 요건 LLM 추천(제안). 저장은 사람의 행위다.
  const [reco, setReco] = useState<InvestmentReco | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  const loadDetail = useCallback((oppId: string) => {
    api.get<OppDetail>(`/api/greenfield/${encodeURIComponent(oppId)}`)
      .then((r) => {
        setSelected(r.data);
        setEntryStrategy(r.data.assessment?.entry_strategy ?? "");
        setAlternatives(r.data.assessment?.alternatives_considered ?? "");
        setBcLines(r.data.assessment?.business_case_lines ?? []);
        setRationale(r.data.assessment?.rationale ?? "");
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
    loadDetail(opportunityId);
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
  function addRecoItem(item: { line: string; category: "labor" | "opex" | "capex" | "revenue" | "gov_rnd"; note: string }) {
    setBcLines((prev) => [...prev, { line: item.line, category: item.category, amount: 0, note: item.note, period: "yearly", currency: "KRW" }]);
  }

  const setGapField = (i: number, patch: Partial<CapabilityGapRow>) =>
    setGapRows((prev) => prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const setBc = (i: number, patch: Partial<BcLine>) => setBcLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

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
        entry_strategy: entryStrategy || undefined,
        alternatives_considered: alternatives || undefined,
        business_case_lines: bcLines.filter((l) => l.line.trim()),
        rationale: rationale || undefined,
      });
      loadDetail(selected.opportunity.id);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
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
                {selected.opportunity.assessed_at ? "done" : "in_progress"} · {[entryStrategy !== "", gapRows.length > 0, bcLines.length > 0].filter(Boolean).length}/3 구성요소
              </span>
              {selected.opportunity.assessed_at && <span className="status-chip status-green">평가 기록 v1+</span>}
            </span>
          }
        />
        <PrimaryAction
          form="greenfield-eval-form"
          label="타당성 검토 실행"
          disabled={!canAct || busy || entryStrategy.trim() === ""}
          disabledReason={!canAct ? "평가 기록은 analyst 권한이 필요합니다." : busy ? "저장 중입니다." : "진출전략을 입력하면 실행할 수 있습니다."}
        />
        <form id="greenfield-eval-form" onSubmit={save} className="sizing-new-form">
          <fieldset disabled={!canAct} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {/* 1. 진출전략 */}
          <h3 className="text-[length:var(--fs-body)] mb-2">1️⃣ 진출전략 (Build / Partner / Hire / Invest 결정)</h3>
          <textarea
            aria-label="진출전략"
            value={entryStrategy}
            onChange={(e) => setEntryStrategy(e.target.value)}
            rows={3}
            placeholder="예: 코어 역량(제조)은 Build, 물류 운영은 Partner십(3PL), 부족 인력은 Hire — 역량 격차 해소 방식과 근거"
            className="sizing-new-input mb-2"
            style={{ width: "100%" }}
          />
          {/* 긴 대안 검토 텍스트를 위해 textarea — 단일행 input은 저장된 값이 클리핑됐다(2026-09-20 리뷰) */}
          <textarea aria-label="검토한 대안" placeholder="검토한 대안 (선택)" value={alternatives} onChange={(e) => setAlternatives(e.target.value)} rows={2} className="sizing-new-input mb-3" style={{ width: "100%" }} />

          {/* 2. 필요 역량 — S3 레지스터 읽기 전용 + S5 보유 수준·해소방식 편집 */}
          <h3 className="text-[length:var(--fs-body)] mb-2">2️⃣ 필요 역량 (S3) 확인</h3>
          {gapRows.length === 0 ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
              아직 S3에 필요 역량이 정의되지 않았습니다 — <a href={`/synergy?opportunity=${encodeURIComponent(selected.opportunity.id)}`} className="text-[color:var(--accent)] underline">시너지·전략적 적합성(S3)</a>에서 먼저 정의·판정하세요.
            </p>
          ) : (
            <>
              <table className="data-table mb-2" aria-label="필요 역량 확인">
                <caption className="sr-only">필요 역량 확인</caption>
                <thead>
                  <tr>
                    <th scope="col">필요 역량 (S3)</th>
                    <th scope="col">보유 판정 (S3)</th>
                    <th scope="col">보유 수준</th>
                    <th scope="col">해소 방식</th>
                    <th scope="col">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {gapRows.map((g, i) => (
                    <tr key={g.id}>
                      <td className="text-[length:var(--fs-caption)]">
                        <span className="font-semibold">{g.capability}</span>
                        {g.requiredNote && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{g.requiredNote}</span>}
                      </td>
                      <td>
                        <span className={`status-chip ${HELD_STATUS_CHIP[g.held.status]}`}>{HELD_STATUS_LABEL[g.held.status]}</span>
                        {g.held.holders.length > 0 && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{g.held.holders.join(", ")}</span>}
                      </td>
                      <td><input aria-label={`${g.capability} 보유 수준`} placeholder="보유 수준" value={g.currentLevel} onChange={(e) => setGapField(i, { currentLevel: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} /></td>
                      <td>
                        <select aria-label={`${g.capability} 해소 방식`} value={g.resolution ?? ""} onChange={(e) => setGapField(i, { resolution: (e.target.value || null) as GapResolution | null })} className="sizing-new-input sizing-new-input-sm">
                          <option value="">미정</option>
                          {RESOLUTIONS.map((r) => <option key={r} value={r}>{RESOLUTION_LABEL[r]}</option>)}
                        </select>
                      </td>
                      <td><input aria-label={`${g.capability} 비고`} placeholder="비고" value={g.note} onChange={(e) => setGapField(i, { note: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-2 mb-3">
                {canAct && (
                  <button type="button" className="btn-ghost btn-sm" disabled={savingGaps} onClick={() => void saveGaps()}>
                    {savingGaps ? "저장 중..." : "필요 역량 확인 저장"}
                  </button>
                )}
                {gapStored && <span className="status-chip status-green">S3 레지스터에 저장됨</span>}
              </div>
            </>
          )}

          {/* 3. 투자비 검토 요건 */}
          <h3 className="text-[length:var(--fs-body)] mb-2">3️⃣ 투자비 검토 요건 (S8 사업성 분석 입력)</h3>
          {bcLines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1 mb-1">
              <input aria-label="항목명" placeholder="항목명 (예: 설비 투자, 연매출)" value={l.line} onChange={(e) => setBc(i, { line: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
              <select aria-label="분류" value={l.category} onChange={(e) => setBc(i, { category: e.target.value as BcLine["category"] })} className="sizing-new-input sizing-new-input-sm">
                {(Object.keys(CATEGORY_LABEL) as BcLine["category"][]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              <input aria-label="금액 (억 단위, 아래 통화 기준)" type="number" placeholder="금액(억)" value={l.amount || ""} onChange={(e) => setBc(i, { amount: Number(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} />
              <select aria-label="기준 통화" value={l.currency} onChange={(e) => setBc(i, { currency: e.target.value as BcLine["currency"] })} className="sizing-new-input sizing-new-input-sm">
                {(Object.keys(CURRENCY_LABEL) as BcLine["currency"][]).map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
              </select>
              <select aria-label="금액 기준 (반복 주기 또는 일시불)" value={l.period} onChange={(e) => setBc(i, { period: e.target.value as BcLine["period"] })} className="sizing-new-input sizing-new-input-sm">
                {(Object.keys(PERIOD_LABEL) as BcLine["period"][]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
              </select>
              <input aria-label="비고" placeholder="비고" value={l.note ?? ""} onChange={(e) => setBc(i, { note: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 10rem" }} />
              {canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => setBcLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>}
            </div>
          ))}
          {canAct && <button type="button" className="btn-ghost btn-sm mb-3" onClick={() => setBcLines((prev) => [...prev, { line: "", category: "opex", amount: 0, period: "yearly", currency: "KRW" }])}>＋ 항목 추가</button>}

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

          {canAct && <button type="submit" className="btn-ghost" disabled={busy}>저장</button>}
          </fieldset>
        </form>
      </section>

      <GateDecisionPanel opportunityId={selected.opportunity.id} gates={["pre_fs"]} />
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        ↓ 위 Pre-FS 게이트가 <b>GO</b>로 기록되어야 아래 프로젝트 추진이 가능합니다 — 승인 기록은 판단, 추진은 그 판단을 전제로 한 장부상 전환입니다.
      </p>
      <PromotionPanel
        opportunityId={selected.opportunity.id}
        heading={`${selected.opportunity.name} — 프로젝트로 추진 (Pre-FS 승인 이후, S5 → S8)`}
      />
    </>
  );
}
