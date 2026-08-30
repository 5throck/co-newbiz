"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api.ts";

// WorkflowSidebar — 딜 상세 진입 시 좌측 패널이 전역 내비에서 워크플로우
// 내비로 전환됩니다 (ADR-0074 Definition-driven UI). S1~S7 스테퍼 + 게이트
// 배지 + 차단 사유를 표시하며, 스테이지 클릭 시 우측 패널이 해당 실행 화면으로
// 전환됩니다.

export interface WfStageEval {
  currentStage: string | null;
  completedStages: string[];
  blockedStages: string[];
  blockers: string[];
  requiredArtifacts: string[];
  gateStatus: Record<string, string>;
  track: "greenfield" | "brownfield" | null;
  subTrack: string | null;
  terminated: boolean;
}

export const WF_STAGES = [
  { id: "S1", label: "시장분석" },
  { id: "S2", label: "기회발굴" },
  { id: "S3", label: "시너지·적합성" },
  { id: "S4", label: "진출방식 결정" },
  { id: "S5", label: "사업성 분석" },
  { id: "S6", label: "실사·검증" },
  { id: "S7", label: "투자심사·실행" },
];

export function WorkflowSidebar({
  projectId,
  projectNo,
  activeStage,
  onStageSelect,
}: {
  projectId: string;
  projectNo: string;
  activeStage: string;
  onStageSelect: (stage: string) => void;
}) {
  const [eval_, setEval] = useState<WfStageEval | null>(null);

  useEffect(() => {
    api.get<WfStageEval>(`/api/projects/${projectId}/process`)
      .then((r) => setEval(r.data))
      .catch(() => setEval(null));
  }, [projectId]);

  return (
    <aside className="app-sidebar wf-sidebar" aria-label="딜 워크플로우">
      <div className="wf-brand">
        <span className="sidebar-brand-icon">CN</span>
        <span>{projectNo}</span>
      </div>
      <Link href="/projects" className="wf-back-link">← 전체 딜</Link>

      {eval_?.terminated && (
        <p className="wf-terminated" role="alert">✕ 프로세스 종결 (KILL)</p>
      )}

      <ol className="wf-stepper" aria-label="프로세스 스테이지">
        {WF_STAGES.map((s) => {
          const isComplete = eval_?.completedStages.includes(s.id) ?? false;
          const isCurrent = s.id === eval_?.currentStage;
          const isBlocked = eval_?.blockedStages.includes(s.id) ?? false;
          const isActive = s.id === activeStage;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`wf-step wf-step-${isComplete ? "complete" : isCurrent ? "current" : isBlocked ? "blocked" : "pending"} ${isActive ? "wf-step-active" : ""}`}
                onClick={() => onStageSelect(s.id)}
              >
                <span className="wf-step-icon" aria-hidden="true">
                  {isComplete ? "✓" : isCurrent ? "◐" : isBlocked ? "🔒" : "○"}
                </span>
                <span className="wf-step-label">{s.id} {s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {eval_?.track && (
        <div className="wf-track-badge">
          {eval_.track === "greenfield" ? "그린필드" : "M&A"}
          {eval_.subTrack ? (eval_.subTrack === "existing_business_rbd" ? " · R&BD" : " · 사내벤처") : ""}
        </div>
      )}

      {eval_ && Object.keys(eval_.gateStatus).length > 0 && (
        <div className="wf-gates">
          {Object.entries(eval_.gateStatus).map(([gate, verdict]) => (
            <span key={gate} className={`status-chip ${verdict === "go" ? "status-green" : verdict === "hold" ? "status-amber" : verdict === "kill" ? "status-red" : "status-not-started"}`}>
              {gate}: {verdict.toUpperCase()}
            </span>
          ))}
        </div>
      )}

      {eval_ && eval_.blockers.length > 0 && (
        <ul className="wf-blockers">
          {eval_.blockers.map((b, i) => <li key={i}>⚠ {b}</li>)}
        </ul>
      )}

      {eval_ && eval_.requiredArtifacts.length > 0 && eval_.currentStage && (
        <div className="wf-artifacts">
          <div className="wf-artifacts-title">필요 산출물</div>
          {eval_.requiredArtifacts.map((a, i) => (
            <div key={i} className="wf-artifact-item">☐ {a}</div>
          ))}
        </div>
      )}

      <div className="wf-user">
        <span>← <Link href="/login" className="text-[color:var(--muted-fg)]">로그인</Link></span>
      </div>
    </aside>
  );
}
