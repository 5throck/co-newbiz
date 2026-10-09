"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { ListBackButton } from "../../ListBackButton.tsx";
import { PrimaryAction } from "../../ui.tsx";
import { GateDecisionPanel } from "../../GateDecisionPanel.tsx";
import { useSynergyResult } from "./useSynergyResult.ts";
import { SynergyOverviewTab, SynergyShortlistTab } from "./SynergyTabs.tsx";
import { SynergyLinkageTab } from "./SynergyLinkageTab.tsx";
import { targetLabel, STEP_TITLES, TABS } from "./synergyFormat.ts";
import type { SynergyAnalysis } from "./types.ts";
import type { TabKey } from "./synergyFormat.ts";

export function SynergyResult(props0: {
  analysis: SynergyAnalysis;
  tab: TabKey;
  onTab: (k: TabKey) => void;
  onBack: () => void;
  onRerun: () => void;
  onRefresh: () => void;
}) {
  const h0 = useSynergyResult(props0);
  const ctx = { ...h0 };
  const { analysis, analysisDate, latest, synState, onBack, canCurate, inProgress, onRerun, p, tab, onTab, opportunityId, advanceToRouteDecision, advanceError, confirmForm, confirmSaving, confirmSynergyScore } = ctx;
  return (
    <section aria-label="시너지 정합성 리포트" className="market-section sizing-step">
      <PrimaryAction
        label={confirmSaving ? "저장 중..." : "적합성 평가 저장"}
        onClick={confirmSynergyScore}
        disabled={!canCurate || !opportunityId || confirmSaving || confirmForm.score === ""}
        disabledReason={
          !canCurate ? "적합성 평가 저장은 analyst 권한이 필요합니다."
            : !opportunityId ? "기회와 연결된 분석에서만 저장할 수 있습니다."
            : confirmSaving ? "저장 중입니다."
            : "개요 탭에서 점수(0~100)를 입력하면 저장할 수 있습니다."
        }
      />
      <SectionToolbar
        title={`${targetLabel(analysis)} 시너지 정합성 분석`}
        icon=""
        summary={
          <span className="flex items-center gap-1">
            <span className="section-meta">S3 시너지 영역 선별 · 분석일 {analysisDate} · v{latest?.version_no ?? analysis.latest_version ?? 1}</span>
            {analysis.opportunity_name && <span className="status-chip status-in-progress" title={`연결 기회: ${analysis.opportunity_name}`}>기회: {analysis.opportunity_name}</span>}
            {(() => {
              const score = synState?.synergyScore ?? (typeof latest?.payload?.synergyScore === "number" ? latest.payload.synergyScore : null);
              if (typeof score !== "number") return null;
              // 경계 #2 — 권고(미확정)와 사람 확정을 같은 스타일로 보이지 않는다.
              return synState?.confirmed
                ? <span className="status-chip status-green" title={`사람 확정${synState.confirmedAt ? ` — ${synState.confirmedAt.slice(0, 10)}` : ""}`}>synergy 확정 {score}</span>
                : <span className="status-chip status-amber" title="사람 확정 전 권고값 — 확정해야 S4 트랙 근거로 인정됩니다">synergy 권고(미확정) {score}</span>;
            })()}
          </span>
        }
        actions={
          <>
            <ListBackButton onClick={onBack} />
            {canCurate && (
              <button type="button" className="btn-ghost" disabled={inProgress} onClick={onRerun}>
                재분석
              </button>
            )}
          </>
        }
      />

      {inProgress && (
        <p className="text-[length:var(--fs-body)]" role="status">
          분석 중 ({analysis.current_step}/5단계) — {STEP_TITLES[analysis.current_step] ?? ""} 진행 중입니다. 완료되면 자동 갱신됩니다.
        </p>
      )}
      {!p && !inProgress && <p className="text-[color:var(--muted-fg)] italic">분석 결과가 없습니다.</p>}

      {p && (
        <>
          <div className="library-tabs" role="tablist" aria-label="리포트 섹션">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`library-tab ${tab === key ? "library-tab-active" : ""}`} onClick={() => onTab(key)}>
                {label}
              </button>
            ))}
          </div>

          <SynergyOverviewTab ctx={ctx} p={p} />

          <SynergyLinkageTab ctx={ctx} p={p} />

          <SynergyShortlistTab ctx={ctx} p={p} />

          {tab === "refs" && (
            <div className="text-[0.88rem]">
              {p.researchSources.length > 0 && (
                <details className="market-section">
                  <summary className="cursor-pointer text-[length:var(--fs-body)]">입수 출처 ({p.researchSources.length}건 — 출처 명기·교차검증)</summary>
                  <ul className="sizing-note-list mt-2">
                    {p.researchSources.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="market-section">
                <summary className="cursor-pointer text-[length:var(--fs-body)]">파이프라인 단계별 노트 ({p.stepSummaries.length}단계)</summary>
                <ol className="mt-3 space-y-2 text-[length:var(--fs-body)]">
                  {p.stepSummaries.map((s) => (
                    <li key={s.step}><strong>{s.step}. {s.title}</strong> <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>{s.source === "llm" ? "AI" : "시스템"}</span><br />{s.summary}</li>
                  ))}
                </ol>
              </details>
            </div>
          )}

          {/* Screening gate — flow.spec S1~S3 gates: [screening]. 탭 어디에 있든
              같은 자리에서 기록할 수 있게 탭 판 바깥(상세 하단 고정)에 둔다
              (2026-09-18 사용자 리뷰: 우선 시너지 영역 탭 맨 아래에 묻힌 것은
              발견 가능성 문제). S3 산출물이 모이는 이 화면에서 GO/HOLD/KILL을
              기록한다 (ADR-0094 경계 #2: 기록 버튼은 사람의 몫). GO 기록이 곧
              S4 진행 결정이므로, 별도 "S4로 진행" 버튼 없이 GO 기록 시 바로
              opportunity를 selected로 표시하고 /route-decision으로 이동한다. */}
          {opportunityId && (
            <div className="mt-4">
              <GateDecisionPanel
                opportunityId={opportunityId}
                gates={["screening"]}
                onRecorded={(decision, gate) => {
                  if (decision === "go" && gate === "screening") void advanceToRouteDecision();
                }}
              />
              <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                GO로 기록하면 이 검토/안건이 "selected"로 표시되고 S4 진출방식 결정으로 자동 이동합니다.{" "}
                <a href={`/deals/${encodeURIComponent(opportunityId)}/s4`} className="text-[color:var(--accent)] underline">
                  지금 바로 S4로 이동 →
                </a>
              </p>
            </div>
          )}
          {advanceError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1">{advanceError}</p>}
        </>
      )}
    </section>
  );
}
