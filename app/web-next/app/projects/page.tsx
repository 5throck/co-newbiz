"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../../components/crud.tsx";
import { ClosureModal } from "../../components/ClosureModal.tsx";
import { ColGroup } from "../../components/ui.tsx";

// 프로젝트 목록 6열 — 사업 기회 열은 제거(2026-10-22 사용자 리포트: 프로젝트명 링크로
// 충분). 생성일은 날짜 한 줄 최소폭(7%, nowrap), 바로가기는 4개 단계 버튼 + 리드 전용
// 종료·삭제가 모두 한 줄에 나란히 놓이도록 가장 넓게 배분한다. 라벨은 스테이지명 기반
// (포트폴리오는 URL 슬러그이며 절차명 portfolio-venture-monitoring에서 흘러든 것 —
// 공식명은 사후 관리. 2026-10-22 명칭 확인).
const PROJECTS_COL_PCT = [11, 20, 8, 10, 7, 44] as const;

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
  is_lead?: boolean;
}

// i18n: track chips resolve through common.track.* catalog keys at render time.
const TRACK_KEY: Record<string, string> = { greenfield: "track.greenfield", brownfield: "track.brownfield" };

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function ProjectsView() {
  const t = useTranslations("pages.projectsList");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; name: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  function loadProjects() {
    api
      .get<ProjectRow[]>("/api/projects")
      .then((r) => setRows(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
  }

  useEffect(() => {
    loadProjects();
  }, []);

  function removeProject(p: ProjectRow) {
    confirm(
      t("deleteConfirmTitle", { name: p.project_name ?? p.project_no }),
      async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(p.id)}`);
          loadProjects();
        } catch (err) {
          setError(err instanceof Error ? err.message : t("deleteFailed"));
        }
      },
      {
        body: t("deleteConfirmBody"),
      },
    );
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
      {rows === null ? (
        <p>{tc("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)]">{t("empty")}</p>
      ) : (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-56">
            <caption className="sr-only">{t("caption")}</caption>
            <ColGroup widths={PROJECTS_COL_PCT} />
            <thead>
              <tr>
                <th className="text-left">{t("thNo")}</th>
                <th className="text-left">{t("thName")}</th>
                <th className="text-left">{tc("track")}</th>
                <th className="text-left">{t("thDataStatus")}</th>
                <th className="col-num">{t("thCreated")}</th>
                <th className="text-left">{t("thLinks")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.project_no}</td>
                  <td>
                    {p.project_name ? (
                      <Link href={`/projects/${p.id}`} className="text-[color:var(--accent)] font-semibold">{p.project_name}</Link>
                    ) : "—"}
                  </td>
                  <td>
                    {p.track ? (
                      <span className={`status-chip ${p.track === "greenfield" ? "status-green" : "status-amber"}`}>
                        {tc(TRACK_KEY[p.track])}
                      </span>
                    ) : (
                      <span className="text-[color:var(--muted-fg)]">—</span>
                    )}
                  </td>
                  <td>
                    {p.is_stale ? (
                      <span className="status-chip status-amber" title={(p.stale_reasons ?? []).join(" · ") || t("staleTitleFallback")}>{t("staleChip")}</span>
                    ) : (
                      <span className="status-chip status-green" title={t("freshTitle")}>{t("freshChip")}</span>
                    )}
                  </td>
                  <td className="col-num whitespace-nowrap px-1">{fmtDate(p.created_at)}</td>
                  <td>
                    {/* 바로가기 = 버튼 어휘(2026-10-22 사용자 2차 리포트 — 링크보다 버튼이
                        바람직). 4개 단계 바로가기는 whitespace-nowrap으로 한 줄을 보장하고,
                        종료·삭제도 같은 줄에 나란히 둔다(3차 리포트). */}
                    <div className="flex flex-nowrap gap-1.5 items-start">
                      <span className="flex gap-1.5 whitespace-nowrap">
                        <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/business-case`}>
                          {t("linkBusinessCase")}
                        </Link>
                        <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/dd`}>
                          {t("linkDd")}
                        </Link>
                        <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/ic-review`}>
                          {t("linkIcReview")}
                        </Link>
                        <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/portfolio`}>
                          {t("linkPortfolio")}
                        </Link>
                      </span>
                      {p.is_lead && (
                        <>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            title={t("closeBtnTitle")}
                            onClick={() => setClosing({ id: p.id, name: p.project_name ?? p.project_no })}
                          >
                            {t("closeBtn")}
                          </button>
                          <button
                            type="button"
                            className="btn-danger btn-sm"
                            title={t("deleteBtnTitle")}
                            onClick={() => removeProject(p)}
                          >
                            {tc("delete")}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {closing && (
        <ClosureModal
          entity="project"
          entityId={closing.id}
          entityName={closing.name}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            loadProjects();
          }}
        />
      )}
      {confirmDialog}
    </main>
  );
}

export default ProjectsView;
