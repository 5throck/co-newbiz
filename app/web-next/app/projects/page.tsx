"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { api } from "../../lib/api.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { useConfirm } from "../../components/crud.tsx";

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

// 종료/보관 다이얼로그 — crud.tsx ConfirmDialog와 동일 프리미티브
// (modal-backdrop/modal-panel + useModalFocus)에 사유 입력을 얹은 형태.
// closeProject는 closure_reason을 필수로 요구하므로 비어 있으면 제출할 수 없다.
function CloseDialog({
  target,
  onClose,
  onDone,
}: {
  target: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<"closed" | "archived">("closed");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { panelRef, onKeyDown } = useModalFocus(onClose);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/projects/${target.id}/close`, { status, closure_reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "종료/보관 처리 실패");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-close-title"
        style={{ maxWidth: "26rem", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="project-close-title" style={{ fontSize: "0.95rem" }}>
            프로젝트 종료/보관 — {target.name}
          </h2>
        </div>
        <form onSubmit={submit} aria-label="프로젝트 종료/보관">
          <div className="flex flex-wrap items-end gap-2 mt-2">
            <label className="text-[0.78rem]">
              <span className="block mb-1">상태</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "closed" | "archived")}
                className="sizing-new-input sizing-new-input-sm"
              >
                <option value="closed">마감 (closed)</option>
                <option value="archived">보관 (archived)</option>
              </select>
            </label>
            <label className="text-[0.78rem] flex-1" style={{ minWidth: "12rem" }}>
              <span className="block mb-1">사유 *</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: closeout 패키지 완료, 잠정 보류"
                required
                autoFocus
                className="sizing-new-input"
              />
            </label>
            <button type="submit" className="btn-ghost btn-sm" disabled={busy || !reason.trim()}>
              저장
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
              취소
            </button>
          </div>
        </form>
        <p className="text-[0.78rem] text-[color:var(--muted-fg)] mt-2 mb-0">
          종료/보관된 프로젝트는 기본 목록에서 제외됩니다. 게이트 판정(KILL)과는 별개의 운영자 상태입니다.
        </p>
        {error && (
          <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mt-2 mb-0">
            {error}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
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
        body: "삭제 표시로 전환됩니다. 연결 기회(진출방식 결정·대상 스크리닝·시너지 포함)가 함께 삭제 표시되고, 데이터는 보존되어 아카이브에서 감사용으로 열람할 수 있습니다.",
      },
    );
  }

  return (
    <main>
      <h1>프로젝트</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        승격된 프로젝트의 사업성 분석(S8)·실사(S9)·투심(S11)·포트폴리오(S12) 화면으로 이동합니다.
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
        <div className="table-scroll">
          <table className="data-table" style={{ minWidth: "820px" }}>
            <caption className="sr-only">프로젝트 목록</caption>
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
                  <td>{p.project_name ?? "—"}</td>
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
                      <Link href={`/opportunities?opportunity=${p.source_opportunity_id}`}>기회 보기</Link>
                    ) : (
                      <span className="text-[color:var(--muted-fg)]">—</span>
                    )}
                  </td>
                  <td className="col-num">{fmtDate(p.created_at)}</td>
                  <td>
                    <div className="flex gap-2 flex-wrap">
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/business-case`}>
                        사업성(S8)
                      </Link>
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/dd`}>
                        실사(S9)
                      </Link>
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/ic-review`}>
                        투심(S11)
                      </Link>
                      <Link className="btn-ghost btn-sm" href={`/projects/${p.id}/portfolio`}>
                        포트폴리오(S12)
                      </Link>
                      {p.is_lead && (
                        <>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            title="이 프로젝트를 마감 또는 보관 상태로 전환합니다"
                            onClick={() => setClosing({ id: p.id, name: p.project_name ?? p.project_no })}
                          >
                            종료/보관
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
        <CloseDialog
          target={closing}
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
