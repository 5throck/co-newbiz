"use client";

import { useEffect, useState } from "react";

// 딜 진척 헤더 — S1~S7 흐름 바 + 단계별 신호등(색+아이콘+라벨 병기, 색만으로
// 상태를 구분하지 않음). 게이트 판정 배지, HOLD 보완 산출물 표시 포함.
// 데이터는 evaluateProcess의 파생 상태(GET /api/projects/:id/process).

interface StageEval {
  id: string;
  name: string;
  sequence: number;
  status: "complete" | "current" | "blocked" | "locked" | "terminated";
}

interface ProcessEvaluation {
  currentStage: string | null;
  completedStages: string[];
  gateStatus: Record<string, string>;
  track: "greenfield" | "brownfield" | null;
  subTrack: string | null;
  terminated: boolean;
  stages: StageEval[];
}

const STAGE_LABELS: Record<string, string> = {
  S1: "시장분석",
  S2: "기회발굴",
  S3: "시너지",
  S4: "트랙결정",
  S5: "사업성",
  S6: "실사",
  S7: "투자심사",
};

const GATE_LABELS: Record<string, string> = {
  screening: "Screening",
  pre_fs: "Pre-FS",
  fs: "FS",
  dd: "DD",
  entity_ic: "Entity IC",
  group_ic: "Group IC",
};

const STATUS_ICON: Record<StageEval["status"], string> = {
  complete: "●",
  current: "◐",
  blocked: "○",
  locked: "○",
  terminated: "✕",
};

const STATUS_LABEL: Record<StageEval["status"], string> = {
  complete: "완료",
  current: "진행중",
  blocked: "대기",
  locked: "대기",
  terminated: "종결",
};

export function ProcessHeader({ projectId }: { projectId: string }) {
  const [eval_, setEval] = useState<ProcessEvaluation | null>(null);
  const [holdDetail, setHoldDetail] = useState<string | null>(null);

  useEffect(() => {
    api_get();
  }, [projectId]);

  function api_get() {
    fetch(`/api/projects/${projectId}/process`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body?.data && setEval(body.data))
      .catch(() => setEval(null));
  }

  if (!eval_) return null;

  return (
    <div className="process-header" role="status" aria-label="딜 진척 현황">
      <ol className="process-lights">
        {eval_.stages.map((s) => (
          <li key={s.id} className={`process-light pl-${s.status}`} title={`${s.id} ${STAGE_LABELS[s.id] ?? ""} — ${STATUS_LABEL[s.status]}`}>
            <span className="pl-icon" aria-hidden="true">
              {STATUS_ICON[s.status]}
            </span>
            <span className="pl-body">
              <span className="pl-id">
                {s.id} {STAGE_LABELS[s.id] ?? ""}
              </span>
              <span className="pl-status">{STATUS_LABEL[s.status]}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="process-header-meta">
        {eval_.terminated && <span className="status-chip status-red">KILL 종결</span>}
        {eval_.track && (
          <span className="status-chip status-in-progress">
            {eval_.track === "greenfield" ? "그린필드" : "M&A"}
            {eval_.subTrack ? (eval_.subTrack === "existing_business_rbd" ? " · R&BD" : " · 사내벤처") : ""}
          </span>
        )}
        {Object.entries(eval_.gateStatus)
          .filter(([, v]) => v !== "pending")
          .map(([gate, verdict]) => (
            <GateBadge key={gate} gate={gate} verdict={verdict} onShowHold={setHoldDetail} />
          ))}
      </div>
      {holdDetail && (
        <p className="process-hold-note" role="alert">
          {holdDetail}
          <button type="button" className="btn-ghost" onClick={() => setHoldDetail(null)}>
            닫기
          </button>
        </p>
      )}
    </div>
  );
}

function GateBadge({
  gate,
  verdict,
  onShowHold,
}: {
  gate: string;
  verdict: string;
  onShowHold: (msg: string) => void;
}) {
  return (
    <span
      className={`status-chip ${verdict === "go" ? "status-green" : verdict === "hold" ? "status-amber" : "status-red"}`}
      title={`${GATE_LABELS[gate] ?? gate}: ${verdict.toUpperCase()}`}
      style={verdict === "hold" ? { cursor: "pointer" } : undefined}
      onClick={
        verdict === "hold"
          ? () => {
              // 보완 산출물은 gate_decision 레코드에서 가져온다
              fetch("/api/projects/" + (window.location.pathname.split("/")[2] ?? "") + "/gate-decisions", { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((body) => {
                  const rows = (body?.data ?? []) as Array<{ gate: string; decision: string; missing_artifacts_json: string | null }>;
                  const hold = [...rows].reverse().find((r) => r.gate === gate && r.decision === "hold");
                  const list = hold?.missing_artifacts_json ? JSON.parse(hold.missing_artifacts_json) : [];
                  onShowHold(`${GATE_LABELS[gate] ?? gate} HOLD — 보완 필요: ${list.length ? list.join(", ") : "게이트 근거 확인"}`);
                })
                .catch(() => onShowHold(`${GATE_LABELS[gate] ?? gate} HOLD — 보완 필요 산출물을 확인하세요`));
            }
          : undefined
      }
    >
      {verdict === "go" ? "●" : verdict === "hold" ? "◐" : "✕"} {GATE_LABELS[gate] ?? gate} {verdict.toUpperCase()}
    </span>
  );
}
