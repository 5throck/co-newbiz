"use client";

import { useEffect, useState } from "react";
import { FileText, Printer } from "lucide-react";
import { api, ApiError } from "../../lib/api.ts";

interface ReportDoc {
  id: string;
  run_id: string;
  project_id: string;
  run_label: string | null;
  version: number;
  superseded_by: string | null;
  document_section_hash: string | null;
  created_at: string;
}

export default function ReportsPage() {
  const [docs, setDocs] = useState<ReportDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ReportDoc[]>("/api/reports")
      .then((res) => setDocs(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "보고서 목록을 불러오지 못했습니다."));
  }, []);

  return (
    <main className="reports-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="flex items-center gap-2">
          <FileText size={22} className="text-[color:var(--primary)]" /> 보고서
        </h1>
        <button type="button" className="btn-ghost" onClick={() => window.print()}>
          <Printer size={16} /> 인쇄 / PDF
        </button>
      </div>
      <p className="text-sm text-[color:var(--muted-fg)] mt-1 mb-4">
        생성된 보고서 문서 목록(document 테이블)과 대체(superseded) 체인. DOCX/HWPX 내보내기는 기존 리포트 렌더러 연동 후 제공 예정입니다.
      </p>

      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {docs === null ? (
        <p>불러오는 중...</p>
      ) : docs.length === 0 ? (
        <div className="glass p-5 text-sm text-[color:var(--muted-fg)]">
          생성된 보고서가 없습니다. 분석 실행(run)에서 문서가 생성되면 이 목록에 표시됩니다.
        </div>
      ) : (
        <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
          <caption className="sr-only">보고서 문서 목록</caption>
          <thead>
            <tr>
              <th scope="col">문서 ID</th>
              <th scope="col">프로젝트</th>
              <th scope="col">실행</th>
              <th scope="col">버전</th>
              <th scope="col">상태</th>
              <th scope="col">생성일</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="font-mono text-xs">{d.id}</td>
                <td>{d.project_id}</td>
                <td>{d.run_label ?? d.run_id}</td>
                <td>{d.version}</td>
                <td>
                  {d.superseded_by === null ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      현재 버전
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-500/10 text-slate-400 border border-slate-500/20">
                      대체됨 ({d.superseded_by})
                    </span>
                  )}
                </td>
                <td>{new Date(d.created_at).toLocaleString("ko-KR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
