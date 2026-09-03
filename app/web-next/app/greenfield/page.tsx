"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";

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
        <strong>Greenfield 경로</strong> — 자체 역량으로 진입할 수 있는지 평가합니다.
        필요 역량 대비 보유 역량의 <strong>격차</strong>를 기록하고, 해소 방식을
        <strong> Build / Partner / Hire / Invest</strong> 중 결정한 뒤 진출전략과 Business Case 라인을 정리합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── Greenfield 기회 (칩) ── */}
      <section aria-label="그린필드 기회" className="market-section">
        <div className="section-toolbar"><span className="section-title"><h2>🌱 Greenfield로 결정된 기회</h2></span></div>
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

      {/* ── S5 평가 폼 ── */}
      {selected && (
        <section aria-label="역량 평가" className="market-section">
          <SectionToolbar
            title={`${selected.opportunity.name} — 역량 평가·진출전략`}
            icon="⚙️"
            summary={
              <span className="flex items-center gap-1">
                <span className="status-chip status-not-started" title="P4 실행형: 평가 구성요소 진행 — S10 설립실행과 동일 상태 어휘">
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
              <div key={i} className="flex flex-wrap items-center gap-1 mb-1">
                <input aria-label="역량명" placeholder="역량명 (예: 공장 자동화 SI)" value={g.capability} onChange={(e) => setGap(i, { capability: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                <input aria-label="필요 수준" placeholder="필요 수준" value={g.required_level} onChange={(e) => setGap(i, { required_level: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} />
                <input aria-label="보유 수준" placeholder="보유 수준" value={g.current_level} onChange={(e) => setGap(i, { current_level: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} />
                <input aria-label="격차" placeholder="격차" value={g.gap} onChange={(e) => setGap(i, { gap: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} />
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
                <input aria-label="라인명" placeholder="라인명 (예: 설비 투자, 연매출)" value={l.line} onChange={(e) => setBc(i, { line: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                <select aria-label="비용/수익" value={l.kind} onChange={(e) => setBc(i, { kind: e.target.value as "cost" | "revenue" })} className="sizing-new-input sizing-new-input-sm">
                  <option value="cost">비용</option>
                  <option value="revenue">수익</option>
                </select>
                <input aria-label="금액(억원)" type="number" placeholder="금액 (억원)" value={l.amount || ""} onChange={(e) => setBc(i, { amount: Number(e.target.value) })} className="sizing-new-input sizing-new-input-sm" style={{ width: "7rem" }} />
                <input aria-label="비고" placeholder="비고" value={l.note ?? ""} onChange={(e) => setBc(i, { note: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                <button type="button" className="btn-ghost btn-sm" onClick={() => setBcLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm mb-3" onClick={() => setBcLines((prev) => [...prev, { line: "", kind: "cost", amount: 0 }])}>＋ 라인 추가</button>

            <input aria-label="평가 근거" placeholder="평가 근거 (S1 시장분석·S3 적합성 판단 인용, 선택)" value={rationale} onChange={(e) => setRationale(e.target.value)} className="sizing-new-input mb-3" style={{ width: "100%" }} />

            <button type="submit" className="btn-ghost" disabled={busy}>평가 저장</button>
          </form>

          {/* 저장된 요약 */}
          {selected.assessment && selected.assessment.capability_gaps?.length ? (
            <div className="mt-4">
              <h3 className="text-[0.85rem] mb-2">📋 저장된 평가 요약</h3>
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
