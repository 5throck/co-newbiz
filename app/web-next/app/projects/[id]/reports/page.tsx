"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("pages.projects.reports");
  const tc = useTranslations("common");
  const { id: projectId } = useParams<{ id: string }>();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<ReportsView | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState(() => t("defaultTitle"));
  const [content, setContent] = useState(() => t("defaultContent"));
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
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
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
      setMessage(t("snapshotLoaded", { meta: `${s.data.created_at.slice(0, 16).replace("T", " ")} · ${s.data.created_by}` }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("snapshotLoadFailed"));
    }
  }

  // 보관(소프트 삭제) — 이력 목록에서 숨겨지고 감사는 유지된다. 보관본 보기 토글로 다시 볼 수 있다.
  function archive(r: ReportRow) {
    confirm(t("archiveConfirmTitle"), () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(r.id)}`);
          setMessage(t("archivedMsg", { title: r.title }));
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : t("archiveFailed"));
        }
      })();
    }, { body: t("archiveConfirmBody", { title: r.title }), confirmLabel: t("archiveLabel") });
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
      setMessage(t("composeDone", { sections: r.data.sections.join(" · ") }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("composeFailed"));
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
      setMessage(t("savedMsg", { rendered: formats.length > 0 ? t("savedRendered", { formats: formats.join(", ") }) : "" }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <main className="market-page"><StageTabs projectId={projectId} /><StageFrame stageId="S11" heading={t("stageHeading")}>
    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">{t("intro")}</p>

    {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
    {message && <p className="text-[length:var(--fs-caption)] text-[color:var(--accent)] mb-2">{message}</p>}

    {canAct && <section className="market-section sizing-step">
      <h3 className="sizing-step-title">{t("newSnapshotTitle")}</h3>
      <div className="flex gap-2 items-center flex-wrap mt-1">
        <button type="button" className="btn-ghost btn-sm" disabled={composing || busy} onClick={() => void compose()}>
          {composing ? t("composeBusy") : t("composeBtn")}
        </button>
        <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("composeHint")}</span>
      </div>
      <label className="grid gap-1 mt-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblTitle")}
        <input className="sizing-new-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("titleAria")} />
      </label>
      <div className="flex gap-3 items-center text-[length:var(--fs-body)] mt-3 flex-wrap">
        <span className="text-[color:var(--muted-fg)]">{t("renderFormat")}</span>
        {ALL_FORMATS.map((f) => (
          <label key={f} className="inline-flex gap-1 items-center">
            <input type="checkbox" checked={formats.includes(f)} onChange={() => toggleFormat(f)} />
            {f}
          </label>
        ))}
        <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("renderFormatNote")}</span>
      </div>
      <label className="grid gap-1 mt-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblBody")}
        <textarea className="sizing-new-input w-full font-mono text-[length:var(--fs-caption)]" rows={14} value={content} onChange={(e) => setContent(e.target.value)} aria-label={t("bodyAria")} spellCheck={false} />
      </label>
      <div className="flex gap-2 mt-2 flex-wrap">
        <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? tc("saving") : t("saveBtn")}</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setPreviewOpen((v) => !v)} aria-expanded={previewOpen}>{previewOpen ? t("previewToggleOpen") : t("previewToggle")}</button>
        <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] self-center">{t("editNote")}{editingFrom ? t("editingFromNote", { id: `${editingFrom.slice(0, 8)}…` }) : ""}</span>
      </div>
      {previewOpen && (
        <div className="market-section mt-2" aria-label={t("previewToggle")} data-testid="report-preview">
          <h4 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("previewHeading", { title })}</h4>
          <div className="report-preview prose-lite" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          <p className="note" style={{ marginBottom: 0 }}>{t("previewNote")}</p>
        </div>
      )}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2"><b>{t("draftNatureLabel")}</b> — {t("draftNatureBody1")}<b>{t("draftNatureBody2")}</b>{t("draftNatureBody3")}</p>
    </section>}

    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">{t("historyTitle")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("historySubtitle")}</span></h3>
      {canAct && (
        <label className="flex items-center gap-1 text-[length:var(--fs-caption)] mb-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t("showArchivedLabel")}
        </label>
      )}
      {!view ? <p>{tc("loading")}</p> : view.reports.length === 0 ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{showArchived ? t("emptyArchived") : t("emptyLead")}<b>{t("emptyBold")}</b>{showArchived ? "" : t("emptyTail")}</p>
      ) : (
        <table className="data-table">
          <caption className="sr-only">{t("historyCaption")}</caption>
          <thead><tr><th scope="col">{t("thTitle")}</th><th scope="col">{t("thCreated")}</th><th scope="col">{t("thRenders")}</th><th scope="col">{tc("status")}</th><th scope="col">{t("thManage")}</th></tr></thead>
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
                    ? <span className="status-chip status-gray" title={t("archivedTitle", { date: r.archived_at.slice(0, 10) })}>{t("archivedChip")}</span>
                    : renders.length > 0 ? <span className="status-chip status-green">{t("renderedChip")}</span> : <span className="status-chip status-not-started">{t("bodyOnlyChip")}</span>}</td>
                  <td>
                    <button type="button" className="btn-ghost btn-sm mr-1" onClick={() => void openSnapshot(r)} title={t("openBodyTitle")}>{t("openBodyBtn")}</button>
                    {canAct && !r.archived_at && (
                      <button type="button" className="btn-danger btn-sm" onClick={() => archive(r)} title={t("archiveBtnTitle")}>{t("archiveLabel")}</button>
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
