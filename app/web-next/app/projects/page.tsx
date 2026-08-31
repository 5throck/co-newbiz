"use client";

import { useEffect, useState, useMemo, type FormEvent } from "react";
import Link from "next/link";
import { api, type ProjectSummary } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageLights } from "../../components/StageLights.tsx";
import { NotificationBell } from "../../components/NotificationBell.tsx";

type RagFilter = "all" | "green" | "amber" | "red";
const PAGE_SIZE = 10;

export default function ProjectListPage() {
  const { me } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newProjectNo, setNewProjectNo] = useState("");
  const [newProjectCompany, setNewProjectCompany] = useState("");
  const [ragFilter, setRagFilter] = useState<RagFilter>("all");
  const [page, setPage] = useState(1);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    api
      .get<ProjectSummary[]>("/api/projects")
      .then((res) => setProjects(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  const filteredProjects = useMemo(() => {
    if (projects === null) return [];
    return projects.filter((p) => {
      if (ragFilter !== "all" && p.rag_overall !== ragFilter) return false;
      return true;
    });
  }, [projects, ragFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredProjects.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const stats = useMemo(() => {
    if (projects === null) return { green: 0, amber: 0, red: 0, stale: 0 };
    return {
      green: projects.filter((p) => p.rag_overall === "green").length,
      amber: projects.filter((p) => p.rag_overall === "amber").length,
      red: projects.filter((p) => p.rag_overall === "red").length,
      stale: projects.filter((p) => p.is_stale).length,
    };
  }, [projects]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ id: string }>("/api/projects", { project_no: newProjectNo, company_name: newProjectCompany });
      setNewProjectNo("");
      const created = await api.get<ProjectSummary[]>(`/api/projects`);
      setProjects(created.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    }
  }

  async function handleDelete(id: string, no: string) {
    if (!window.confirm(`${no} 프로젝트를 삭제할까요? 감사로그에 기록됩니다.`)) return;
    setError(null);
    try {
      await api.delete(`/api/projects/${id}`);
      setProjects((prev) => prev ? prev.filter((p) => p.id !== id) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  async function handleArchive(id: string, no: string) {
    if (!window.confirm(`${no} 프로젝트를 보관할까요? 보관된 프로젝트는 목록에서 숨겨집니다.`)) return;
    setError(null);
    try {
      await api.put(`/api/projects/${id}`, { archived: true });
      setProjects(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "보관 실패");
    }
  }

  async function handleRename(id: string, currentNo: string) {
    setError(null);
    if (!renameValue.trim() || renameValue === currentNo) { setRenamingId(null); return; }
    try {
      await api.put(`/api/projects/${id}`, { project_no: renameValue.trim() });
      setRenamingId(null);
      setProjects(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이름 변경 실패");
    }
  }

  return (
    <main>
      <h1>프로젝트 목록</h1>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>
      )}

      {me?.role !== "viewer" && (
        <form onSubmit={onCreate} className="new-project-form glass">
          <label htmlFor="project_no">신규 프로젝트</label>
          <input
            id="project_no"
            value={newProjectNo}
            onChange={(e) => setNewProjectNo(e.target.value)}
            placeholder="NP-2026-001"
          />
          <input
            aria-label="대상 회사명"
            value={newProjectCompany}
            onChange={(e) => setNewProjectCompany(e.target.value)}
            placeholder="대상 회사명 (필수)"
          />
          <button type="submit" className="btn-premium">생성</button>
        </form>
      )}

      {/* RAG filter as clickable column header */}
      {projects === null ? (
        <p>불러오는 중...</p>
      ) : filteredProjects.length === 0 ? (
        <p>표시할 프로젝트가 없습니다.</p>
      ) : (
        <>
          <table className="data-table" aria-label="프로젝트 목록">
            <caption className="sr-only">프로젝트 목록 및 진척 현황</caption>
            <thead>
              <tr>
                <th scope="col">프로젝트</th>
                <th scope="col">
                  <button
                    type="button"
                    className="rag-col-filter"
                    onClick={() => {
                      const order: RagFilter[] = ["all", "green", "amber", "red"];
                      const next = order[(order.indexOf(ragFilter) + 1) % order.length];
                      setRagFilter(next);
                      setPage(1);
                    }}
                    title="클릭하여 필터 전환 (전체→Green→Amber→Red)"
                  >
                    RAG {ragFilter !== "all" ? `(${ragFilter.toUpperCase()})` : "전체"}
                    <span aria-hidden="true"> ▾</span>
                  </button>
                </th>
                <th scope="col">진척 현황</th>
                <th scope="col">생성일</th>
                <th scope="col">액션</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
                <tr key={p.id}>
                  <td className="cell-primary">
                    {renamingId === p.id ? (
                      <span className="flex gap-1 items-center">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="text-[0.8rem] px-1 py-0.5"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") handleRename(p.id, p.project_no); if (e.key === "Escape") setRenamingId(null); }}
                        />
                        <button type="button" className="btn-ghost text-[0.75rem]" onClick={() => handleRename(p.id, p.project_no)}>저장</button>
                        <button type="button" className="btn-ghost text-[0.75rem]" onClick={() => setRenamingId(null)}>취소</button>
                      </span>
                    ) : (
                      <Link href={`/projects/${p.id}`} className="text-[color:var(--accent)] underline font-semibold">
                        {p.project_no}
                      </Link>
                    )}
                  </td>
                  <td>
                    {p.rag_overall ? (
                      <span className={`status-chip ${p.rag_overall === "green" ? "status-green" : p.rag_overall === "amber" ? "status-amber" : "status-red"}`}>
                        {p.rag_overall.toUpperCase()}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    {p.stage_summary ? (
                      <StageLights stages={p.stage_summary.stages} routeDecided={p.stage_summary.routeDecided} />
                    ) : <span className="text-[color:var(--muted-fg)]">—</span>}
                  </td>
                  <td>{new Date(p.created_at).toLocaleDateString("ko-KR")}</td>
                  <td>
                    {me?.role !== "viewer" ? (
                      <div className="flex gap-1 items-center">
                        <button
                          type="button"
                          className="btn-ghost text-[0.72rem]"
                          onClick={() => { setRenamingId(p.id); setRenameValue(p.project_no); }}
                        >
                          이름 변경
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-[0.72rem]"
                          onClick={() => handleArchive(p.id, p.project_no)}
                        >
                          보관
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-[0.72rem] text-[color:var(--red-fg)]"
                          onClick={() => handleDelete(p.id, p.project_no)}
                        >
                          삭제
                        </button>
                      </div>
                    ) : (
                      <Link href={`/projects/${p.id}`} className="text-[color:var(--accent)] underline text-[0.8rem]">열기</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination" aria-label="페이지 이동">
              <button type="button" className="btn-ghost" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                ← 이전
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`pagination-page ${n === safePage ? "pagination-page-active" : ""}`}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}
              <button type="button" className="btn-ghost" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                다음 →
              </button>
              <span className="text-[color:var(--muted-fg)] text-[0.75rem] ml-2">
                {filteredProjects.length}건 중 {(safePage - 1) * PAGE_SIZE + 1}~{Math.min(safePage * PAGE_SIZE, filteredProjects.length)}건
              </span>
            </div>
          )}
        </>
      )}
    </main>
  );
}
