"use client";

// 포트폴리오 전체 뷰 (ADR-0122 #4) — 딜 간 중복 노출(같은 시장 범위)과
// 집중도를 그룹 관점에서 감시한다. 개별 판단은 Group IC가 한다 (경계 #2).
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api.ts";
import { PageState } from "../../components/ui.tsx";

interface Opp { id: string; name: string; market_scope: string | null; status: string }
interface Proj { id: string; project_no: string; project_name?: string | null; track?: string | null }

function PortfolioView() {
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const [projs, setProjs] = useState<Proj[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Opp[]>("/api/opportunities"),
      api.get<Proj[]>("/api/projects"),
    ]).then(([o, p]) => { setOpps(o.data); setProjs(p.data); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  // 중복 감지: 같은 market_scope(시장 범위)에 2건 이상 활성 노출
  const dup = useMemo(() => {
    const map = new Map<string, Array<{ kind: string; id: string; name: string }>>();
    for (const o of opps ?? []) {
      if (o.status === "dropped" || !o.market_scope) continue;
      const arr = map.get(o.market_scope) ?? [];
      arr.push({ kind: "기회", id: o.id, name: o.name });
      map.set(o.market_scope, arr);
    }
    for (const p of projs ?? []) {
      const name = p.project_name ?? p.project_no;
      const arr = map.get(name.slice(0, 4)) ?? [];
      // 프로젝트명 접두 근사 매칭은 과도한 오탐 → 시장 범위가 없어 감지 대상 아님
      void arr;
    }
    return [...map.entries()].filter(([, arr]) => arr.length >= 2);
  }, [opps, projs]);

  const active = (opps ?? []).filter((o) => o.status !== "dropped").length;

  return (
    <main>
      <h1>포트폴리오 전체 뷰</h1>
      <p className="objective">딜 간 중복 노출과 집중도를 그룹 관점에서 감시합니다 (group-review-agent) — 개별 판단은 Group IC가 합니다.</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <div className="summary-cards mb-4">
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{active}</span><span className="text-label">활성 기회</span></div>
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{projs?.length ?? 0}</span><span className="text-label">프로젝트 (S8~)</span></div>
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{dup.length}</span><span className="text-label">시장 중복 후보</span></div>
      </div>
      <section className="market-section" aria-label="중복 감지">
        <h2 className="text-[0.9rem] mb-2">시장 중복 감지 <span className="note">— 같은 시장 범위에 활성 노출 2건 이상</span></h2>
        {opps === null || projs === null ? <PageState state="loading" /> : dup.length === 0 ? (
          <PageState state="empty" emptyText="중복 노출 후보가 없습니다." />
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-label="중복 감지">
              <caption className="sr-only">시장 중복 감지</caption>
              <thead><tr><th>시장 범위</th><th>노출</th><th>권고</th></tr></thead>
              <tbody>{dup.map(([scope, arr]) => (
                <tr key={scope}>
                  <td className="font-semibold">{scope}</td>
                  <td>{arr.map((a) => <Link key={a.id} href={a.kind === "기회" ? `/opportunities?opportunity=${a.id}` : `/projects/${a.id}/process`} className="block text-[0.78rem] underline">{a.kind} — {a.name}</Link>)}</td>
                  <td className="text-[0.78rem]"><span className="status-chip status-amber">시너지 통합 검토 또는 시기 조정</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default function PortfolioOverviewPage() {
  return <Suspense fallback={null}><PortfolioView /></Suspense>;
}
