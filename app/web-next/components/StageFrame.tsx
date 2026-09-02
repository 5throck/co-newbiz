"use client";

// P0 공통 골격 — 표준 화면 패턴 (ADR-0086, docs/designs/2026-09-01-standard-screen-patterns-design_ko.md).
// 단계 화면의 유일한 외피: 단계 헤더 + S1~S11 진행 레일(StageRail) + 본문 슬롯.
// 데이터원은 lib/stage-meta.ts (flow.spec 발췌, 정합 테스트로 강제) — 페이지별 하드코딩 금지.

import type { ReactNode } from "react";
import { GATE_LABEL, STAGE_META, type StageMetaId, type TrackId } from "../lib/stage-meta.ts";

export function StageFrame({
  stageId,
  track,
  children,
}: {
  /** 이 화면이 담당하는 단계 — 복합 단계는 배열(S6·S7처럼 한 화면이 두 단계) */
  stageId: StageMetaId | StageMetaId[];
  /** 화면이 고정 트랙에서 동작할 때 지정 — 트랙 미해당 단계를 레일에서 비활성 */
  track?: TrackId;
  children?: ReactNode;
}) {
  const ids = Array.isArray(stageId) ? stageId : [stageId];
  const primary = ids[0];
  const stage = STAGE_META.find((s) => s.id === primary)!;
  return (
    <>
      <h1>
        {stage.id} {ids.length > 1 ? `· ${STAGE_META.find((s) => s.id === ids[1])!.name}` : stage.name}
      </h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">{stage.objective}</p>
      <StageRail current={ids} track={track} />
      {children}
    </>
  );
}

export function StageRail({ current, track }: { current: StageMetaId[]; track?: TrackId }) {
  return (
    <nav aria-label="프로세스 단계 진행" className="sizing-step-rail mb-4">
      {STAGE_META.map((s) => {
        const isCurrent = current.includes(s.id);
        const trackApplicable =
          !track || s.applicableTracks.includes(track) || s.applicableTracks.length === 2;
        return (
          <span
            key={s.id}
            role="link"
            aria-current={isCurrent ? "page" : undefined}
            title={
              !trackApplicable
                ? `${s.name} — 현재 트랙 미적용`
                : `${s.name} — ${s.objective}`
            }
            className={`sizing-step-link ${isCurrent ? "stage-rail-current" : ""} ${!trackApplicable ? "stage-rail-skipped" : ""}`}
            style={!trackApplicable ? { opacity: 0.4, textDecoration: "line-through" } : undefined}
          >
            <span className="sizing-step-num">{s.sequence}</span>
            {s.name}
            {isCurrent && (
              <span className="flex flex-wrap gap-0.5 ml-1">
                {s.gateIds.map((g) => (
                  <span key={g} className="status-chip status-amber" style={{ fontSize: "0.6rem", padding: "0.05rem 0.3rem" }}>
                    {GATE_LABEL[g]}
                  </span>
                ))}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
