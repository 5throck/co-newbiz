"use client";

// 프로젝트 추진 표면 (ADR-0095) — S7→S8 캐리어 전환은 진행이 아니라 장부
// 이전(bookkeeping)이다. 전제조건(트랙·단계 산출물)의 최종 판정은 서버
// (promoteOpportunity)가 하며, 이 패널은 process API의 단계 상태로 준비
// 여부를 먼저 보여준다. 추진 기록 자체는 사람의 명시적 행위다 (경계 #2).
// 역할 분리 (ADR-0091): admin은 검토/안건 콘텐츠 화면에서 추진할 수 없다(패널 숨김 —
// API도 role_forbidden으로 거부), viewer에게는 권한 안내만 표시한다.
// 추진 후에는(이미 project_id가 있으면) 폼·팀원 배정 내역을 다시 보여주지
// 않는다 — 누가 배정됐는지는 need-to-know 원칙상 이 화면의 관심사가 아니다.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { useConfirm } from "./crud.tsx";

interface ProcessStageLite {
  id: string;
  status: string;
}

interface ProcessView {
  track: "greenfield" | "brownfield" | null;
  subTrack: string | null;
  terminated: boolean;
  blockers: string[];
  stages: ProcessStageLite[];
  projectId: string | null;
}

interface PromoteResult {
  project_id: string;
  project_no: string;
  track: string;
  source_opportunity_id: string;
  promoted_at: string;
}

type ProjectRole = "lead" | "contributor" | "reviewer" | "observer";
const ROLE_LABEL: Record<ProjectRole, string> = { lead: "리드", contributor: "기여자", reviewer: "리뷰어", observer: "참관자" };
interface UserHit { user_id: string; display_name: string; role: string }
interface TeamMember { userId: string; displayName: string; projectRole: ProjectRole }

/** 트랙별 추진 진입 단계 — greenfield는 S5, brownfield는 S7 (flow.spec applicableTracks). */
function finalStageOf(track: ProcessView["track"]): string | null {
  if (track === "greenfield") return "S5";
  if (track === "brownfield") return "S7";
  return null;
}

function describePromoteError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "already_promoted":
        return "이미 추진된 기회입니다 — 프로젝트 목록에서 확인하세요.";
      case "precondition_failed":
        return "추진 전제조건(트랙 결정·단계 산출물·진행 기록)이 아직 충족되지 않았습니다.";
      case "role_required":
      case "role_forbidden":
        return "추진은 analyst 이상 권한의 계정에서만 가능합니다.";
      case "not_found":
        return "기회를 찾을 수 없습니다.";
      default:
        return err.message;
    }
  }
  return "추진 처리 중 오류가 발생했습니다.";
}

export function PromotionPanel({
  opportunityId,
  heading,
}: {
  opportunityId: string;
  heading?: string;
}) {
  const router = useRouter();
  const { me } = useAuth();
  const [proc, setProc] = useState<ProcessView | null>(null);
  const [procFailed, setProcFailed] = useState(false);
  const [needToKnowBasis, setNeedToKnowBasis] = useState("");
  const [origin, setOrigin] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // 팀원 검색·배정 — 추진자 본인은 항상 lead로 별도 등록되므로 여기서는
  // "추가로 배정할" 팀원만 다룬다.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserHit[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [pendingRole, setPendingRole] = useState<ProjectRole>("contributor");
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .get<ProcessView>(`/api/opportunities/${encodeURIComponent(opportunityId)}/process`)
      .then((r) => {
        if (alive) setProc(r.data);
      })
      .catch(() => {
        if (alive) setProcFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [opportunityId]);

  // 검색어 디바운스 — 팀원 검색은 analyst+ 전용 /api/users/lookup을 쓴다.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchBusy(true);
      api.get<{ users: UserHit[] }>(`/api/users/lookup?q=${encodeURIComponent(query)}`)
        .then((r) => setHits(r.data.users))
        .catch(() => setHits([]))
        .finally(() => setSearchBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // ADR-0091 — admin에게는 추진 표면 자체를 노출하지 않는다 (API도 거부).
  if (me?.role === "admin") return null;

  const isViewer = me?.role === "viewer";
  const finalStageId = proc ? finalStageOf(proc.track) : null;
  const finalStage =
    proc !== null && finalStageId !== null
      ? proc.stages.find((s) => s.id === finalStageId)
      : undefined;
  const ready =
    proc !== null &&
    finalStage !== undefined &&
    finalStage.status === "complete" &&
    !proc.terminated;

  function addMember(hit: UserHit) {
    if (members.some((m) => m.userId === hit.user_id)) return;
    setMembers((prev) => [...prev, { userId: hit.user_id, displayName: hit.display_name || hit.user_id, projectRole: pendingRole }]);
  }
  function removeMember(userId: string) {
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
  }

  function requestPromote(e: React.FormEvent) {
    e.preventDefault();
    if (!needToKnowBasis.trim() || busy) return;
    confirm(
      "이 기회를 프로젝트로 추진할까요?",
      async () => {
        setBusy(true);
        setError(null);
        try {
          const r = await api.post<PromoteResult>(
            `/api/opportunities/${encodeURIComponent(opportunityId)}/promote`,
            {
              needToKnowBasis: needToKnowBasis.trim(),
              ...(origin ? { origin } : {}),
              ...(projectName.trim() ? { project_name: projectName.trim() } : {}),
              ...(members.length > 0 ? { members: members.map((m) => ({ userId: m.userId, projectRole: m.projectRole })) } : {}),
            },
          );
          router.push(`/projects/${r.data.project_id}`);
        } catch (err) {
          setError(describePromoteError(err));
          setBusy(false);
        }
      },
      {
        body: `S1~S7 산출물로 차터가 자동 구성되고, 추진한 사람이 프로젝트 리드로 등록됩니다${members.length > 0 ? ` (추가 팀원 ${members.length}명 함께 배정)` : ""}. 추진 후 기회 캐리어는 S7에서 종결됩니다.`,
        confirmLabel: "추진",
      },
    );
  }

  // 이미 프로젝트로 추진됐다면 — 팀 배정 등 세부 내용을 다시 보여주지 않고
  // 최소 정보만 남긴다(need-to-know 원칙 — 누가 배정됐는지는 이 화면의 관심사가
  // 아니다. 확인하려면 프로젝트 멤버 권한으로 직접 들어가야 한다).
  if (proc?.projectId) {
    return (
      <section aria-label="프로젝트로 추진" className="market-section">
        <div className="section-toolbar">
          <span className="section-title"><h2>{heading ?? "🚀 프로젝트로 추진"}</h2></span>
          <span className="status-chip status-green">추진됨</span>
        </div>
        <p className="mb-0 text-[0.85rem]">
          ✅ 프로젝트로 추진되었습니다 —{" "}
          <a href={`/projects/${proc.projectId}`} className="text-[color:var(--accent)] underline">
            프로젝트 개요 보기
          </a>
        </p>
      </section>
    );
  }

  return (
    <section aria-label="프로젝트로 추진" className="market-section">
      <div className="section-toolbar">
        <span className="section-title">
          <h2>{heading ?? "🚀 프로젝트로 추진 (S7 → S8)"}</h2>
        </span>
        {finalStageId && finalStage && (
          <span className={`status-chip ${ready ? "status-green" : "status-amber"}`}>
            {finalStageId} {finalStage.status === "complete" ? "완료 요건 충족" : "완료 요건 미충족"}
          </span>
        )}
      </div>

      {procFailed && (
        <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-0">
          프로세스 상태를 불러올 수 없습니다 — 새로고침 후 다시 시도하세요.
        </p>
      )}
      {proc === null && !procFailed && <p className="text-[0.82rem]">불러오는 중...</p>}

      {proc !== null && proc.track === null && (
        <p className="text-[0.85rem] mb-0">
          진출방식 결정(S4)이 먼저 필요합니다 —{" "}
          <a href="/route-decision" className="text-[color:var(--accent)] underline">
            진출방식 결정 화면으로 이동
          </a>
        </p>
      )}

      {proc !== null && proc.track !== null && !ready && (
        <div className="mb-0 text-[0.82rem]">
          <p className="mt-0 mb-1">
            트랙 최종 단계({proc.track === "brownfield" ? "S7 대상 선정" : "S5 역량 평가"})의 완료
            요건이 아직 충족되지 않았습니다 — 충족 후 추진할 수 있습니다.
          </p>
          {proc.blockers.length > 0 && (
            <ul className="sizing-note-list m-0">
              {proc.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ready && (
        <form onSubmit={requestPromote} className="sizing-new-form mb-0" aria-label="프로젝트 추진">
          <label className="text-[0.78rem] w-full">
            <span className="block mb-1">본인의 프로젝트 접근 필요 근거 * (need-to-know — 추진 사유가 아니라 멤버십 부여의 감사 근거입니다)</span>
            <textarea
              value={needToKnowBasis}
              onChange={(e) => setNeedToKnowBasis(e.target.value)}
              rows={2}
              required
              placeholder="예: 본 기회의 담당 애널리스트로서 S8 이후 실사·투자심사 데이터 접근이 필요함"
              className="sizing-new-input"
              style={{ width: "100%" }}
            />
            <span className="block mt-1 text-[0.72rem] text-[color:var(--muted-fg)]">
              위 Pre-FS 게이트의 GO 근거(사업 판단)와는 별개입니다 — 이 프로젝트는 추진 즉시 접근이
              차단된 상태로 시작되며(need-to-know 원칙), 여기 적은 내용은 &ldquo;왜 본인이 이 데이터를
              봐야 하는가&rdquo;를 기록하는 접근 권한 부여 근거입니다. 아래에서 추가하는 팀원에게도
              동일한 근거가 적용됩니다.
            </span>
          </label>

          <div className="sizing-grade-card mb-3">
            <h4 className="text-[0.8rem] mb-2">팀원 배정 (선택)</h4>
            <div className="flex flex-wrap items-end gap-2 mb-2">
              <label className="text-[0.78rem]" style={{ flex: "1 1 14rem" }}>
                <span className="block mb-1">이름·아이디 검색</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="예: 홍길동 또는 hong.gd"
                  className="sizing-new-input w-full"
                />
              </label>
              <label className="text-[0.78rem] w-32 shrink-0">
                <span className="block mb-1">역할</span>
                <select value={pendingRole} onChange={(e) => setPendingRole(e.target.value as ProjectRole)} className="sizing-new-input sizing-new-input-sm w-full">
                  {(Object.keys(ROLE_LABEL) as ProjectRole[]).filter((r) => r !== "lead").map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </label>
            </div>
            {searchBusy && <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-2">검색 중...</p>}
            {hits && hits.length > 0 && (
              <ul className="sizing-note-list mb-2">
                {hits.filter((h) => h.user_id !== me?.userId).map((h) => (
                  <li key={h.user_id} className="flex items-center justify-between gap-2 mb-1">
                    <span>{h.display_name || h.user_id} <span className="text-[0.72rem] text-[color:var(--muted-fg)]">({h.user_id} · {h.role})</span></span>
                    <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => addMember(h)}>추가</button>
                  </li>
                ))}
              </ul>
            )}
            {members.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {members.map((m) => (
                  <span key={m.userId} className="control-chip">
                    {m.displayName} · {ROLE_LABEL[m.projectRole]}
                    <button type="button" aria-label={`${m.displayName} 제거`} onClick={() => removeMember(m.userId)} style={{ marginLeft: 6 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[0.78rem]">
              <span className="block mb-1">원본 (origin)</span>
              <select
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="sizing-new-input sizing-new-input-sm"
              >
                <option value="">선택</option>
                <option value="internal">내부 (internal)</option>
                <option value="external">외부 (external)</option>
                <option value="hybrid">하이브리드 (hybrid)</option>
                <option value="joint">합작 (joint)</option>
              </select>
            </label>
            <label className="text-[0.78rem]" style={{ flex: "1 1 14rem" }}>
              <span className="block mb-1">프로젝트명 (미입력 시 차터에서 자동 생성)</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="예: 로봇 부품 자회사 설립"
                className="sizing-new-input"
                style={{ width: "100%" }}
              />
            </label>
            <button type="submit" className="btn-ghost" disabled={busy || isViewer || !needToKnowBasis.trim()}>
              {busy ? "추진 처리 중..." : "프로젝트로 추진"}
            </button>
          </div>
          {isViewer && (
            <p role="status" className="text-[0.75rem] text-[color:var(--muted-fg)] mt-2 mb-0">
              추진은 analyst 이상 권한의 계정에서만 가능합니다.
            </p>
          )}
          {error && (
            <p role="alert" className="text-[color:var(--red-fg)] text-[0.8rem] mt-2 mb-0">
              ✕ {error}
            </p>
          )}
        </form>
      )}
      {confirmDialog}
    </section>
  );
}
