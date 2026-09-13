"use client";

// 파이프라인 상태 위젯 (ADR-0102 §4) — 기회 행/카드에 붙는 작은 배지.
// 상태: 자동 진행 중(running) / 확인 대기(paused, 딥링크 제공) / 완료 / 실패 /
// 중단(kill). 렌더링은 GET /api/opportunities/[id]/pipeline/status 단일 소스.
// 표현은 디자인 가이드의 공용 .status-chip 어휘(icon + text, 색 단독 금지).
import { useEffect, useState } from "react";

interface PipelineStatusData {
  pipeline_run_id: string;
  status: "running" | "paused_for_human" | "completed" | "failed" | "killed";
  current_stage: string | null;
  paused_reason: string | null;
  deep_link: string | null;
}

/** paused_reason 기계 키 → 사람이 읽는 확인 항목 (UI 라벨, 한국어 관례). */
function reasonLabel(reason: string): string {
  if (reason.startsWith("gate_decision:")) return `${(reason.split(":")[1] ?? "").toUpperCase()} 의사결정`;
  if (reason.startsWith("route_confirmation")) return "진출방식(트랙) 결정";
  if (reason.startsWith("case_adoption")) return "Business Case 채택";
  if (reason.startsWith("checklist_approval")) return "체크리스트 승인";
  if (reason.startsWith("manual_input")) return "평가 입력";
  if (reason.startsWith("no_automation:")) return `${reason.split(":")[1] ?? ""} 단계 작업`;
  if (reason.startsWith("promotion")) return "승격 전제조건 보완";
  return "확인";
}

const STATE_CHIP: Record<PipelineStatusData["status"], { chip: string; icon: string }> = {
  running: { chip: "status-not-started", icon: "▶" },
  paused_for_human: { chip: "status-amber", icon: "⏸" },
  completed: { chip: "status-green", icon: "✓" },
  failed: { chip: "status-red", icon: "!" },
  killed: { chip: "status-not-started", icon: "■" },
};

export function PipelineStatus({ opportunityId }: { opportunityId: string }) {
  const [status, setStatus] = useState<PipelineStatusData | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/opportunities/${opportunityId}/pipeline/status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((res) => {
        if (alive && res?.data) setStatus(res.data as PipelineStatusData);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [opportunityId]);

  if (!status) return null; // 파이프라인 실행 이력이 없으면 아무것도 렌더링하지 않는다

  const { chip, icon } = STATE_CHIP[status.status];
  const label =
    status.status === "running" ? "자동 진행 중"
    : status.status === "paused_for_human" ? `확인 대기: ${reasonLabel(status.paused_reason ?? "")}`
    : status.status === "completed" ? "파이프라인 완료"
    : status.status === "killed" ? "중단(KILL)"
    : "파이프라인 실패";

  const chipNode = (
    <span className={`status-chip ${chip}`}>
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );

  // 확인 대기 상태에서는 사람이 결정해야 할 화면으로 딥링크한다.
  if (status.status === "paused_for_human" && status.deep_link) {
    return (
      <a href={status.deep_link} className="inline-flex" title="확인 항목 화면으로 이동">
        {chipNode}
      </a>
    );
  }
  return chipNode;
}
