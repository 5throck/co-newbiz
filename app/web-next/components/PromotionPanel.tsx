"use client";

// 프로젝트 승격 표면 (ADR-0095) — S7→S8 캐리어 전환은 게이트가 아니라 장부
// 이전(bookkeeping)이다. 전제조건(트랙·단계 산출물)의 최종 판정은 서버
// (promoteOpportunity)가 하며, 이 패널은 process API의 단계 상태로 준비
// 여부를 먼저 보여준다. 승격 기록 자체는 사람의 명시적 행위다 (경계 #2).
// 역할 분리 (ADR-0091): admin은 딜 콘텐츠 화면에서 승격할 수 없다(패널 숨김 —
// API도 role_forbidden으로 거부), viewer에게는 권한 안내만 표시한다.

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
}

interface PromoteResult {
  project_id: string;
  project_no: string;
  track: string;
  source_opportunity_id: string;
  promoted_at: string;
}

/** 트랙별 승격 진입 단계 — greenfield는 S5, brownfield는 S7 (flow.spec applicableTracks). */
function finalStageOf(track: ProcessView["track"]): string | null {
  if (track === "greenfield") return "S5";
  if (track === "brownfield") return "S7";
  return null;
}

function describePromoteError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "already_promoted":
        return "이미 승격된 기회입니다 — 프로젝트 목록에서 확인하세요.";
      case "precondition_failed":
        return "승격 전제조건(트랙 결정·단계 산출물·게이트 기록)이 아직 충족되지 않았습니다.";
      case "role_required":
      case "role_forbidden":
        return "승격은 analyst 이상 권한의 계정에서만 가능합니다.";
      case "not_found":
        return "기회를 찾을 수 없습니다.";
      default:
        return err.message;
    }
  }
  return "승격 처리 중 오류가 발생했습니다.";
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

  // ADR-0091 — admin에게는 승격 표면 자체를 노출하지 않는다 (API도 거부).
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

  function requestPromote(e: React.FormEvent) {
    e.preventDefault();
    if (!needToKnowBasis.trim() || busy) return;
    confirm(
      "이 기회를 프로젝트로 승격할까요?",
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
            },
          );
          router.push(`/projects/${r.data.project_id}`);
        } catch (err) {
          setError(describePromoteError(err));
          setBusy(false);
        }
      },
      {
        body: "S1~S7 산출물로 차터가 자동 구성되고, 승격한 사람이 프로젝트 lead로 등록됩니다. 승격 후 기회 캐리어는 S7에서 종결됩니다.",
        confirmLabel: "승격",
      },
    );
  }

  return (
    <section aria-label="프로젝트로 승격" className="market-section">
      <div className="section-toolbar">
        <span className="section-title">
          <h2>{heading ?? "🚀 프로젝트로 승격 (S7 → S8)"}</h2>
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
            트랙 최종 단계({proc.track === "brownfield" ? "S7 대상 스크리닝" : "S5 역량 평가"})의 완료
            요건이 아직 충족되지 않았습니다 — 충족 후 승격할 수 있습니다.
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
        <form onSubmit={requestPromote} className="sizing-new-form mb-0" aria-label="프로젝트 승격">
          <label className="text-[0.78rem] w-full">
            <span className="block mb-1">need-to-know 근거 * (승격 사유 — 감사 기록으로 남습니다)</span>
            <textarea
              value={needToKnowBasis}
              onChange={(e) => setNeedToKnowBasis(e.target.value)}
              rows={2}
              required
              placeholder="예: 로봇 부품 시장 진출 검토의 후속 실사 대상 확정 — 본 기회의 Short List 1위 대상"
              className="sizing-new-input"
              style={{ width: "100%" }}
            />
          </label>
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
              {busy ? "승격 처리 중..." : "프로젝트로 승격"}
            </button>
          </div>
          {isViewer && (
            <p role="status" className="text-[0.75rem] text-[color:var(--muted-fg)] mt-2 mb-0">
              승격은 analyst 이상 권한의 계정에서만 가능합니다.
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
