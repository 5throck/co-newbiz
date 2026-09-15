"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";
import { PromotionPanel } from "../../components/PromotionPanel.tsx";
import {
  HELD_STATUS_CHIP, HELD_STATUS_LABEL, RESOLUTION_LABEL,
  type CapabilityGapRow, type GapResolution,
} from "../../lib/capability-gap.ts";

// S5 자체 진출 (/greenfield) — flow.spec v2.0.0 그린필드 경로.
//   Greenfield는 Target Company가 없음 — "우리 스스로 진입 가능한가, 무엇을
//   구축해야 하는가"를 평가한다: 진출전략(Build/Partner/Hire/Invest 결정) →
//   필요 역량 확인 → 투자비 검토 요건 (greenfield-capability-assessment 절차, B-7).
// ADR-0136: 필요 역량 정의·보유 판정은 S3 역량 갭 레지스터(opportunity.
//   capability_gap_json)가 유일한 출처다. S5는 그 레지스터를 읽기 전용으로
//   보여주고 보유 수준·해소 방식·비고만 확장 편집한다.

interface OppRow {
  id: string; name: string; market_scope: string | null; synergy_score: number | null;
  sub_track: string | null; assessed_at: string | null;
}
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

export function GreenfieldView() {
  const searchParams = useSearchParams();
  const [opps, setOpps] = useState<OppRow[] | null>(null);
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

  const selectedId = searchParams.get("opportunity");

  const loadOpps = useCallback(() => {
    api.get<{ opportunities: OppRow[] }>("/api/greenfield").then((r) => setOpps(r.data.opportunities)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

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

  useEffect(() => { loadOpps(); }, [loadOpps]);
  useEffect(() => {
    if (!selectedId) { setSelected(null); setGapRows([]); return; }
    loadDetail(selectedId);
    loadGaps(selectedId);
  }, [selectedId, loadDetail, loadGaps]);

  const openOpportunity = useCallback((o: OppRow) => {
    window.history.replaceState(null, "", `/greenfield?opportunity=${encodeURIComponent(o.id)}`);
    loadDetail(o.id);
    loadGaps(o.id);
  }, [loadDetail, loadGaps]);

  // 기회 전환 시 추천 초기화
  useEffect(() => { setReco(null); setRecoError(null); }, [selectedId]);

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
      loadOpps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <StageFrame stageId="S5" track="greenfield">
        Greenfield 경로 — 자체 역량으로 진입할 수 있는지 평가합니다. 진출전략을
        Build / Partner / Hire / Invest 중 결정하고, 필요 역량(S3에서 이미 정의·판정된
        내용)을 확인한 뒤 투자비 검토 요건을 정리합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── Greenfield 기회 (칩) ── */}
      <section aria-label="그린필드 기회" className="market-section">
        <div className="section-toolbar"><span className="section-title"><h2>Greenfield로 결정된 기회</h2></span></div>
        {opps === null ? (
          <p>불러오는 중...</p>
        ) : opps.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            Greenfield로 결정된 기회가 없습니다 — <a href="/route-decision" className="text-[color:var(--accent)] underline">진출방식 결정(S4)</a>에서 트랙을 정하세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {opps.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={selected?.opportunity.id === o.id}
                className={`sizing-industry-chip ${selected?.opportunity.id === o.id ? "sizing-industry-chip-active" : ""}`}
                onClick={() => openOpportunity(o)}
              >
                <span className="font-semibold">{o.name}</span>
                <span className="sizing-chip-meta">{o.assessed_at ? "평가 완료" : "평가 전"}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
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
          <form onSubmit={save} className="sizing-new-form">
            {/* 1. 진출전략 */}
            <h3 className="text-[0.85rem] mb-2">1️⃣ 진출전략 (Build / Partner / Hire / Invest 결정)</h3>
            <textarea
              aria-label="진출전략"
              value={entryStrategy}
              onChange={(e) => setEntryStrategy(e.target.value)}
              rows={3}
              placeholder="예: 코어 역량(제조)은 Build, 물류 운영은 Partner십(3PL), 부족 인력은 Hire — 역량 격차 해소 방식과 근거"
              className="sizing-new-input mb-2"
              style={{ width: "100%" }}
            />
            <input aria-label="검토한 대안" placeholder="검토한 대안 (선택)" value={alternatives} onChange={(e) => setAlternatives(e.target.value)} className="sizing-new-input mb-3" style={{ width: "100%" }} />

            {/* 2. 필요 역량 — S3 레지스터 읽기 전용 + S5 보유 수준·해소방식 편집 */}
            <h3 className="text-[0.85rem] mb-2">2️⃣ 필요 역량 (S3) 확인</h3>
            {gapRows.length === 0 ? (
              <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-3">
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
                        <td className="text-[0.8rem]">
                          <span className="font-semibold">{g.capability}</span>
                          {g.requiredNote && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{g.requiredNote}</span>}
                        </td>
                        <td>
                          <span className={`status-chip ${HELD_STATUS_CHIP[g.held.status]}`}>{HELD_STATUS_LABEL[g.held.status]}</span>
                          {g.held.holders.length > 0 && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{g.held.holders.join(", ")}</span>}
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
                  <button type="button" className="btn-ghost btn-sm" disabled={savingGaps} onClick={() => void saveGaps()}>
                    {savingGaps ? "저장 중..." : "필요 역량 확인 저장"}
                  </button>
                  {gapStored && <span className="status-chip status-green">S3 레지스터에 저장됨</span>}
                </div>
              </>
            )}

            {/* 3. 투자비 검토 요건 */}
            <h3 className="text-[0.85rem] mb-2">3️⃣ 투자비 검토 요건 (S8 사업성 분석 입력)</h3>
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
                <button type="button" className="btn-ghost btn-sm" onClick={() => setBcLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm mb-3" onClick={() => setBcLines((prev) => [...prev, { line: "", category: "opex", amount: 0, period: "yearly", currency: "KRW" }])}>＋ 항목 추가</button>

            {/* ── LLM 투자비 항목 추천 — ADR-0118: 제안은 LLM, 저장은 사람 ── */}
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[0.8rem] mb-2">
                투자비 항목 추천 <span className="status-chip status-amber">제안 · LLM</span>
              </h4>
              <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
                진출전략·필요 역량 해소 방식을 근거로 검토할 만한 인건비/운영비/설비투자/수익 항목명을 제안합니다.
                금액은 제안하지 않습니다 — 항목을 추가한 뒤 금액은 사람이 입력합니다 (경계 #2).
              </p>
              {recoError && <p role="alert" className="text-[0.75rem] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
              {!reco && !recoLoading && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => void generateReco()}>▶ 항목 추천 생성</button>
              )}
              {recoLoading && <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-0">진출전략·S3 해소 방식을 근거로 항목을 제안하는 중...</p>}
              {reco && (
                <>
                  <p className="mb-1 text-[0.75rem]">
                    <span className={`status-chip mr-1 ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                      {reco.source === "llm" ? `LLM 제안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                    </span>
                  </p>
                  {reco.note && <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
                  {reco.recommendation.investment_items ? (
                    <ul className="sizing-note-list mb-2">
                      {reco.recommendation.investment_items.map((item, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 mb-1">
                          <span>
                            <span className="font-semibold">{item.line}</span>
                            <span className="text-[0.72rem] text-[color:var(--muted-fg)]"> ({CATEGORY_LABEL[item.category]}) — {item.note}</span>
                          </span>
                          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => addRecoItem(item)}>추가</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">제안된 항목이 없습니다.</p>
                  )}
                  {reco.recommendation.cautions.length > 0 && (
                    <p className="text-[0.72rem] text-[color:var(--amber-fg, var(--accent))] mb-2">{reco.recommendation.cautions.join(" / ")}</p>
                  )}
                  <button type="button" className="btn-ghost btn-sm" disabled={recoLoading} onClick={() => void generateReco()}>{recoLoading ? "재생성 중..." : "재생성"}</button>
                </>
              )}
            </div>

            <input aria-label="평가 근거" placeholder="평가 근거 (S1 시장분석·S3 적합성 판단 인용, 선택)" value={rationale} onChange={(e) => setRationale(e.target.value)} className="sizing-new-input mb-3" style={{ width: "100%" }} />

            <button type="submit" className="btn-primary" disabled={busy}>저장</button>
          </form>
        </section>
      )}
      {selected && <GateDecisionPanel opportunityId={selected.opportunity.id} gates={["pre_fs"]} />}
      {selected && (
        <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
          ↓ 위 Pre-FS 게이트가 <b>GO</b>로 기록되어야 아래 프로젝트 추진이 가능합니다 — 승인 기록은 판단, 추진은 그 판단을 전제로 한 장부상 전환입니다.
        </p>
      )}
      {selected && (
        <PromotionPanel
          opportunityId={selected.opportunity.id}
          heading={`${selected.opportunity.name} — 프로젝트로 추진 (Pre-FS 승인 이후, S5 → S8)`}
        />
      )}
    </main>
  );
}

export default function GreenfieldPage() {
  return (
    <Suspense fallback={null}>
      <GreenfieldView />
    </Suspense>
  );
}
