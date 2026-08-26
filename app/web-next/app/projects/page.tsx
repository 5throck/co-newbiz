"use client";

// Port of app/web/src/pages/ProjectList.tsx — Link to= -> Link href=.
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, type ProjectSummary } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { GradeBadge } from "../../components/RagCard.tsx";
import { NotificationBell } from "../../components/NotificationBell.tsx";

export default function ProjectListPage() {
  const { me } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newProjectNo, setNewProjectNo] = useState("");

  async function load() {
    try {
      const res = await api.get<ProjectSummary[]>("/api/projects");
      setProjects(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로젝트 목록을 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newProjectNo.trim()) return;
    await api.post("/api/projects", { project_no: newProjectNo.trim() });
    setNewProjectNo("");
    await load();
  }

  return (
    <main className="project-list-page">
      <div className="project-list-header">
        <h1>프로젝트 목록</h1>
        <NotificationBell />
      </div>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {me?.role !== "viewer" && (
        <form onSubmit={onCreate} className="new-project-form">
          <label htmlFor="project_no">신규 프로젝트 번호</label>
          <input id="project_no" value={newProjectNo} onChange={(e) => setNewProjectNo(e.target.value)} placeholder="NP-2026-001" />
          <button type="submit">생성</button>
        </form>
      )}
      {projects === null ? (
        <p>불러오는 중...</p>
      ) : projects.length === 0 ? (
        <p>표시할 프로젝트가 없습니다. 멤버십이 부여된 프로젝트만 목록에 나타납니다.</p>
      ) : (
        <ul className="project-grid">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="project-card">
                <span className="project-no">{p.project_no}</span>
                {(p.rag_overall || p.stale) && (
                  <span className="card-badges">
                    {p.rag_overall && <GradeBadge grade={p.rag_overall} />}
                    {p.stale && (
                      <span className="grade-badge grade-amber">
                        <span aria-hidden="true">▲</span> 데이터 갱신 필요
                      </span>
                    )}
                  </span>
                )}
                <span className="project-created">{new Date(p.created_at).toLocaleDateString("ko-KR")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
