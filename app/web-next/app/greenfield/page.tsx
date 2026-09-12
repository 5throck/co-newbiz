"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";
import { PromotionPanel } from "../../components/PromotionPanel.tsx";
import { useConfirm } from "../../components/crud.tsx";

// S5 역량 평가·진출전략 (/greenfield) — flow.spec v2.0.0 그린필드 경로.
//   Greenfield는 Target Company가 없음 — "우리 스스로 진입 가능한가, 무엇을
//   구축해야 하는가"를 평가한다: 역량 격차 → Build/Partner/Hire/Invest 결정 →
//   진출전략 → Business Case 라인 (greenfield-capability-assessment 절차, B-7).
// S1 시장분석 패턴: 기회 칩 → 평가 폼 + 결과 요약.

interface OppRow {
  id: string; name: string; market_scope: string | null; synergy_score: number | null;
  sub_track: string | null; assessed_at: string | null;
}
interface GapRow { capability: string; required_level: string; current_level: string; gap: string; resolution: string; note?: string }
interface BcLine { line: string; kind: "cost" | "revenue"; amount: number; note?: string }
interface Assessment {
  id: string; entry_strategy: string | null; alternatives_considered: string | null;
  rationale: string | null; updated_at: string;
  capability_gaps: GapRow[] | null; business_case_lines: BcLine[] | null;
}
interface OppDetail { opportunity: { id: string; name: string; assessed_at?: string | null }; assessment: Assessment | null }

const RESOLUTIONS = ["build", "partner", "hire", "invest"] as const;

export function GreenfieldView() {
  const searchParams = useSearchParams();
  const [opps, setOpps] = useState<OppRow[] | null>(null);
  const [selected, setSelected] = useState<OppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [entryStrategy, setEntryStrategy] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [bcLines, setBcLines] = useState<BcLine[]>([]);
  const [rationale, setRationale] = useState("");
  // ADR-0118 — S5 역량·전략 LLM 추천(제안). 저장은 사람의 행위다.
  interface GreenfieldReco {
    source: "llm" | "synthesis";
    provider: string | null;
    note: string | null;
    manifest: string[];
    recommendation: {
      capability_rows: Array<{ capability: string; required_level: string; current_level: string; gap: string; resolution: string; note: string }> | null;
      strategy_draft: string;
      alternatives_draft: string | null;
      rationale_draft: string;
      key_evidence: string[];
      cautions: string[];
    };
  }
  const [reco, setReco] = useState<GreenfieldReco | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const selectedId = searchParams.get("opportunity");

  const loadOpps = useCallback(() => {
    api.get<{ opportunities: OppRow[] }>("/api/greenfield").then((r) => setOpps(r.data.opportunities)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loadDetail = useCallback((oppId: string) => {
    api.get<OppDetail>(`/api/greenfield/${encodeURIComponent(oppId)}`)
      .then((r) => {
        setSelected(r.data);
        setGaps(r.data.assessment?.capability_gaps ?? []);
        setEntryStrategy(r.data.assessment?.entry_strategy ?? "");
        setAlternatives(r.data.assessment?.alternatives_considered ?? "");
        setBcLines(r.data.assessment?.business_case_lines ?? []);
        setRationale(r.data.assessment?.rationale ?? "");
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "평가 불러오기 실패"));
  }, []);

  useEffect(() => { loadOpps(); }, [loadOpps]);
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const openOpportunity = useCallback((o: OppRow) => {
    window.history.replaceState(null, "", `/greenfield?opportunity=${encodeURIComponent(o.id)}`);
    loadDetail(o.id);
  }, [loadDetail]);

  // 기회 전환 시 추천 초기화
  useEffect(() => { setReco(null); setRecoError(null); }, [selectedId]);

  const generateReco = useCallback(async () => {
    if (!selected || recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<GreenfieldReco>(`/api/greenfield/${encodeURIComponent(selected.opportunity.id)}/recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : "추천 생성 실패");
    } finally {
      setRecoLoading(false);
    }
  }, [selected, recoLoading]);

  function applyReco() {
    if (!reco) return;
    const r = reco.recommendation;
    if (r.capability_rows) {
      setGaps(r.capability_rows.map((row) => ({ capability: row.capability, required_level: row.required_level, current_level: row.current_level, gap: row.gap, resolution: row.resolution, note: row.note })));
    }
    if (r.strategy_draft) setEntryStrategy(r.strategy_draft);
    if (r.alternatives_draft) setAlternatives(r.alternatives_draft);
    if (r.rationale_draft) setRationale(r.rationale_draft);
  }

  const setGap = (i: number, patch: Partial<GapRow>) => setGaps((prev) => prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const setBc = (i: number, patch: Partial<BcLine>) => setBcLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/greenfield/${selected.opportunity.id}`, {
        capability_gaps: gaps.filter((g) => g.capability.trim()),
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
        Greenfield 경로 — 자체 역량으로 진입할 수 있는지 평가합니다.
        필요 역량 대비 보유 역량의 격차를 기록하고, 해소 방식을
         Build / Partner / Hire / Invest 중 결정한 뒤 진출전략과 Business Case 라인을 정리합니다.
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

      {/* ── LLM 역량·전략 추천 (결정 지원) — ADR-0118: 제안은 LLM, 저장은 사람 ── */}
      {selected && (
        <section aria-label="LLM 역량·전략 추천" className="market-section">
          <SectionToolbar
            title={`${selected.opportunity.name} — LLM 역량·전략 추천`}
            icon=""
            actions={
              reco ? (
                <button type="button" className="btn-ghost btn-sm" disabled={recoLoading} onClick={() => void generateReco()}>재생성</button>
              ) : undefined
            }
          />
          <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
            원칙 (경계 #2): 저장·확정은 사람이 합니다 — <b>제안</b>이며, 폼에 반영한 뒤 자유롭게 수정할 수 있습니다.
          </p>
          {recoError && <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
          {!reco && !recoLoading && !recoError && (
            <div className="flex flex-wrap items-center gap-2 mb-0">
              <button type="button" className="btn-ghost" onClick={() => void generateReco()}>▶ LLM 추천 생성</button>
              <span className="text-[0.75rem] text-[color:var(--muted-fg)]">역량 격차 행(Build/Partner/Hire/Invest 포함)과 진출전략·평가 근거 초안을 작성해 폼 채움을 돕습니다.</span>
            </div>
          )}
          {recoLoading && <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">S4 결정·S1 시장 정의·S3 필요 역량을 근거로 초안을 작성하는 중...</p>}
          {reco && (
            <>
              <p className="mb-2 flex flex-wrap items-center gap-1">
                <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {reco.source === "llm" ? `LLM 제안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                </span>
                {reco.recommendation.capability_rows && <span className="status-chip status-not-started">격차 행 제안 {reco.recommendation.capability_rows.length}건</span>}
              </p>
              {reco.note && <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
              {reco.recommendation.capability_rows ? (
                <table className="data-table mb-3" aria-label="역량 격차 초안">
                  <caption className="sr-only">역량 격차 초안</caption>
                  <thead><tr><th scope="col">역량</th><th scope="col">필요</th><th scope="col">보유</th><th scope="col">격차</th><th scope="col">해소</th><th scope="col">근거(제안)</th></tr></thead>
                  <tbody>
                    {reco.recommendation.capability_rows.map((row, i) => (
                      <tr key={i}>
                        <td className="font-semibold text-[0.8rem]">{row.capability}</td>
                        <td className="text-[0.8rem]">{row.required_level}</td>
                        <td className="text-[0.8rem]">{row.current_level}</td>
                        <td className="text-[0.8rem]">{row.gap}</td>
                        <td><span className="status-chip status-in-progress">{row.resolution.toUpperCase()}</span></td>
                        <td className="text-[0.75rem]">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-3">격차 행 초안 없음 — 직접 작성하세요.</p>
              )}
              {reco.recommendation.strategy_draft && <p className="text-[0.8rem] mb-2"><span className="font-semibold">진출전략 초안:</span> {reco.recommendation.strategy_draft}</p>}
              {reco.recommendation.alternatives_draft && <p className="text-[0.8rem] mb-2"><span className="font-semibold">대안 초안:</span> {reco.recommendation.alternatives_draft}</p>}
              {reco.recommendation.rationale_draft && <p className="text-[0.8rem] mb-2"><span className="font-semibold">평가 근거 초안:</span> {reco.recommendation.rationale_draft}</p>}
              {reco.recommendation.cautions.length > 0 && (
                <p className="text-[0.72rem] text-[color:var(--amber-fg, var(--accent))] mb-2">{reco.recommendation.cautions.join(" / ")}</p>
              )}
              <p className="text-[0.7rem] text-[color:var(--muted-fg)] mb-2">이 제안이 본 산출물: {reco.manifest.join(" · ")}</p>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => confirm("LLM 추천을 평가 폼에 반영할까요?", applyReco, {
                  body: "현재 입력한 격차 행·진출전략·근거를 초안으로 덮어씁니다 — 반영 후에도 수정 가능하며, 저장은 사람이 합니다.",
                  confirmLabel: "반영",
                })}
              >
                ▶ 평가 폼에 반영
              </button>
            </>
          )}
        </section>
      )}

      {/* ── S5 평가 폼 ── */}
      {selected && (
        <section aria-label="역량 평가" className="market-section">
          <SectionToolbar
            title={`${selected.opportunity.name} — 역량 평가·진출전략`}
            icon=""
            summary={
              <span className="flex items-center gap-1">
                <span className="status-chip status-not-started" title="P4 실행형: 평가 구성요소 진행 — S11 설립실행과 동일 상태 어휘">
                  {selected.opportunity.assessed_at ? "done" : "in_progress"} · {[gaps.length > 0, entryStrategy !== "", bcLines.length > 0].filter(Boolean).length}/3 구성요소
                </span>
                {selected.opportunity.assessed_at && <span className="status-chip status-green">평가 기록 v1+</span>}
              </span>
            }
          />
          <form onSubmit={save} className="sizing-new-form">
            {/* 1. 역량 격차 */}
            <h3 className="text-[0.85rem] mb-2">1️⃣ 역량 격차 평가 (필요 역량 vs 보유 역량)</h3>
            {gaps.map((g, i) => (
              // flex-basis + grow — 값 길이가 제각각인 자유 텍스트라 고정 폭으로 두면
              // 입력 내용이 잘린다. 행 남은 폭을 균등히 나눠 쓰고, 부족하면 wrap한다.
              <div key={i} className="flex flex-wrap items-center gap-1 mb-1">
                <input aria-label="역량명" placeholder="역량명 (예: 공장 자동화 SI)" value={g.capability} onChange={(e) => setGap(i, { capability: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 14rem" }} />
                <input aria-label="필요 수준" placeholder="필요 수준" value={g.required_level} onChange={(e) => setGap(i, { required_level: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 9rem" }} />
                <input aria-label="보유 수준" placeholder="보유 수준" value={g.current_level} onChange={(e) => setGap(i, { current_level: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 9rem" }} />
                <input aria-label="격차" placeholder="격차" value={g.gap} onChange={(e) => setGap(i, { gap: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 9rem" }} />
                <select aria-label="해소 방식" value={g.resolution} onChange={(e) => setGap(i, { resolution: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                  {RESOLUTIONS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                </select>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setGaps((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm mb-3" onClick={() => setGaps((prev) => [...prev, { capability: "", required_level: "", current_level: "", gap: "", resolution: "build" }])}>＋ 역량 추가</button>

            {/* 2. 진출전략 */}
            <h3 className="text-[0.85rem] mb-2">2️⃣ 진출전략 (Build / Partner / Hire / Invest 결정)</h3>
            <textarea
              aria-label="진출전략"
              value={entryStrategy}
              onChange={(e) => setEntryStrategy(e.target.value)}
              rows={3}
              placeholder="예: 코어 역량(제조)은 Build, 물류 운영은 Partner(3PL), 부족 인력은 Hire — 역량 격차 해소 방식과 근거"
              className="sizing-new-input mb-2"
              style={{ width: "100%" }}
            />
            <input aria-label="검토한 대안" placeholder="검토한 대안 (선택)" value={alternatives} onChange={(e) => setAlternatives(e.target.value)} className="sizing-new-input mb-2" style={{ width: "100%" }} />

            {/* 3. Business Case 라인 */}
            <h3 className="text-[0.85rem] mb-2">3️⃣ Business Case 라인 (S8 사업성 분석 입력)</h3>
            {bcLines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1 mb-1">
                <input aria-label="라인명" placeholder="라인명 (예: 설비 투자, 연매출)" value={l.line} onChange={(e) => setBc(i, { line: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
                <select aria-label="비용/수익" value={l.kind} onChange={(e) => setBc(i, { kind: e.target.value as "cost" | "revenue" })} className="sizing-new-input sizing-new-input-sm">
                  <option value="cost">비용</option>
                  <option value="revenue">수익</option>
                </select>
                <input aria-label="금액(억원)" type="number" placeholder="금액 (억원)" value={l.amount || ""} onChange={(e) => setBc(i, { amount: Number(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "7rem" }} />
                <input aria-label="비고" placeholder="비고" value={l.note ?? ""} onChange={(e) => setBc(i, { note: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
                <button type="button" className="btn-ghost btn-sm" onClick={() => setBcLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm mb-3" onClick={() => setBcLines((prev) => [...prev, { line: "", kind: "cost", amount: 0 }])}>＋ 라인 추가</button>

            <input aria-label="평가 근거" placeholder="평가 근거 (S1 시장분석·S3 적합성 판단 인용, 선택)" value={rationale} onChange={(e) => setRationale(e.target.value)} className="sizing-new-input mb-3" style={{ width: "100%" }} />

            <button type="submit" className="btn-primary" disabled={busy}>평가 저장</button>
          </form>

          {/* 저장된 요약 */}
          {selected.assessment && selected.assessment.capability_gaps?.length ? (
            <div className="mt-4">
              <h3 className="text-[0.85rem] mb-2">저장된 평가 요약</h3>
              <table className="data-table" aria-label="역량 격차 요약">
                <caption className="sr-only">역량 격차 요약</caption>
                <thead><tr><th scope="col">역량</th><th scope="col">필요</th><th scope="col">보유</th><th scope="col">격차</th><th scope="col">해소 방식</th></tr></thead>
                <tbody>
                  {selected.assessment.capability_gaps.map((g, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{g.capability}</td>
                      <td>{g.required_level}</td><td>{g.current_level}</td><td>{g.gap}</td>
                      <td><span className="status-chip status-in-progress">{g.resolution.toUpperCase()}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selected.assessment.entry_strategy && (
                <p className="mt-2 mb-0 text-[0.82rem]"><strong>진출전략:</strong> {selected.assessment.entry_strategy}</p>
              )}
            </div>
          ) : null}
        </section>
      )}
      {selected && <GateDecisionPanel opportunityId={selected.opportunity.id} gates={["pre_fs"]} />}
      {selected && (
        <PromotionPanel
          opportunityId={selected.opportunity.id}
          heading={`${selected.opportunity.name} — 프로젝트로 승격 (S5 → S8)`}
        />
      )}
      {confirmDialog}
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
