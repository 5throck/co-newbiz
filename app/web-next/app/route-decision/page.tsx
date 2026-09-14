"use client";

// /route-decision — legacy flat S4 route. Superseded by /deals/{id}/s4
// (Wave 2 migration, docs/designs/2026-09-12-implementation-matrix.md #11).
// Kept for two entry points that don't carry an opportunity id:
//   1. ?opportunity=<id> links (opportunities/synergy/greenfield/brownfield/
//      PromotionPanel/lib/pipeline.ts/process/[stage]/onboarding) — redirect
//      straight through to the deal-scoped screen.
//   2. bare /route-decision (sidebar nav, lib/navigation.ts) — no deal is
//      known yet, so offer the same "selected" opportunity picker the old
//      screen had, just as a landing step rather than the S4 screen itself.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { PageState } from "../../components/ui.tsx";
import { SectionToolbar } from "../../components/layout.tsx";

interface OpportunityRow {
  id: string; name: string; attractiveness_score: number | null; synergy_score: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  project_id: string | null;
  decided_at: string | null;
  deleted_at: string | null;
}

function RouteDecisionRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const opportunityId = searchParams.get("opportunity");
  const rationale = searchParams.get("rationale");
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 승격된 검토/안건 년/월 필터 — 케이스가 쌓이면 한 번에 다 보여주는 대신
  // 승격(정리) 시점 기준으로 좁혀 볼 수 있게 한다. 빈 값("")은 전체.
  const [promotedYear, setPromotedYear] = useState("");
  const [promotedMonth, setPromotedMonth] = useState("");

  useEffect(() => {
    if (!opportunityId) return;
    const qs = rationale ? `?rationale=${encodeURIComponent(rationale)}` : "";
    router.replace(`/deals/${encodeURIComponent(opportunityId)}/s4${qs}`);
  }, [router, opportunityId, rationale]);

  const loadRows = useCallback(() => {
    // includePromoted=1 — project_id가 있어 이미 프로젝트로 승격된 검토/안건
    // (뒤에 별도로 삭제 표시(deleted_at)까지 된 것 포함)도 함께 가져와
    // "승격" 묶음으로 보여준다. 새로 결정할 수는 없지만 S4 결정 이력은
    // 계속 열람할 수 있어야 한다.
    api.get<OpportunityRow[]>("/api/opportunities?status=selected&includePromoted=1").then((r) => {
      setRows(r.data);
    }).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => {
    if (opportunityId) return;
    loadRows();
  }, [opportunityId, loadRows]);

  if (opportunityId) return <PageState state="loading" />;

  return (
    <main>
      <StageFrameLite />
      {error && <PageState state="error" errorText={error} onRetry={loadRows} />}
      {!error && rows === null && <PageState state="loading" />}
      {!error && rows !== null && rows.length === 0 && (
        <PageState state="empty" emptyText="선별(selected)된 기회가 없습니다 — 기회 발굴(S2)에서 시너지·적합성 평가(S3)를 마친 기회를 선별하면 여기 표시됩니다." />
      )}
      {!error && rows !== null && rows.length > 0 && (() => {
        // 승격 여부는 project_id로 판정한다 — deleted_at은 그 뒤 별도로
        // 정리(아카이브)됐는지를 나타내는 독립적인 신호일 뿐이다. project_id가
        // 있으면 S5/S6·S7을 거쳐 이미 프로젝트로 넘어간 것이므로 여기서는
        // 새로 결정할 수 없는 "승격" 묶음으로 봐야 한다.
        const active = rows.filter((o) => !o.project_id);
        const promoted = rows.filter((o) => o.project_id);
        return (
          <>
            {active.length > 0 && (
              <div className="card">
                <h2>검토/안건 선택</h2>
                <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-3">
                  진출방식을 결정할 검토/안건을 선택하세요 — 결정 화면은 검토/안건별로 열립니다.
                </p>
                <div className="deal-pick-grid">
                  {active.map((o) => (
                    <Link key={o.id} href={`/deals/${encodeURIComponent(o.id)}/s4`} className="deal-pick-card">
                      <span className="deal-pick-card-title">{o.name}</span>
                      <span className="deal-pick-card-stats">
                        <span className="status-chip status-not-started">매력도 <strong className="ml-1">{o.attractiveness_score ?? "—"}</strong></span>
                        <span className="status-chip status-not-started">시너지 <strong className="ml-1">{o.synergy_score ?? "—"}</strong></span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {promoted.length > 0 && (() => {
              // 승격 시점 필터는 decided_at(S4 결정 시각) 기준이다 — 승격된
              // 검토/안건이 전부 deleted_at(별도 아카이브)을 갖는 건 아니므로
              // deleted_at은 이 필터의 날짜 출처로 쓸 수 없다.
              const years = [...new Set(promoted.map((o) => (o.decided_at ?? "").slice(0, 4)).filter(Boolean))].sort().reverse();
              const months = promotedYear
                ? [...new Set(promoted.filter((o) => (o.decided_at ?? "").slice(0, 4) === promotedYear).map((o) => (o.decided_at ?? "").slice(5, 7)))].sort()
                : [];
              const filteredPromoted = promoted.filter((o) =>
                (!promotedYear || (o.decided_at ?? "").slice(0, 4) === promotedYear) &&
                (!promotedMonth || (o.decided_at ?? "").slice(5, 7) === promotedMonth),
              );
              return (
                <div className="card mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <h2 className="mb-0">승격 <span className="text-[0.72rem] font-normal text-[color:var(--muted-fg)]">— 결정 이력만 열람 · {filteredPromoted.length}건</span></h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-[0.75rem]">
                        <span className="sr-only">연도</span>
                        <select
                          value={promotedYear}
                          onChange={(e) => { setPromotedYear(e.target.value); setPromotedMonth(""); }}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">전체 연도</option>
                          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
                        </select>
                      </label>
                      <label className="text-[0.75rem]">
                        <span className="sr-only">월</span>
                        <select
                          value={promotedMonth}
                          onChange={(e) => setPromotedMonth(e.target.value)}
                          disabled={!promotedYear}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">전체 월</option>
                          {months.map((m) => <option key={m} value={m}>{Number(m)}월</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                  <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-3">
                    이미 프로젝트로 승격된 검토/안건입니다 — 새로 결정할 수는 없지만 S4 결정 이력은 계속 열람할 수 있습니다.
                  </p>
                  {filteredPromoted.length === 0 ? (
                    <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">선택한 기간에 승격된 검토/안건이 없습니다.</p>
                  ) : (
                    <div className="deal-pick-grid">
                      {filteredPromoted.map((o) => (
                        <Link key={o.id} href={`/deals/${encodeURIComponent(o.id)}/s4`} className="deal-pick-card">
                          <span className="deal-pick-card-title">{o.name}</span>
                          <span className="deal-pick-card-stats">
                            <span className="status-chip status-green">승격됨</span>
                            <span className="status-chip status-not-started">매력도 <strong className="ml-1">{o.attractiveness_score ?? "—"}</strong></span>
                            <span className="status-chip status-not-started">시너지 <strong className="ml-1">{o.synergy_score ?? "—"}</strong></span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        );
      })()}
    </main>
  );
}

/** 검토/안건 미지정 진입(사이드바 nav) 전용 — StageFrame과 달리 검토/안건 컨텍스트(project id)가
    없어 스테이지 레일 없이 제목/설명만 표시한다(R4: 단계 화면 h1은 StageFrame 전용). */
function StageFrameLite() {
  return (
    <SectionToolbar
      title="S4 진출방식 결정"
      summary="어떻게 들어갈 것인가? — Greenfield vs Brownfield를 결정한다 (Brownfield ≠ M&A)"
    />
  );
}

export default function RouteDecisionPage() {
  return (
    <Suspense fallback={null}>
      <RouteDecisionRedirect />
    </Suspense>
  );
}
