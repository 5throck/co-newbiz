"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";
import { useConfirm } from "../../../../components/crud.tsx";
import { markdownToHtml } from "../../../../lib/markdown-preview.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 보고서 탭 — 스냅샷 · 렌더러 (ADR-0116 Phase 6; approved mockup
// docs/designs/mockups/2026-09-11-reports-composer-ui-mockup_ko.html).
// 투자심의 자료로 초안을 만들고, 포맷(docx/pdf/hwpx)을 지정해 저장·렌더링,
// 이력에서 다운로드한다. 스냅샷은 불변 이력이며 초안 생성은 어디까지나 제안.
// 2026-10-21: 이력에서 본문을 열어 편집을 재개하고(저장은 새 스냅샷), 잘못 만든
// 스냅샷은 보관(소프트 삭제 — archived_at, 감사 유지)하며, 저장 전 미리보기를
// 볼 수 있다.

interface RenderRow { snapshot_id: string; format: string; created_at: string }
interface ReportRow { id: string; title: string; content_md: string; created_by: string; created_at: string; archived_at: string | null }
interface ReportsView { reports: ReportRow[]; renders: RenderRow[] }
type Format = "docx" | "pdf" | "hwpx";
const ALL_FORMATS: Format[] = ["docx", "pdf", "hwpx"];

export default function ReportsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<ReportsView | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState("투자 검토 보고서");
  const [content, setContent] = useState("# 투자 검토 보고서\n\n## 요약\n\n");
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [formats, setFormats] = useState<Format[]>(["docx", "pdf"]);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<ReportsView>(`/api/projects/${encodeURIComponent(projectId)}/reports${showArchived ? "?archived=1" : ""}`)
      .then((r) => setView(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "보고서 이력을 불러오지 못했습니다."));
  }, [projectId, showArchived]);
  useEffect(() => { load(); }, [load]);

  const previewHtml = useMemo(() => markdownToHtml(content), [content]);

  // 이력 → 편집 재개: 스냅샷 본문을 편집기에 적재한다. 저장은 항상 새 스냅샷(불변 이력 유지).
  async function openSnapshot(r: ReportRow) {
    setError(null); setMessage(null);
    try {
      const s = await api.get<ReportRow>(`/api/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(r.id)}`);
      setTitle(s.data.title);
      setContent(s.data.content_md);
      setEditingFrom(s.data.id);
      setMessage(`스냅샷을 편집기에 불러왔습니다 (${s.data.created_at.slice(0, 16).replace("T", " ")} · ${s.data.created_by}) — 저장하면 새 스냅샷으로 남습니다.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "스냅샷을 불러오지 못했습니다.");
    }
  }

  // 보관(소프트 삭제) — 이력 목록에서 숨겨지고 감사는 유지된다. 보관본 보기 토글로 다시 볼 수 있다.
  function archive(r: ReportRow) {
    confirm("보고서 보관", () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(r.id)}`);
          setMessage(`"${r.title}" 스냅샷을 보관했습니다 — 보관본 보기로 다시 볼 수 있습니다.`);
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "보관에 실패했습니다.");
        }
      })();
    }, { body: `"${r.title}" 스냅샷을 이력 목록에서 보관합니다. 행과 렌더 파일은 감사를 위해 유지되며 보관본 보기로 다시 볼 수 있습니다.`, confirmLabel: "보관" });
  }

  async function compose() {
    if (composing) return;
    setComposing(true); setError(null); setMessage(null);
    try {
      const r = await api.post<{ title: string; content_md: string; sections: string[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/reports/compose`, {},
      );
      setTitle(r.data.title);
      setContent(r.data.content_md);
      setMessage(`투자심의 자료 초안 생성 완료 — 섹션: ${r.data.sections.join(" · ")}. 검토·수정 후 저장하세요.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "초안 생성에 실패했습니다.");
    } finally {
      setComposing(false);
    }
  }

  function toggleFormat(f: Format) {
    setFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function save() {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/reports`, {
        title: title.trim(),
        content_md: content,
        formats,
      });
      setMessage(`스냅샷 저장 완료${formats.length > 0 ? ` — 렌더링: ${formats.join(", ")}` : ""}.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "스냅샷 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="market-page"><StageTabs projectId={projectId} /><StageFrame stageId="S11" heading="보고서 — 스냅샷 · 렌더러">
    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">프로젝트 데이터에서 보고서 초안을 만들고, 문서 파일(docx/pdf/hwpx)로 내려받을 수 있습니다.</p>

    {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
    {message && <p className="text-[length:var(--fs-caption)] text-[color:var(--accent)] mb-2">{message}</p>}

    {canAct && <section className="market-section sizing-step">
      <h3 className="sizing-step-title">새 보고서 스냅샷</h3>
      <div className="flex gap-2 items-center flex-wrap mt-1">
        <button type="button" className="btn-ghost btn-sm" disabled={composing || busy} onClick={() => void compose()}>
          {composing ? "초안 생성 중..." : "🧾 투자심의 자료로 초안 생성"}
        </button>
        <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">채택된 사업 케이스(NPV/IRR) · DD 완료 요약 · RAG 제안 · 진행 이력 · 이중 관점 비교를 자동 구성합니다</span>
      </div>
      <label className="grid gap-1 mt-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">제목
        <input className="sizing-new-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="보고서 제목" />
      </label>
      <div className="flex gap-3 items-center text-[length:var(--fs-body)] mt-3 flex-wrap">
        <span className="text-[color:var(--muted-fg)]">렌더 포맷:</span>
        {ALL_FORMATS.map((f) => (
          <label key={f} className="inline-flex gap-1 items-center">
            <input type="checkbox" checked={formats.includes(f)} onChange={() => toggleFormat(f)} />
            {f}
          </label>
        ))}
        <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">(저장 시 선택한 포맷으로 렌더링 — 용어집 부록 자동 첨부)</span>
      </div>
      <label className="grid gap-1 mt-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">본문 (Markdown)
        <textarea className="sizing-new-input w-full font-mono text-[length:var(--fs-caption)]" rows={14} value={content} onChange={(e) => setContent(e.target.value)} aria-label="보고서 Markdown" spellCheck={false} />
      </label>
      <div className="flex gap-2 mt-2 flex-wrap">
        <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? "저장 중..." : "스냅샷 저장 + 렌더링"}</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setPreviewOpen((v) => !v)} aria-expanded={previewOpen}>{previewOpen ? "미리보기 닫기" : "미리보기"}</button>
        <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] self-center">본문은 저장 후 자유롭게 수정한 뒤 다시 저장(새 스냅샷)할 수 있습니다{editingFrom ? ` — 불러온 스냅샷(${editingFrom.slice(0, 8)}…)에서 편집 중` : ""}</span>
      </div>
      {previewOpen && (
        <div className="market-section mt-2" aria-label="미리보기" data-testid="report-preview">
          <h4 className="text-[length:var(--fs-caption)] font-semibold mb-1">미리보기 — 제목: {title}</h4>
          <div className="report-preview prose-lite" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          <p className="note" style={{ marginBottom: 0 }}>경량 렌더(제목·목록·강조·인용·수평선) — 실제 문서 서식은 렌더 파일 기준입니다.</p>
        </div>
      )}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2"><b>초안 생성의 성격</b> — 자동 구성은 <b>초안</b>이며, 의사결정·승인 문구는 사람이 검토·수정해야 합니다. 저장 스냅샷은 불변 이력으로 남습니다.</p>
    </section>}

    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">보고서 이력 <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">— 최신순 · 렌더 파일 다운로드 · 본문 열기 · 보관</span></h3>
      {canAct && (
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)] mb-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          보관본 보기 (archived)
        </label>
      )}
      {!view ? <p>불러오는 중...</p> : view.reports.length === 0 ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{showArchived ? "보관된 스냅샷이 없습니다." : "저장된 보고서가 없습니다 — 위에서 "}<b>투자심의 자료로 초안 생성</b>{showArchived ? "" : " 후 스냅샷을 저장하세요."}</p>
      ) : (
        <table className="data-table">
          <caption className="sr-only">보고서 스냅샷 이력</caption>
          <thead><tr><th scope="col">제목</th><th scope="col">생성</th><th scope="col">렌더 파일</th><th scope="col">상태</th><th scope="col">관리</th></tr></thead>
          <tbody>
            {view.reports.map((r) => {
              const renders = (view.renders ?? []).filter((x) => x.snapshot_id === r.id);
              return (
                <tr key={r.id}>
                  <td><b>{r.title}</b><div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{r.created_at.slice(0, 10)} · {r.created_by}</div></td>
                  <td className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{r.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    {renders.length === 0
                      ? <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">—</span>
                      : renders.map((x) => (
                        <a key={x.format} className="text-[color:var(--accent)] font-bold text-[length:var(--fs-caption)] mr-2" href={`/api/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(r.id)}/render/${x.format}`}>
                          snapshot.{x.format}
                        </a>
                      ))}
                  </td>
                  <td>{r.archived_at
                    ? <span className="status-chip status-gray" title={`보관일 ${r.archived_at.slice(0, 10)}`}>보관됨</span>
                    : renders.length > 0 ? <span className="status-chip status-green">렌더 완료</span> : <span className="status-chip status-not-started">본문만</span>}</td>
                  <td>
                    <button type="button" className="btn-ghost btn-sm mr-1" onClick={() => void openSnapshot(r)} title="스냅샷 본문을 편집기에 불러옵니다 — 저장은 새 스냅샷으로">본문 열기</button>
                    {canAct && !r.archived_at && (
                      <button type="button" className="btn-danger btn-sm" onClick={() => archive(r)} title="이력 목록에서 보관합니다(소프트 삭제 — 감사 유지)">보관</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
    {confirmDialog}
  </StageFrame></main>;
}
