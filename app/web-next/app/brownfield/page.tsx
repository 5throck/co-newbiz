"use client";

// S6~S7 브라운필드 대상 경로 (/brownfield) — ADR-0120 Wave 2 Phase B: 본문은
// 공유 컴포넌트 components/stages/BrownfieldStage.tsx로 추출되었다. 이 페이지는
// StageFrame·main 셸·기회 선택 칩(?opportunity= URL 동기화)만 제공하는 래퍼다 —
// /deals/[id]/s6·s7 탭도 동일 컴포넌트를 소비한다.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { BrownfieldStage } from "../../components/stages/BrownfieldStage.tsx";

interface OppRow {
  id: string; name: string; market_scope: string | null; synergy_score: number | null;
  track: string | null; sub_track: string | null; target_count: number; shortlist_count: number;
}

function BrownfieldView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [opps, setOpps] = useState<OppRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedId = searchParams.get("opportunity");

  const loadOpps = useCallback(() => {
    api.get<{ opportunities: OppRow[] }>("/api/brownfield").then((r) => setOpps(r.data.opportunities)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => { loadOpps(); }, [loadOpps]);

  // replaceState는 useSearchParams를 갱신하지 않으므로 로컬 상태를 함께 쓴다
  // (딥링크 진입은 selectedId가, 칩 클릭은 selectedLocal이 선택을 운반한다).
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);
  const effectiveSelectedId = selectedLocal ?? selectedId;

  const openOpportunity = useCallback((o: OppRow) => {
    // 본문 로딩은 BrownfieldStage의 opportunityId 이펙트가 담당한다 — 칩은
    // URL 동기화만 한다.
    window.history.replaceState(null, "", `/brownfield?opportunity=${encodeURIComponent(o.id)}`);
    setSelectedLocal(o.id);
  }, []);

  return (
    <main>
      <StageFrame stageId={["S6", "S7"]} track="brownfield" heading="S6/S7 대상발굴·선정">
        Brownfield 경로 — 진출방식이 Brownfield로 결정된 기회의
        대상 후보를 발굴하고(S6 Long List), <code>chk-target-screening</code> 체크리스트로 스크리닝해
        Short List로 좁힙니다(S7). CDD/TDD는 Short List 확정 후 S9에서 수행합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── Brownfield 기회 (칩) ── */}
      <section aria-label="브라운필드 기회" className="market-section">
        <SectionToolbar title="Brownfield로 결정된 기회" count={opps?.length} />
        {opps === null ? (
          <p>불러오는 중...</p>
        ) : opps.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            Brownfield로 결정된 기회가 없습니다 — <a href="/route-decision" className="text-[color:var(--accent)] underline">진출방식 결정(S4)</a>에서 트랙을 정하세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {opps.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={effectiveSelectedId === o.id}
                className={`sizing-industry-chip ${effectiveSelectedId === o.id ? "sizing-industry-chip-active" : ""}`}
                onClick={() => openOpportunity(o)}
              >
                <span className="font-semibold">{o.name}</span>
                <span className="sizing-chip-meta">Long List {o.target_count} · Short List {o.shortlist_count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {effectiveSelectedId && <BrownfieldStage key={effectiveSelectedId} opportunityId={effectiveSelectedId} onSaved={loadOpps} />}
    </main>
  );
}

export default function BrownfieldPage() {
  return (
    <Suspense fallback={null}>
      <BrownfieldView />
    </Suspense>
  );
}
