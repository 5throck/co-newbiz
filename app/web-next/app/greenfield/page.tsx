"use client";

// S5 자체 진출 (/greenfield) — ADR-0120 Wave 2 Phase A: 본문은 공유 컴포넌트
// components/stages/GreenfieldStage.tsx로 추출되었다. 이 페이지는 기회 선택 칩과
// URL(?opportunity=) 동기화만 담당하는 래퍼다 — /deals/[id]/s5 탭도 동일 컴포넌트를
// 소비한다. flow.spec 그린필드 경로: 진출전략 → 필요 역량 확인 → 투자비 검토 요건
// (greenfield-capability-assessment 절차, B-7).
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GreenfieldStage } from "../../components/stages/GreenfieldStage.tsx";

interface OppRow {
  id: string; name: string; market_scope: string | null; synergy_score: number | null;
  sub_track: string | null; assessed_at: string | null;
}

function GreenfieldView() {
  const searchParams = useSearchParams();
  const [opps, setOpps] = useState<OppRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("opportunity"));

  const loadOpps = useCallback(() => {
    api.get<{ opportunities: OppRow[] }>("/api/greenfield").then((r) => setOpps(r.data.opportunities)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => { loadOpps(); }, [loadOpps]);

  const openOpportunity = useCallback((o: OppRow) => {
    // replaceState — Next useSearchParams는 재렌더를 트리거하지 않으므로 로컬
    // 상태를 함께 갱신한다(딥링크 진입은 useState 초기값으로 처리).
    window.history.replaceState(null, "", `/greenfield?opportunity=${encodeURIComponent(o.id)}`);
    setSelectedId(o.id);
  }, []);

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
                aria-pressed={selectedId === o.id}
                className={`sizing-industry-chip ${selectedId === o.id ? "sizing-industry-chip-active" : ""}`}
                onClick={() => openOpportunity(o)}
              >
                <span className="font-semibold">{o.name}</span>
                <span className="sizing-chip-meta">{o.assessed_at ? "평가 완료" : "평가 전"}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedId && <GreenfieldStage key={selectedId} opportunityId={selectedId} onSaved={loadOpps} />}
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
