"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api.ts";
import { dealStageHref } from "../../lib/deal-links.ts";
import { useConfirm } from "../../components/crud.tsx";
import { ClosureModal } from "../../components/ClosureModal.tsx";
import { ColGroup } from "../../components/ui.tsx";

// 프로젝트 목록 7열 — 생성일은 날짜 1줄이면 충분해 좁히고, 그 몫을 바로가기로
// (2026-10-22 사용자 리포트: 생성일 11%는 과대, 바로가기 11%는 세로 적층 유발).
const PROJECTS_COL_PCT = [13, 22, 10, 12, 21, 8, 14] as const;

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

const TRACK_LABEL: Record<string, string> = { greenfield: "그린필드", brownfield: "브라운필드" };

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function ProjectsView() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; name: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  function loadProjects() {
    api
      .get<ProjectRow[]>("/api/projects")
      .then((r) => setRows(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }

  useEffect(() => {
    loadProjects();
  }, []);

  function removeProject(p: ProjectRow) {
    confirm(
      `${p.project_name ?? p.project_no} 삭제`,
      async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(p.id)}`);
          loadProjects();
        } catch (err) {
          setError(err instanceof Error ? err.message : "프로젝트 삭제 실패");
        }
      },
      {
        body: "삭제 표시로 전환됩니다. 연결 기회(진출방식 결정·대상 선정·시너지 포함)가 함께 삭제 표시되고, 데이터는 보존되어 아카이브에서 감사용으로 열람할 수 있습니다.",
      },
    );
  }

  return (
    <main>
      <h1>프로젝트</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        추진된 프로젝트의 사업성 분석(S8)·실사(S9)·투심(S11)·포트폴리오(S12) 화면으로 이동합니다.
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
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-56">
            <caption className="sr-only">프로젝트 목록</caption>
            <ColGroup widths={PROJECTS_COL_PCT} />
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
                  <td>
                    {p.project_name ? (
                      <Link href={`/projects/${p.id}`} className="text-[color:var(--accent)] font-semibold">{p.project_name}</Link>
                    ) : "—"}
                  </td>
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
                      <Link href={dealStageHref(p.source_opportunity_id, "S4")}>원본 기회 보기</Link>
                    ) : (
                      <span className="text-[color:var(--muted-fg)]">—</span>
                    )}
                  </td>
                  <td className="col-num">{fmtDate(p.created_at)}</td>
                  <td>
                    {/* 바로가기 열은 작업이 아니라 내비게이션이다 — 배경 채움 버튼(btn-ghost)은
                        눌린 상태처럼 읽히므로(2026-10-22 사용자 리포트) 같은 행의
                        "원본 기회 보기"와 같은 링크 어휘를 쓴다. 종료·삭제만 버튼. */}
                    <div className="flex flex-col gap-1 items-start">
                      <Link className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline-offset-2 hover:underline" href={`/projects/${p.id}/business-case`}>
                        사업성(S8)
                      </Link>
                      <Link className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline-offset-2 hover:underline" href={`/projects/${p.id}/dd`}>
                        실사(S9)
                      </Link>
                      <Link className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline-offset-2 hover:underline" href={`/projects/${p.id}/ic-review`}>
                        투심(S11)
                      </Link>
                      <Link className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline-offset-2 hover:underline" href={`/projects/${p.id}/portfolio`}>
                        포트폴리오(S12)
                      </Link>
                      {p.is_lead && (
                        <>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            title="유형과 전제조건을 확인하고 이 프로젝트를 종료합니다"
                            onClick={() => setClosing({ id: p.id, name: p.project_name ?? p.project_no })}
                          >
                            종료…
                          </button>
                          <button
                            type="button"
                            className="btn-danger btn-sm"
                            title="이 프로젝트와 S8~S12 전체 데이터를 삭제합니다"
                            onClick={() => removeProject(p)}
                          >
                            삭제
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
