"use client";

// 아카이브 (/projects/archives) — 보관(마감/보관 상태) 프로젝트와 삭제 표시된
// 검토/안건을 한 화면에서 열람한다. 삭제는 물리 삭제가 아니라 deletion mark이므로
// 원본 데이터는 전부 보존되어 있고, 이 화면이 그 자료의 열람 입구다
// (deal-deletion-playbook). 열람 권한은 당시 프로젝트 멤버 기준이며
// 서버가 매열람을 감사 기록한다.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CLOSURE_TYPE_KEY } from "../../../lib/label-keys.ts";
import { api } from "../../../lib/api.ts";
import { useConfirm } from "../../../components/crud.tsx";

import { ColGroup } from "../../../components/ui.tsx";

// 보관 프로젝트 7열 — 번호·종료일·상태는 좁게, 프로젝트명·사유·바로가기에 넉넉한 몫.
const ARCHIVE_COL_PCT = [13, 22, 12, 11, 13, 17, 12] as const;

interface ArchiveProjectRow {
  id: string;
  project_no: string;
  project_name?: string | null;
  status: "open" | "closed" | "archived";
  closed_at?: string | null;
  closure_reason?: string | null;
  closure_type?: string | null;
  is_lead?: boolean;
}

interface DeletedDealRow {
  id: string;
  entity_type: "project" | "opportunity";
  project_id: string | null;
  opportunity_id: string | null;
  project_no: string | null;
  project_name: string | null;
  track: string | null;
  status_at_archive: string | null;
  acted_by: string;
  acted_at: string;
  reason: string | null;
  mnpi_flag: number;
}

interface ArchiveDetail extends DeletedDealRow {
  market_freeze: Array<{ industryId: string; analysisId: string | null; versionId: string | null; versionNo: number | null }> | null;
}

// i18n: status chips resolve through pages.projectsArchives.status* keys at render time.
const STATUS_KEY: Record<string, string> = { open: "statusOpen", closed: "statusClosed", archived: "statusArchived" };

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function ProjectArchivesView() {
  const tr = useTranslations();
  const t = useTranslations("pages.projectsArchives");
  const tc = useTranslations("common");
  const [archived, setArchived] = useState<ArchiveProjectRow[] | null>(null);
  const [deleted, setDeleted] = useState<DeletedDealRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, ArchiveDetail>>({});
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    api
      .get<ArchiveProjectRow[]>("/api/projects?status=all")
      .then((r) => setArchived(r.data.filter((p) => p.status !== "open")))
      .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    api
      .get<DeletedDealRow[]>("/api/archive/deals")
      .then((r) => setDeleted(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : t("deletedLoadFailed")));
  }

  useEffect(() => {
    load();
  }, []);

  function removeProject(p: ArchiveProjectRow) {
    confirm(
      t("deleteConfirmTitle", { name: p.project_name ?? p.project_no }),
      async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(p.id)}`);
          load();
        } catch (err) {
          setError(err instanceof Error ? err.message : t("deleteFailed"));
        }
      },
      {
        body: t("deleteConfirmBody"),
      },
    );
  }

  async function openDetail(id: string) {
    if (detail[id]) return;
    try {
      const r = await api.get<ArchiveDetail>(`/api/archive/deals/${encodeURIComponent(id)}`);
      setDetail((prev) => ({ ...prev, [id]: r.data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("detailFailed"));
    }
  }

  return (
    <main>
      <h1>{t("heading")}</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("intro")}
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      <section aria-label={t("archivedHeading")} className="market-section">
        <h2 className="text-[length:var(--fs-body)] font-semibold mb-2">{t("archivedHeading")}</h2>
        {archived === null ? (
          <p>{tc("loading")}</p>
        ) : archived.length === 0 ? (
          <p className="text-[color:var(--muted-fg)]">{t("emptyArchived")}</p>
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48">
              <caption className="sr-only">{t("archivedCaption")}</caption>
              <ColGroup widths={ARCHIVE_COL_PCT} />
              <thead>
                <tr>
                  <th className="text-left">{t("thNo")}</th>
                  <th className="text-left">{t("thName")}</th>
                  <th className="text-left">{tc("status")}</th>
                  <th className="text-left">{t("thClosed")}</th>
                  <th className="text-left">{t("thClosureType")}</th>
                  <th className="text-left">{t("thReason")}</th>
                  <th className="text-left">{t("thLinks")}</th>
                </tr>
              </thead>
              <tbody>
                {archived.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold">{p.project_no}</td>
                    <td>{p.project_name ?? "—"}</td>
                    <td>
                      <span className={`status-chip ${p.status === "closed" ? "status-amber" : "status-not-started"}`}>
                        {t(STATUS_KEY[p.status])}
                      </span>
                    </td>
                    <td>{fmtDate(p.closed_at ?? null)}</td>
                    <td>{p.closure_type ? tr(CLOSURE_TYPE_KEY[p.closure_type] ?? p.closure_type) : "—"}</td>
                    <td>{p.closure_reason ?? "—"}</td>
                    <td>
                      <div className="flex gap-2 flex-wrap">
                        <Link className="btn-ghost btn-sm" href={`/projects/${p.id}`}>
                          {t("overviewLink")}
                        </Link>
                        {p.is_lead && (
                          <button type="button" className="btn-danger btn-sm" title={t("deleteBtnTitle")} onClick={() => removeProject(p)}>
                            {tc("delete")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label={t("deletedHeading")} className="market-section">
        <h2 className="text-[length:var(--fs-body)] font-semibold mb-2">{t("deletedHeading")}</h2>
        {deleted === null ? (
          <p>{tc("loading")}</p>
        ) : deleted.length === 0 ? (
          <p className="text-[color:var(--muted-fg)]">{t("emptyDeleted")}</p>
        ) : (
          <ul className="space-y-2">
            {deleted.map((d) => (
              <li key={d.id} className="border border-[color:var(--border)] rounded p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="font-semibold mr-2">{d.project_name ?? d.project_no ?? d.id}</span>
                    {d.project_no && <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mr-2">{d.project_no}</span>}
                    <span className="status-chip status-red">{t("deletedChip")}</span>
                  </div>
                  <div className="flex gap-2">
                    {d.project_id && (
                      <Link className="btn-ghost btn-sm" href={`/projects/${d.project_id}`}>
                        {t("viewOriginal")}
                      </Link>
                    )}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => void openDetail(d.id)}>
                      {t("detailBtn")}
                    </button>
                  </div>
                </div>
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
                  {t("deletedBy", { by: d.acted_by, date: fmtDate(d.acted_at) })}
                  {d.status_at_archive ? t("statusAtArchive", { status: STATUS_KEY[d.status_at_archive] ? t(STATUS_KEY[d.status_at_archive]) : d.status_at_archive }) : ""}
                  {d.reason ? t("reasonLine", { reason: d.reason }) : ""}
                </p>
                {detail[d.id] && (
                  <div className="text-[length:var(--fs-caption)] mt-2">
                    <p className="mb-1">{t("freezeTitle")}</p>
                    <ul className="list-disc pl-5">
                      {(detail[d.id].market_freeze ?? []).map((f, i) => (
                        <li key={i}>
                          {t("freezeLine", { industry: f.industryId, analysis: f.analysisId ?? t("noAnalysis"), version: f.versionNo ?? "—" })}
                        </li>
                      ))}
                      {(detail[d.id].market_freeze ?? []).length === 0 && <li>{t("noMarketFreeze")}</li>}
                    </ul>
                    <p className="text-[color:var(--muted-fg)] mt-1">{t("auditNote")}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {confirmDialog}
    </main>
  );
}

export default ProjectArchivesView;
