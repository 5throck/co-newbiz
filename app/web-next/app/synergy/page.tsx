"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

// S3 시너지 정합성 (/synergy) — Long List(S1 시장분석 + S2 기회발굴)를
// 회사 단위 Short List로 좁히는 단계. 회사를 등록하면 DART 재무제표·사업
// 보고서와 외부 리서치(기관·증권사·뉴스, 출처 명기)를 입수해 재무 강/약점,
// S1·S2 연계 시너지 영역, Short List를 산출한다.

interface SynergyStepSummary { step: number; title: string; summary: string; source: string }
interface SynergySourceRef { title: string; url: string; snippet?: string }
interface SynergyPayload {
  company: { name: string; dartCorpCode: string | null };
  dartFinancials: { available: boolean; year?: string; items?: Array<{ name: string; value: number }>; reportUrl?: string; error?: string };
  researchSources: SynergySourceRef[];
  financialStrengths: string[];
  financialWeaknesses: string[];
  businessAssessment: string;
  marketLinkage: {
    marketSummaries: Array<{ industry: string; cagrPct: number | null; gapPct: number | null; newDrivers: string[] }>;
    synergyAreas: Array<{ area: string; synergyType: string; rationale: string; opportunity: string; risk: string; sources: string[] }>;
  };
  shortList: Array<{ rank: number; area: string; verdict: string; reason: string }>;
  stepSummaries: SynergyStepSummary[];
}
interface SynergyAnalysis {
  id: string; status: "in_progress" | "completed"; current_step: number;
  company_name: string; dart_corp_code: string | null;
  created_at: string; completed_at: string | null; latest_version: number | null;
  versions?: Array<{ version_no: number; payload: SynergyPayload | null; changelog: string | null; created_by: string; created_at: string }>;
}

const STEP_TITLES = ["DART 재무 입수", "외부 리서치", "재무 강/약점 분석", "S1·S2 연계 시너지", "Short List 정리"];

export function SynergyView() {
  const [analyses, setAnalyses] = useState<SynergyAnalysis[] | null>(null);
  const [selected, setSelected] = useState<SynergyAnalysis | null>(null);
  const [detail, setDetail] = useState<SynergyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [corpCode, setCorpCode] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    return api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses")
      .then((r) => { setAnalyses(r.data.analyses); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const hasInProgress = analyses?.some((a) => a.status === "in_progress") ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [hasInProgress, refresh]);

  const openDetail = useCallback((a: SynergyAnalysis) => {
    setSelected(a);
    setDetail(null);
    api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(a.id)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || creating) return;
    setCreating(true);
    try {
      await api.post("/api/synergy/analyses", { company_name: companyName.trim(), dart_corp_code: corpCode.trim() || undefined });
      setCompanyName(""); setCorpCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 생성 실패");
    } finally {
      setCreating(false);
    }
  }

  if (selected) {
    return (
      <main>
        <h1>시너지 정합성</h1>
        <button type="button" className="btn-ghost mb-3 text-[0.8rem]" onClick={() => { setSelected(null); setDetail(null); void refresh(); }}>← 회사 목록으로</button>
        <SynergyResult analysis={detail ?? selected} />
      </main>
    );
  }

  return (
    <main>
      <h1>시너지 정합성</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        프로세스 스테이지 S3 — S1 시장분석·S2 기회발굴의 Long List를 회사 단위 <strong>Short List</strong>로
        좁힙니다. 회사를 등록하면 DART 재무제표·사업보고서와 외부 리서치(기관·증권사·뉴스, 출처 명기·교차검증)를
        입수해 재무 강/약점과 S1·S2 연계 시너지 영역을 분석합니다.
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      <section aria-label="회사 등록 및 분석" className="market-section">
        <h2 className="text-[0.92rem] mb-2">🏢 회사 등록 후 분석 시작</h2>
        <form onSubmit={create} aria-label="시너지 분석 생성" className="sizing-new-form mb-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[0.78rem]">
              <span className="block mb-1">회사명 *</span>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="예: 테크크로스" required className="sizing-new-input" />
            </label>
            <label className="text-[0.78rem]">
              <span className="block mb-1">DART corp code (선택, 8자리)</span>
              <input value={corpCode} onChange={(e) => setCorpCode(e.target.value)} placeholder="미입력 시 이름으로 검색" className="sizing-new-input sizing-new-input-sm" />
            </label>
            <button type="submit" className="btn-ghost text-[0.8rem]" disabled={creating || !companyName.trim()}>
              {creating ? "생성 중..." : "분석 시작"}
            </button>
          </div>
          <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
            상장사·외감기업은 DART 재무제표·사업보고서를 입수하고, 글로벌 기관·증권사·뉴스 리서치로
            보강(출처 명기·교차검증)한 뒤 S1·S2 연계 시너지를 분석합니다.
          </p>
        </form>

        {analyses === null ? (
          <p>불러오는 중...</p>
        ) : analyses.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 시너지 분석이 없습니다. 회사를 등록해 시작하세요.</p>
        ) : (
          <table className="data-table" aria-label="시너지 분석 목록">
            <caption className="sr-only">시너지 분석 목록</caption>
            <thead>
              <tr>
                <th scope="col">회사명</th>
                <th scope="col">DART 코드</th>
                <th scope="col">분석 상태</th>
                <th scope="col">분석일</th>
                <th scope="col">액션</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => {
                const inProgress = a.status === "in_progress";
                return (
                  <tr key={a.id}>
                    <td className="cell-primary font-semibold">{a.company_name}</td>
                    <td><code className="dd-item-id">{a.dart_corp_code ?? "—"}</code></td>
                    <td>
                      {inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a.current_step}/5단계)</span>
                      ) : (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      )}
                    </td>
                    <td className="tabular-nums">{(a.completed_at ?? a.created_at).slice(0, 10)}</td>
                    <td>
                      <button type="button" className="btn-ghost text-[0.78rem]" disabled={inProgress} onClick={() => openDetail(a)}>
                        {inProgress ? "분석 중" : "분석 열기"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hasInProgress && <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]" role="status">분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.</p>}
      </section>
    </main>
  );
}

function SynergyResult({ analysis }: { analysis: SynergyAnalysis }) {
  const latest = analysis.versions?.[0] ?? null;
  const p = latest?.payload ?? null;
  const inProgress = analysis.status === "in_progress";
  return (
    <>
      <div className="sizing-report-header">
        <h2>🏢 {analysis.company_name} 시너지 정합성 분석</h2>
        <p className="text-[color:var(--muted-fg)] text-[0.78rem]">
          S3 Long List → Short List · 분석일: {latest?.created_at?.slice(0, 10) ?? analysis.created_at.slice(0, 10)} · v{latest?.version_no ?? analysis.latest_version ?? 1}
        </p>
      </div>
      {inProgress && (
        <p className="market-section sizing-step text-[0.85rem]" role="status">
          분석 중 ({analysis.current_step}/5단계) — {STEP_TITLES[analysis.current_step] ?? ""} 진행 중입니다.
        </p>
      )}
      {!p && !inProgress && <p className="market-section text-[color:var(--muted-fg)] italic">분석 결과가 없습니다.</p>}
      {p && (
        <div className="sizing-report">
          {/* 1. 재무 현황 */}
          <section className="market-section sizing-step">
            <h3 className="sizing-step-title"><span className="sizing-step-badge">1</span> 재무 현황 (DART {p.dartFinancials.available ? `${p.dartFinancials.year}년 사업보고서` : "미입수"})</h3>
            {p.dartFinancials.available && p.dartFinancials.items ? (
              <table className="data-table" aria-label="DART 재무 요약">
                <caption className="sr-only">DART 재무 요약</caption>
                <thead><tr><th scope="col">계정</th><th scope="col">금액 (억원)</th></tr></thead>
                <tbody>
                  {p.dartFinancials.items.map((i) => (
                    <tr key={i.name}><td className="font-semibold">{i.name}</td><td className="tabular-nums">{(i.value / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 })} 억원</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">DART 미입수 — {p.dartFinancials.error ?? "사유 없음"} (웹 리서치로 보완)</p>
            )}
            {p.dartFinancials.reportUrl && (
              <a href={p.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[0.78rem] text-[color:var(--accent)] underline">사업보고서 원문 보기 (DART)</a>
            )}
          </section>

          {/* 2. 재무 강/약점 */}
          <section className="market-section sizing-step">
            <h3 className="sizing-step-title"><span className="sizing-step-badge">2</span> 재무·사업 강/약점 분석</h3>
            <div className="chart-pair">
              <div className="chart-half sizing-grade-card">
                <h4 className="text-[0.85rem] mb-2">💪 강점</h4>
                <ul className="sizing-note-list">{p.financialStrengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              <div className="chart-half sizing-grade-card">
                <h4 className="text-[0.85rem] mb-2">🩹 약점</h4>
                <ul className="sizing-note-list">{p.financialWeaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            </div>
            <p className="mt-3 mb-0 text-[0.82rem]"><strong>종합 평가:</strong> {p.businessAssessment}</p>
          </section>

          {/* 3. S1/S2 연계 시너지 영역 */}
          <section className="market-section sizing-step">
            <h3 className="sizing-step-title"><span className="sizing-step-badge">3</span> S1·S2 연계 시너지 영역 (Long List → 분석)</h3>
            <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
              연계 시장: {p.marketLinkage.marketSummaries.map((m) => `${m.industry} (CAGR ${m.cagrPct ?? "?"}%${m.gapPct !== null ? `, 격차 ${m.gapPct > 0 ? "+" : ""}${m.gapPct}%` : ""})`).join(" · ") || "없음"}
            </p>
            <table className="data-table" aria-label="시너지 영역">
              <caption className="sr-only">시너지 영역</caption>
              <thead>
                <tr><th scope="col">영역</th><th scope="col">유형</th><th scope="col">근거</th><th scope="col">기회</th><th scope="col">위험</th></tr>
              </thead>
              <tbody>
                {p.marketLinkage.synergyAreas.map((a) => (
                  <tr key={a.area}>
                    <td className="font-semibold">{a.area}</td>
                    <td className="text-[0.75rem]">{a.synergyType}</td>
                    <td className="text-[0.78rem]">{a.rationale}{a.sources.length > 0 && <span className="text-[color:var(--muted-fg)]"> (출처: {a.sources.join(", ")})</span>}</td>
                    <td className="text-[0.78rem]">{a.opportunity}</td>
                    <td className="text-[0.78rem]">{a.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* 4. Short List */}
          <section className="market-section sizing-step sizing-step-deep">
            <h3 className="sizing-step-title"><span className="sizing-step-badge sizing-step-badge-deep">4</span> Short List — 시너지 영역 선별</h3>
            <table className="data-table" aria-label="시너지 Short List">
              <caption className="sr-only">시너지 Short List</caption>
              <thead><tr><th scope="col">순위</th><th scope="col">영역</th><th scope="col">판정</th><th scope="col">사유</th></tr></thead>
              <tbody>
                {p.shortList.map((s) => (
                  <tr key={s.rank}>
                    <td className="tabular-nums font-semibold">{s.rank}</td>
                    <td className="font-semibold">{s.area}</td>
                    <td><span className={`status-chip ${s.verdict.includes("Short") ? "status-green" : "status-not-started"}`}>{s.verdict}</span></td>
                    <td className="text-[0.78rem]">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">
              Short List 확정 영역은 기회 등록(S2)·딜 승격(S4~S7)으로 이어집니다 — 프로젝트 등록 시 대상 회사가 필수입니다.
            </p>
          </section>

          {/* 5. 출처 + 단계 로그 */}
          {p.researchSources.length > 0 && (
            <details className="market-section sizing-step">
              <summary className="cursor-pointer text-[0.82rem]">📚 입수 출처 ({p.researchSources.length}건 — 출처 명기·교차검증)</summary>
              <ul className="sizing-note-list mt-2">
                {p.researchSources.map((s, i) => (
                  <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                ))}
              </ul>
            </details>
          )}
          <details className="market-section sizing-step">
            <summary className="cursor-pointer text-[0.82rem]">📝 파이프라인 단계별 노트 ({p.stepSummaries.length}단계)</summary>
            <ol className="mt-3 space-y-2 text-[0.8rem]">
              {p.stepSummaries.map((s) => (
                <li key={s.step}><strong>{s.step}. {s.title}</strong> <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>{s.source === "llm" ? "LLM" : "시스템"}</span><br />{s.summary}</li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </>
  );
}

export default SynergyView;
