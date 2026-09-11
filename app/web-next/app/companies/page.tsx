"use client";

// /companies — company list + search (ADR-0116 Phase 1). Entry point for the
// company connect flow and direct lookup; the dashboard per company lives at
// /companies/[companyId]. No top-level menu entry — companies are reached
// from deal flow contexts (bridge tab, target lists).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.ts";

interface CompanyRow {
  id: string;
  name_ko: string;
  dart_corp_code: string | null;
  fact_years: number;
  latest_sync_at: string | null;
}

export default function CompaniesPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((query: string) => {
    api.get<{ companies: CompanyRow[] }>(`/api/companies?q=${encodeURIComponent(query)}`)
      .then((r) => setRows(r.data.companies))
      .catch((e) => setError(e instanceof Error ? e.message : "회사 목록을 불러오지 못했습니다."));
  }, []);
  useEffect(() => { load(""); }, [load]);

  return (
    <main className="market-page">
      <h1 className="text-[1.35rem] font-extrabold tracking-tight mt-6">회사</h1>
      <p className="text-[color:var(--muted-fg)] text-[0.9rem] mb-3">인수 대상 및 분석 기준 회사의 재무성과 분석 화면입니다. 회사를 검색해 선택하세요.</p>

      <form
        className="flex gap-2 mb-3"
        onSubmit={(e) => { e.preventDefault(); load(q.trim()); }}
      >
        <input
          className="sizing-new-input flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="회사명 또는 DART 고유번호 검색"
          aria-label="회사 검색"
        />
        <button className="bg-[color:var(--accent)] text-[color:var(--accent-fg)] rounded-lg px-4 py-2 text-[0.88rem] font-bold cursor-pointer" type="submit">검색</button>
      </form>

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">✕ {error}</p>}
      {!rows ? (
        <p className="text-[color:var(--muted-fg)]">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-[color:var(--border-bright)] rounded-lg p-6 text-center text-[color:var(--muted-fg)] text-[0.88rem]">
          검색 결과가 없습니다 — 회사 연결이 필요하면 프로젝트 재무분석 탭에서 DART 고유번호와 함께 등록하세요.
        </div>
      ) : (
        <table className="data-table">
          <thead><tr><th>회사명</th><th>DART 고유번호</th><th>재무 데이터</th><th>마지막 동기화</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.name_ko}</td>
                <td className="font-mono text-[0.8rem]">{c.dart_corp_code ?? "—"}</td>
                <td>{c.fact_years > 0 ? `${c.fact_years}개 회계연도` : "없음 — 동기화 필요"}</td>
                <td className="text-[color:var(--muted-fg)] text-[0.8rem]">{c.latest_sync_at ? new Date(c.latest_sync_at).toLocaleDateString("ko-KR") : "—"}</td>
                <td><Link className="text-[color:var(--accent)] font-bold text-[0.86rem] whitespace-nowrap" href={`/companies/${c.id}`}>재무성과 보기 →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
