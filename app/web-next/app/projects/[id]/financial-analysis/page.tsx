"use client";

// /projects/[id]/financial-analysis — the bridge tab (ADR-0116 Phase 1;
// implements the approved mockup
// docs/designs/mockups/2026-09-11-project-fa-bridge-ui-mockup_ko.html).
// The dense financial analysis lives on the company screen; this tab binds
// the project's subject company (인수 대상 / 분석 기준 회사), shows the
// summary metrics card, and links out to the full dashboard.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";

interface CompanySummary {
  id: string;
  name_ko: string;
  dart_corp_code: string | null;
  role: string;
  rationale: string;
  latest_sync_at: string | null;
  metrics: { revenue_latest: number | null; revenue_growth: number | null; operating_margin: number | null; debt_ratio: number | null; roe: number | null };
}
interface View { project: { id: string; project_no: string; track: string | null }; company: CompanySummary | null }
interface CompanyRow { id: string; name_ko: string; dart_corp_code: string | null; fact_years: number }

const pct = (v: number | null): string => (v === null ? "N/A" : `${(v * 100).toFixed(1)}%`);
const eok = (v: number | null): string => (v === null ? "N/A" : `${(v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`);

export default function FinancialAnalysisBridgePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<CompanyRow[] | null>(null);
  const [rationale, setRationale] = useState("");
  const [linking, setLinking] = useState(false);

  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/financial-analysis`)
      .then((r) => { setView(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "재무분석 데이터를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function search() {
    try {
      const r = await api.get<{ companies: CompanyRow[] }>(`/api/companies?q=${encodeURIComponent(q.trim())}`);
      setResults(r.data.companies);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "회사 검색에 실패했습니다.");
    }
  }

  async function connect(companyId: string) {
    if (!rationale.trim()) {
      setMessage("연결 근거(rationale)를 입력하세요.");
      return;
    }
    setLinking(true);
    setMessage(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/financial-analysis/company`, { company_id: companyId, rationale: rationale.trim() });
      setResults(null);
      setRationale("");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "회사 연결에 실패했습니다.");
    } finally {
      setLinking(false);
    }
  }

  const company = view?.company ?? null;
  const roleChip = company?.role === "target" ? "brownfield · 인수 대상" : "greenfield · 분석 기준 회사";

  return (
    <main className="market-page">
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S8" heading="재무분석 — 대상 회사 연결">
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">✕ {error}</p>}
        {message && <p className="text-[0.82rem] text-[color:var(--accent)]">{message}</p>}
        {!view ? (
          <p>불러오는 중...</p>
        ) : (
          <>
            {company ? (
              <section className="market-section sizing-step">
                <h3 className="sizing-step-title">연결된 대상 회사 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">{roleChip}</span></h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[1.05rem] font-extrabold">{company.name_ko}</span>
                  {company.dart_corp_code && <span className="font-mono text-[0.78rem] text-[color:var(--muted-fg)]">dart corp code {company.dart_corp_code}</span>}
                  <span className={company.latest_sync_at ? "inline-block rounded-full px-2 py-0.5 text-[0.68rem] font-bold whitespace-nowrap bg-[color:var(--success-bg)] text-[color:var(--success)]" : "inline-block rounded-full px-2 py-0.5 text-[0.68rem] font-bold whitespace-nowrap bg-[color:var(--warning-bg)] text-[color:var(--warning)]"}>{company.latest_sync_at ? `동기화됨 · ${new Date(company.latest_sync_at).toLocaleDateString("ko-KR")}` : "동기화 전 — 회사 화면에서 동기화하세요"}</span>
                </div>
                <div className="grid gap-2 md:grid-cols-4 mt-2">
                  <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[0.72rem]">매출액 (최근 연도)</div><div className="font-extrabold text-[1.1rem] tabular-nums">{eok(company.metrics.revenue_latest)}</div><div className="text-[0.72rem] text-[color:var(--muted-fg)]">전년 {company.metrics.revenue_growth === null ? "—" : pct(company.metrics.revenue_growth)}</div></div>
                  <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[0.72rem]">영업이익률</div><div className="font-extrabold text-[1.1rem] tabular-nums">{pct(company.metrics.operating_margin)}</div></div>
                  <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[0.72rem]">부채비율</div><div className="font-extrabold text-[1.1rem] tabular-nums">{pct(company.metrics.debt_ratio)}</div></div>
                  <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[0.72rem]">ROE</div><div className="font-extrabold text-[1.1rem] tabular-nums">{pct(company.metrics.roe)}</div></div>
                </div>
                <div className="mt-3 flex gap-3 items-center flex-wrap">
                  <Link className="text-[color:var(--accent)] font-bold text-[0.86rem] whitespace-nowrap" href={`/companies/${company.id}`}>전체 재무성과 분석 열기 →</Link>
                  <span className="text-[color:var(--muted-fg)] text-[0.8rem]">회사 화면에서 실적 테이블·지표 해설·WACC 참조값을 확인할 수 있습니다.</span>
                </div>
                {company.rationale && <p className="text-[color:var(--muted-fg)] text-[0.76rem] mt-2">연결 근거(rationale): &quot;{company.rationale}&quot;</p>}
              </section>
            ) : (
              <section className="market-section sizing-step">
                <div className="border border-dashed border-[color:var(--border-bright)] rounded-lg p-6 text-center text-[color:var(--muted-fg)] text-[0.88rem]">
                  연결된 대상 회사가 없습니다 — 아래에서 회사를 검색해 연결하면<br />
                  <b>핵심 지표 요약 · 전체 재무성과 분석 · WACC 참조값</b>을 사용할 수 있습니다.
                </div>
              </section>
            )}

            <section className="market-section sizing-step mt-3">
              <h3 className="sizing-step-title">대상 회사 연결/변경</h3>
              <div className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
                <div>
                  <div className="text-[color:var(--muted-fg)] text-[0.78rem] mb-1">회사명 또는 DART 고유번호 검색</div>
                  <input
                    className="sizing-new-input w-full"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
                    placeholder="예: 케이로보틱스, 01234567"
                    aria-label="회사 검색"
                  />
                </div>
                <button className="border border-[color:var(--border-bright)] bg-[color:var(--surface)] rounded-lg px-4 py-2 text-[0.85rem] cursor-pointer" type="button" onClick={search}>검색</button>
              </div>
              {results !== null && (
                results.length === 0 ? (
                  <p className="text-[color:var(--muted-fg)] text-[0.84rem] mt-2">검색 결과가 없습니다 — 회사가 아직 등록되지 않았다면 관리자 콘솔 › 마스터 데이터에서 먼저 등록하세요.</p>
                ) : (
                  <div className="border border-[color:var(--border)] rounded-lg mt-2">
                    {results.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-[color:var(--border-subtle)] last:border-b-0 text-[0.86rem]">
                        <b>{c.name_ko}</b>
                        {c.dart_corp_code && <span className="mono text-[0.76rem] text-[color:var(--muted-fg)]">{c.dart_corp_code}</span>}
                        <span className="text-[color:var(--muted-fg)] text-[0.78rem]">{c.fact_years > 0 ? `재무 데이터 ${c.fact_years}년` : "재무 데이터 없음"}</span>
                        <button className="border border-[color:var(--border-bright)] bg-[color:var(--surface)] rounded-lg px-4 py-2 text-[0.85rem] cursor-pointer ml-auto" type="button" disabled={linking} onClick={() => connect(c.id)}>이 회사 연결</button>
                      </div>
                    ))}
                  </div>
                )
              )}
              <div className="mt-2">
                <div className="text-[color:var(--muted-fg)] text-[0.78rem] mb-1">연결 근거 (rationale) — 필수</div>
                <input className="sizing-new-input w-full" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="예: S7 스크리닝 1순위 대상 — 사업 부합" />
              </div>
              <p className="text-[color:var(--muted-fg)] text-[0.76rem] mt-2">역할은 트랙에서 자동 판정됩니다 — brownfield → <b>인수 대상(target)</b>, greenfield → <b>분석 기준 회사(candidate)</b>. 연결·변경은 감사 로그에 기록됩니다.</p>
              {view.project.track === "greenfield" && (
                <div className="mt-1 rounded-lg px-3 py-2 text-[0.84rem] bg-[color:var(--warning-bg)] text-[color:var(--warning)] mt-1">
                  <b>그린필드 안내</b> — 자체 신설 진출은 인수 대상이 없으므로, 벤치마킹할 <b>분석 기준 회사</b>를 연결합니다. 미연결 시 사업성 분석의 &quot;과거 기반&quot; 관점과 WACC 회사 참조값 없이 진행됩니다(시장 기반만).
                </div>
              )}
            </section>
          </>
        )}
      </StageFrame>
    </main>
  );
}
