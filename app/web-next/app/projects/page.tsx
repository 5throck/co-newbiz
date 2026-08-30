"use client";

import { useEffect, useState, useMemo, type FormEvent } from "react";
import Link from "next/link";
import { api, type ProjectSummary } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { GradeBadge } from "../../components/RagCard.tsx";
import { GateProgress } from "../../components/GateProgress.tsx";
import { StageLights } from "../../components/StageLights.tsx";
import { NotificationBell } from "../../components/NotificationBell.tsx";

type FilterType = "all" | "gf" | "bf";
type RagFilter = "all" | "green" | "amber" | "red";

export default function ProjectListPage() {
  const { me } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newProjectNo, setNewProjectNo] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [ragFilter, setRagFilter] = useState<RagFilter>("all");

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

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => {
      if (ragFilter !== "all" && p.rag_overall !== ragFilter) return false;
      return true;
    });
  }, [projects, ragFilter]);

  const stats = useMemo(() => {
    if (!projects) return { total: 0, green: 0, amber: 0, red: 0, stale: 0 };
    return {
      total: projects.length,
      green: projects.filter((p) => p.rag_overall === "green").length,
      amber: projects.filter((p) => p.rag_overall === "amber").length,
      red: projects.filter((p) => p.rag_overall === "red").length,
      stale: projects.filter((p) => p.is_stale).length,
    };
  }, [projects]);

  return (
    <main className="project-list-page">
      <div className="project-list-header">
        <h1>프로젝트 목록</h1>
        <NotificationBell />
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card glass">
          <span className="summary-value mono-num">{stats.total}</span>
          <span className="text-label">전체 프로젝트</span>
        </div>
        <div className="summary-card glass" style={{ borderColor: "var(--green-border)" }}>
          <span className="summary-value mono-num" style={{ color: "var(--green-fg)" }}>{stats.green}</span>
          <span className="text-label">Green</span>
        </div>
        <div className="summary-card glass" style={{ borderColor: "var(--amber-border)" }}>
          <span className="summary-value mono-num" style={{ color: "var(--amber-fg)" }}>{stats.amber}</span>
          <span className="text-label">Amber</span>
        </div>
        <div className="summary-card glass" style={{ borderColor: "var(--red-border)" }}>
          <span className="summary-value mono-num" style={{ color: "var(--red-fg)" }}>{stats.red}</span>
          <span className="text-label">Red</span>
        </div>
        {stats.stale > 0 && (
          <div className="summary-card glass" style={{ borderColor: "var(--amber-border)" }}>
            <span className="summary-value mono-num" style={{ color: "var(--amber-fg)" }}>{stats.stale}</span>
            <span className="text-label">갱신 필요</span>
          </div>
        )}
      </div>

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
          <button type="submit" className="btn-premium">생성</button>
        </form>
      )}

      {/* Filters */}
      <div className="filter-bar glass">
        <div className="filter-group">
          <span className="text-label">RAG 등급:</span>
          {(["all", "green", "amber", "red"] as RagFilter[]).map((f) => (
            <button
              key={f}
              className={`btn-ghost ${ragFilter === f ? "active" : ""}`}
              onClick={() => setRagFilter(f)}
            >
              {f === "all" ? "전체" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {projects === null ? (
        <p>불러오는 중...</p>
      ) : filteredProjects.length === 0 ? (
        <p>표시할 프로젝트가 없습니다.</p>
      ) : (
        <div className="project-grid">
          {filteredProjects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="project-card glass">
              <div className="project-card-header">
                <span className="project-no">{p.project_no}</span>
                {p.rag_overall && <GradeBadge grade={p.rag_overall} />}
                {p.is_stale && (
                  <span className="grade-badge grade-amber">
                    <span aria-hidden="true">▲</span> 갱신 필요
                  </span>
                )}
              </div>
              <GateProgress currentStage={p.gate_stage} />
              {p.stage_summary && (
                <StageLights stages={p.stage_summary.stages} routeDecided={p.stage_summary.routeDecided} />
              )}
              <span className="project-created">
                {new Date(p.created_at).toLocaleDateString("ko-KR")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
