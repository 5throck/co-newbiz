"use client";

// 아카이브 (/projects/archives) — 보관(마감/보관 상태) 프로젝트와 삭제 표시된
// 검토/안건을 한 화면에서 열람한다. 삭제는 물리 삭제가 아니라 deletion mark이므로
// 원본 데이터는 전부 보존되어 있고, 이 화면이 그 자료의 열람 입구다
// (deal-deletion-playbook). 열람 권한은 당시 프로젝트 멤버 기준이며
// 서버가 매열람을 감사 기록한다.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api.ts";
import { useConfirm } from "../../../components/crud.tsx";
import { closureTypeLabel } from "../../../lib/labels.ts";
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

const STATUS_LABEL: Record<string, string> = { open: "진행", closed: "마감", archived: "보관" };

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function ProjectArchivesView() {
  const [archived, setArchived] = useState<ArchiveProjectRow[] | null>(null);
  const [deleted, setDeleted] = useState<DeletedDealRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, ArchiveDetail>>({});
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    api
      .get<ArchiveProjectRow[]>("/api/projects?status=all")
      .then((r) => setArchived(r.data.filter((p) => p.status !== "open")))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    api
      .get<DeletedDealRow[]>("/api/archive/deals")
      .then((r) => setDeleted(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "삭제 이력 불러오기 실패"));
  }

  useEffect(() => {
    load();
  }, []);

  function removeProject(p: ArchiveProjectRow) {
    confirm(
      `${p.project_name ?? p.project_no} 삭제`,
      async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(p.id)}`);
          load();
        } catch (err) {
          setError(err instanceof Error ? err.message : "프로젝트 삭제 실패");
        }
      },
      {
        body: "삭제 표시로 전환됩니다. 데이터는 삭제되지 않고 아카이브에 남아 감사 시 열람할 수 있으며, 모든 진행 화면에서는 사라집니다.",
      },
    );
  }

  async function openDetail(id: string) {
    if (detail[id]) return;
    try {
      const r = await api.get<ArchiveDetail>(`/api/archive/deals/${encodeURIComponent(id)}`);
      setDetail((prev) => ({ ...prev, [id]: r.data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "상세 조회 실패");
    }
  }

  return (
    <main>
      <h1>아카이브</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        마감·보관한 프로젝트와 삭제 표시된 검토/안건의 원본을 열람합니다. 데이터는 물리적으로 삭제되지 않으며, 열람 기록은 감사 로그에 남습니다.
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      <section aria-label="보관 프로젝트" className="market-section">
        <h2 className="text-[length:var(--fs-body)] font-semibold mb-2">보관 프로젝트</h2>
        {archived === null ? (
          <p>불러오는 중...</p>
        ) : archived.length === 0 ? (
          <p className="text-[color:var(--muted-fg)]">보관 중인 프로젝트가 없습니다.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48">
              <caption className="sr-only">보관 프로젝트 목록</caption>
              <ColGroup widths={ARCHIVE_COL_PCT} />
              <thead>
                <tr>
                  <th className="text-left">프로젝트 번호</th>
                  <th className="text-left">프로젝트명</th>
                  <th className="text-left">상태</th>
                  <th className="text-left">종료일</th>
                  <th className="text-left">마감 유형</th>
                  <th className="text-left">사유</th>
                  <th className="text-left">바로가기</th>
                </tr>
              </thead>
              <tbody>
                {archived.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold">{p.project_no}</td>
                    <td>{p.project_name ?? "—"}</td>
                    <td>
                      <span className={`status-chip ${p.status === "closed" ? "status-amber" : "status-not-started"}`}>
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td>{fmtDate(p.closed_at ?? null)}</td>
                    <td>{closureTypeLabel(p.closure_type)}</td>
                    <td>{p.closure_reason ?? "—"}</td>
                    <td>
                      <div className="flex gap-2 flex-wrap">
                        <Link className="btn-ghost btn-sm" href={`/projects/${p.id}`}>
                          개요
                        </Link>
                        {p.is_lead && (
                          <button type="button" className="btn-danger btn-sm" title="삭제 표시로 전환합니다" onClick={() => removeProject(p)}>
                            삭제
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

      <section aria-label="삭제된 검토/안건" className="market-section">
        <h2 className="text-[length:var(--fs-body)] font-semibold mb-2">삭제된 검토/안건</h2>
        {deleted === null ? (
          <p>불러오는 중...</p>
        ) : deleted.length === 0 ? (
          <p className="text-[color:var(--muted-fg)]">삭제 표시된 검토/안건이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {deleted.map((d) => (
              <li key={d.id} className="border border-[color:var(--border)] rounded p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="font-semibold mr-2">{d.project_name ?? d.project_no ?? d.id}</span>
                    {d.project_no && <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mr-2">{d.project_no}</span>}
                    <span className="status-chip status-red">삭제</span>
                  </div>
                  <div className="flex gap-2">
                    {d.project_id && (
                      <Link className="btn-ghost btn-sm" href={`/projects/${d.project_id}`}>
                        원본 열람
                      </Link>
                    )}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => void openDetail(d.id)}>
                      상세
                    </button>
                  </div>
                </div>
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
                  삭제자 {d.acted_by} · {fmtDate(d.acted_at)}
                  {d.status_at_archive ? ` · 당시 상태 ${STATUS_LABEL[d.status_at_archive] ?? d.status_at_archive}` : ""}
                  {d.reason ? ` · 사유: ${d.reason}` : ""}
                </p>
                {detail[d.id] && (
                  <div className="text-[length:var(--fs-caption)] mt-2">
                    <p className="mb-1">시장분석 시점 고정(당시 버전):</p>
                    <ul className="list-disc pl-5">
                      {(detail[d.id].market_freeze ?? []).map((f, i) => (
                        <li key={i}>
                          산업 {f.industryId} — 분석 {f.analysisId ?? "없음"} / 버전 {f.versionNo ?? "—"}
                        </li>
                      ))}
                      {(detail[d.id].market_freeze ?? []).length === 0 && <li>연결된 시장분석 없음</li>}
                    </ul>
                    <p className="text-[color:var(--muted-fg)] mt-1">이 상세 조회는 감사 로그에 기록되었습니다.</p>
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
