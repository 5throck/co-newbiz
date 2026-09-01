"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";

// S4 진출방식 결정 (/route-decision) — selected 기회에 Greenfield/Brownfield 트랙과
// 라우트 유형을 기록하는 분기점 (flow.spec v2.0.0).
// Greenfield → S5 역량 평가·진출전략 / Brownfield → S6 대상 후보 발굴 → S7 대상 스크리닝.
// S1 시장분석 패턴: 기회 목록 → 선택 시 결정 폼 + 결정 이력.

interface OpportunityRow {
  id: string; name: string; market_scope: string | null; value_chain_node: string | null;
  attractiveness_score: number | null; synergy_score: number | null;
  fit_verdict: "Go" | "Hold" | "Kill" | null;
  status: "identified" | "assessed" | "selected" | "dropped";
}
interface RouteDecision {
  id: string; track: "greenfield" | "brownfield"; sub_track: string | null;
  rationale: string; alternatives_considered: string | null; decided_by: string; decided_at: string;
}

const GF_SUB: Record<string, string> = {
  existing_business_rbd: "기존 사업 R&BD 확장",
  intra_venture: "사내벤처(CVC)",
};
const BF_SUB: Record<string, string> = {
  m_and_a: "M&A",
  jv: "JV(합작)",
  strategic_investment: "전략적 투자",
  minority_investment: "소수지분 투자",
  partnership: "파트너십",
  rbd: "R&BD(공동연구)",
  corporate_venture: "사내벤처(CVC)",
};

export function RouteDecisionView() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [selected, setSelected] = useState<OpportunityRow | null>(null);
  const [decisions, setDecisions] = useState<RouteDecision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<"greenfield" | "brownfield">("greenfield");
  const [subTrack, setSubTrack] = useState("");
  const [rationale, setRationale] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedId = searchParams.get("opportunity");

  const loadRows = useCallback(() => {
    api.get<OpportunityRow[]>("/api/opportunities").then((r) => {
      setRows(r.data.filter((o) => o.status === "selected"));
    }).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loadDecisions = useCallback((id: string) => {
    api.get<{ decisions: RouteDecision[] }>(`/api/opportunities/${encodeURIComponent(id)}/route-decision`)
      .then((r) => setDecisions(r.data.decisions))
      .catch((e) => setError(e instanceof Error ? e.message : "결정 이력 불러오기 실패"));
  }, []);

  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    if (!selectedId || rows === null) return;
    const found = rows.find((o) => o.id === selectedId) ?? null;
    setSelected(found);
    if (found) loadDecisions(found.id);
  }, [selectedId, rows, loadDecisions]);

  const openOpportunity = useCallback((o: OpportunityRow) => {
    window.history.replaceState(null, "", `/route-decision?opportunity=${encodeURIComponent(o.id)}`);
    setSelected(o);
    loadDecisions(o.id);
  }, [loadDecisions]);

  async function saveDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || saving) return;
    setSaving(true); setError(null);
    try {
      await api.post(`/api/opportunities/${selected.id}/route-decision`, {
        track,
        sub_track: subTrack || undefined,
        rationale,
        alternatives_considered: alternatives || undefined,
      });
      setRationale(""); setAlternatives("");
      loadDecisions(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "결정 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const subs = track === "greenfield" ? GF_SUB : BF_SUB;

  return (
    <main>
      <h1>진출방식 결정</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        프로세스 스테이지 S4 — 선별된 기회의 진출방식을 결정하는 <strong>분기점</strong>입니다.
        Greenfield(자체 역량 진출)는 S5 역량 평가로, Brownfield(기존 기업·자산 결합)는
        S6 대상 후보 발굴로 진행됩니다. Brownfield ≠ M&A — 라우트 유형을 함께 선택합니다.
      </p>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 선별된 기회 (칩) ── */}
      <section aria-label="선별된 기회" className="market-section">
        <h2 className="text-[0.92rem] mb-2">🎯 선별된 기회</h2>
        {rows === null ? (
          <p>불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">선별(selected)된 기회가 없습니다 — 기회 발굴(S2)에서 시너지·적합성 평가(S3)를 거쳐 선별된 기회가 여기 표시됩니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {rows.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={selected?.id === o.id}
                className={`sizing-industry-chip ${selected?.id === o.id ? "sizing-industry-chip-active" : ""}`}
                onClick={() => openOpportunity(o)}
              >
                <span className="font-semibold">{o.name}</span>
                <span className="sizing-chip-meta">매력도 {o.attractiveness_score ?? "—"} · 시너지 {o.synergy_score ?? "—"}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── 결정 폼 + 이력 ── */}
      {selected && (
        <section aria-label="진출방식 결정" className="market-section">
          <h2 className="text-[0.92rem] mb-2">⚖️ {selected.name} — 진출방식 결정</h2>
          <form onSubmit={saveDecision} className="sizing-new-form mb-4">
            <div className="flex flex-wrap items-end gap-3 mb-2">
              <label className="text-[0.78rem]">
                <span className="block mb-1">트랙 *</span>
                <select value={track} onChange={(e) => { setTrack(e.target.value as "greenfield" | "brownfield"); setSubTrack(""); }} className="sizing-new-input">
                  <option value="greenfield">Greenfield — 자체 역량으로 진출</option>
                  <option value="brownfield">Brownfield — 기존 기업·자산과 결합</option>
                </select>
              </label>
              {track === "brownfield" && (
                <label className="text-[0.78rem]">
                  <span className="block mb-1">라우트 유형 * (Brownfield)</span>
                  <select value={subTrack} onChange={(e) => setSubTrack(e.target.value)} className="sizing-new-input">
                    <option value="">선택...</option>
                    {Object.entries(BF_SUB).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
              {track === "greenfield" && (
                <label className="text-[0.78rem]">
                  <span className="block mb-1">하위 트랙 (선택)</span>
                  <select value={subTrack} onChange={(e) => setSubTrack(e.target.value)} className="sizing-new-input">
                    <option value="">선택...</option>
                    {Object.entries(GF_SUB).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="text-[0.78rem] block mb-2">
              <span className="block mb-1">결정 근거 * (S1 시장분석·S3 적합성 판단을 인용)</span>
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} required className="sizing-new-input" style={{ width: "100%" }} placeholder="예: S3 적합성 평가 Go(시너지 72) — 자사 역량 보유, 시장 성장 지속..." />
            </label>
            <label className="text-[0.78rem] block mb-3">
              <span className="block mb-1">검토한 대안 (선택)</span>
              <textarea value={alternatives} onChange={(e) => setAlternatives(e.target.value)} rows={2} className="sizing-new-input" style={{ width: "100%" }} placeholder="고려했지만 선택하지 않은 트랙·라우트와 사유" />
            </label>
            <button type="submit" className="btn-ghost text-[0.85rem]" disabled={saving || !rationale.trim() || (track === "brownfield" && !subTrack)}>
              {saving ? "저장 중..." : "결정 저장"}
            </button>
          </form>

          {decisions.length > 0 && (
            <div>
              <h3 className="text-[0.88rem] mb-2">결정 이력 (최신순)</h3>
              <table className="data-table" aria-label="진출방식 결정 이력">
                <caption className="sr-only">진출방식 결정 이력</caption>
                <thead>
                  <tr><th scope="col">트랙</th><th scope="col">라우트</th><th scope="col">근거</th><th scope="col">대안</th><th scope="col">결정자/일시</th></tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className={`status-chip ${d.track === "brownfield" ? "status-amber" : "status-green"}`}>
                          {d.track === "brownfield" ? "Brownfield" : "Greenfield"}
                        </span>
                      </td>
                      <td className="text-[0.8rem]">{d.sub_track ? (d.track === "brownfield" ? BF_SUB[d.sub_track] ?? d.sub_track : GF_SUB[d.sub_track] ?? d.sub_track) : "—"}</td>
                      <td className="text-[0.8rem]">{d.rationale}</td>
                      <td className="text-[0.8rem] text-[color:var(--muted-fg)]">{d.alternatives_considered ?? "—"}</td>
                      <td className="text-[0.75rem] tabular-nums">{d.decided_by} · {d.decided_at.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default function RouteDecisionPage() {
  return (
    <Suspense fallback={null}>
      <RouteDecisionView />
    </Suspense>
  );
}
