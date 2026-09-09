"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";

interface ReportRow { id: string; title: string; content_md: string; created_by: string; created_at: string }
interface View { reports: ReportRow[] }

export default function ReportsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const [view, setView] = useState<View | null>(null);
  const [title, setTitle] = useState("투자 검토 보고서");
  const [content, setContent] = useState("# 투자 검토 보고서\n\n## Executive summary\n\n");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/reports`).then((r) => setView(r.data)).catch((e) => setError(e instanceof Error ? e.message : "보고서 이력을 불러오지 못했습니다.")); }, [projectId]);
  useEffect(() => { load(); }, [load]);
  async function createSnapshot() { setBusy(true); setError(null); try { await api.post(`/api/projects/${encodeURIComponent(projectId)}/reports`, { title, content_md: content }); load(); } catch (e) { setError(e instanceof Error ? e.message : "보고서 생성 실패"); } finally { setBusy(false); } }
  return <main className="market-page"><ProjectSubNav projectId={projectId} /><StageFrame stageId="S11" heading="보고서 — 스냅샷 이력 · 렌더러 연결">
    {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">✕ {error}</p>}
    {canAct && <section className="market-section sizing-step"><h3 className="sizing-step-title">새 보고서 스냅샷</h3><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="보고서 제목" /><textarea className="input mt-2" rows={8} value={content} onChange={(e) => setContent(e.target.value)} aria-label="보고서 Markdown" /><button className="btn-ghost btn-sm mt-2" disabled={busy} onClick={() => void createSnapshot()}>{busy ? "저장 중..." : "스냅샷 저장"}</button><p className="text-[0.75rem] text-[color:var(--muted-fg)] mt-1">API는 formats(docx/pdf/hwpx) 지정 시 python/report 렌더러를 호출합니다.</p></section>}
    <section className="market-section sizing-step mt-3"><h3 className="sizing-step-title">보고서 이력</h3>{!view ? <p>불러오는 중...</p> : view.reports.length === 0 ? <p className="text-[color:var(--muted-fg)]">저장된 보고서가 없습니다.</p> : <div className="grid gap-2">{view.reports.map((r) => <details key={r.id} className="chart-half" open={false}><summary><strong>{r.title}</strong> <span className="text-[color:var(--muted-fg)]">{r.created_at.slice(0,10)} · {r.created_by}</span></summary><pre className="whitespace-pre-wrap text-[0.78rem] mt-2">{r.content_md}</pre></details>)}</div>}</section>
  </StageFrame></main>;
}