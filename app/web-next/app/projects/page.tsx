"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api.ts";

// 프로젝트 (/projects) — S8~S12(사업성 분석·DD·투심·포트폴리오)로 이어지는
// 프로젝트 키 화면군의 진입점. 승격된 프로젝트는 이전까지 /opportunities의
// 딥링크로만 도달할 수 있었고 좌측 내비에 목록 화면이 없었다 — 이 페이지가
// 그 빈틈을 채운다. 목록 화면 관례를 따라(library/glossary) 단일 단계가
// 아니므로 StageFrame이 아닌 일반 헤더를 사용한다.
interface ProjectRow {
  id: string;
  project_no: string;
  project_name?: string | null;
  created_at: string;
  origin?: string | null;
  track?: "greenfield" | "brownfield" | null;
  source_opportunity_id?: string | null;
  is_stale?: boolean;
  stale_reasons?: string[];
}

const TRACK_LABEL: Record<string, string> = { greenfield: "그린필드", brownfield: "브라운필드" };

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function ProjectsView() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProjectRow[]>("/api/projects")
      .then((r) => setRows(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  return (
    <main>
      <h1>프로젝트</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        승격된 프로젝트의 사업성 분석(S8)·실사(S9)·투심(S11)·포트폴리오(S12) 화면으로 이동합니다.
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)]">접근 가능한 프로젝트가 없습니다.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table" style={{ minWidth: "820px" }}>
            <caption className="sr-only">프로젝트 목록</caption>
            <thead>
              <tr>
                <th className="text-left">프로젝트 번호</th>
                <th className="text-left">프로젝트명</th>
                <th className="text-left">트랙</th>
                <th className="text-left">데이터 상태</th>
                <th className="text-left">원본 기회</th>
                <th className="col-num">생성일</th>
                <th className="text-left">바로가기</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.project_no}</td>
                  <td>{p.project_name ?? "—"}</td>
                  <td>
                    {p.track ? (
                      <span className={`status-chip ${p.track === "greenfield" ? "status-green" : "status-amber"}`}>
                        {TRACK_LABEL[p.track]}
                      </span>
                    ) : (
                      <span className="text-[color:var(--muted-fg)]">—</span>
                    )}
                  </td>
                  <td>
                    {p.is_stale ? (
                      <span className="status-chip status-amber" title={(p.stale_reasons ?? []).join(" · ") || "시장 데이터 최신성 확인 필요"}>◐ 갱신 필요</span>
                    ) : (
                      <span className="status-chip status-green" title="프로젝트 목록 기준 stale 신호 없음">✓ 최신</span>
                    )}
                  </td>
                  <td>
                    {p.source_opportunity_id ? (
                      <Link href={`/opportunities?id=${p.source_opportunity_id}`}>기회 보기</Link>
                    ) : (
                      <span className="text-[color:var(--muted-fg)]">—</span>
                    )}
                  </td>
                  <td className="col-num">{fmtDate(p.created_at)}</td>
                  <td>
                    <div className="flex gap-2 flex-wrap">
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/business-case`}>
                        사업성(S8)
                      </Link>
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/dd`}>
                        실사(S9)
                      </Link>
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/ic-review`}>
                        투심(S11)
                      </Link>
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/portfolio`}>
                        포트폴리오(S12)
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default ProjectsView;
