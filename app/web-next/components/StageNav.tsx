"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";

// StageNav — 딜 상세의 좌측 스테이지 내비. S1~S7 흐름에 따라 탭을 그룹핑하고,
// 현재 스테이지의 진척 상태를 신호등으로 표시한다. 스테이지 클릭 시 해당
// 스테이지의 대표 탭으로 이동한다.

export interface ProcessEval {
  currentStage: string | null;
  completedStages: string[];
  blockedStages: string[];
  nextStage: string | null;
  blockers: string[];
  requiredArtifacts: string[];
  gateStatus: Record<string, string>;
  track: "greenfield" | "brownfield" | null;
  subTrack: string | null;
  terminated: boolean;
}

const STAGE_TABS: Record<string, { label: string; tabs: string[]; primary: string }> = {
  S1: { label: "시장분석", tabs: ["market"], primary: "market" },
  S2: { label: "기회발굴", tabs: ["overview"], primary: "overview" },
  S3: { label: "시너지·적합성", tabs: ["overview"], primary: "overview" },
  S4: { label: "진출방식 결정", tabs: ["workflow"], primary: "workflow" },
  S5: { label: "사업성 분석", tabs: ["model", "simulation", "assumptions", "data"], primary: "model" },
  S6: { label: "실사·검증", tabs: ["dd", "permits", "ma"], primary: "dd" },
  S7: { label: "투자심사·실행", tabs: ["review", "activity", "members"], primary: "review" },
};

const STAGE_ORDER = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"];

const STATUS_ICON: Record<string, string> = {
  complete: "●",
  current: "◐",
  blocked: "○",
  locked: "🔒",
  terminated: "✕",
};

const STATUS_COLOR: Record<string, string> = {
  complete: "var(--green-fg)",
  current: "var(--primary)",
  blocked: "var(--muted-fg)",
  locked: "var(--muted-fg)",
  terminated: "var(--red-fg)",
};

const TAB_LABELS: Record<string, string> = {
  workflow: "워크플로우", overview: "개요", procedure: "절차 뷰어",
  market: "시장·체인", data: "데이터", assumptions: "가정", model: "모델",
  simulation: "시뮬레이션", compare: "버전 비교", dd: "실사",
  permits: "법령·인허가", ma: "M&A 검토", pmi: "PMI·증거",
  review: "검토 현황", activity: "활동·보고서", members: "멤버십",
};

export function StageNav({
  projectId,
  activeTab,
  onTabChange,
}: {
  projectId: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  const [eval_, setEval] = useState<{
    currentStage: string | null;
    completedStages: string[];
    gateStatus: Record<string, string>;
    track: string | null;
    subTrack: string | null;
    terminated: boolean;
  } | null>(null);

  useEffect(() => {
    api
      .get(`/api/projects/${projectId}/process`)
      .then((r) => setEval(r.data as { currentStage: string | null; completedStages: string[]; gateStatus: Record<string, string>; track: string | null; subTrack: string | null; terminated: boolean }))
      .catch(() => setEval(null));
  }, [projectId]);

  if (!eval_) return null;

  const currentStageId = eval_.currentStage ?? "S1";
  const stageIdx = STAGE_ORDER.indexOf(currentStageId);
  const visibleStages = STAGE_ORDER.filter((id) => {
    const idx = STAGE_ORDER.indexOf(id);
    return idx <= stageIdx + 1;
  });

  // 현재 스테이지에서 접근 가능한 탭 목록
  const stage = STAGE_ORDER[stageIdx] ?? "S1";
  const stageTabs = STAGE_TABS[stage]?.tabs ?? [];
  const primaryTab = STAGE_TABS[stage]?.primary ?? "overview";

  return (
    <nav className="stage-nav" aria-label="스테이지 내비">
      <div className="stage-nav-track">
        {visibleStages.map((id, i) => {
          const isCurrent = id === currentStageId;
          const isPast = eval_.completedStages.includes(id) || STAGE_ORDER.indexOf(id) < stageIdx;
          const statusColor = eval_.terminated && i === visibleStages.length - 1
            ? "var(--red-fg)" : isPast || isCurrent ? "var(--green-fg)" : "var(--muted-fg)";
          const statusIcon = isPast || isCurrent ? "●" : "○";
          return (
            <div key={id} className="stage-nav-item" style={{ color: isCurrent ? "var(--primary)" : statusColor }}>
              <span className="stage-nav-icon" style={{ color: statusColor }}>{statusIcon}</span>
              <span className="stage-nav-label">{id} {STAGE_TABS[id]?.label ?? ""}</span>
              {i < visibleStages.length - 1 && <span className="stage-nav-arrow" aria-hidden="true">↓</span>}
            </div>
          );
        })}
      </div>

      {eval_.track && (
        <div className="stage-nav-track-badge">
          {eval_.track === "greenfield" ? "그린필드" : "M&A"}
          {eval_.subTrack ? (eval_.subTrack === "existing_business_rbd" ? " · R&BD" : " · 사내벤처") : ""}
        </div>
      )}

      <div className="stage-nav-tabs">
        <div className="stage-nav-tabs-title">이 단계의 탭</div>
        {stageTabs.map((t) => (
          <button
            key={t}
            type="button"
            className={`stage-nav-tab ${activeTab === t ? "stage-nav-tab-active" : ""}`}
            onClick={() => onTabChange(t)}
          >
            {TAB_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      <div className="stage-nav-gates">
        {Object.entries(eval_.gateStatus).map(([gate, verdict]) => (
          <span key={gate} className={`status-chip ${verdict === "go" ? "status-green" : verdict === "hold" ? "status-amber" : verdict === "kill" ? "status-red" : "status-not-started"}`}>
            {gate}: {verdict.toUpperCase()}
          </span>
        ))}
      </div>
    </nav>
  );
}
