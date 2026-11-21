"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
// The longlist card (status-filter row + candidate table) lives in LonglistTable.tsx — extracted for
// the stage-decomposition 400-line cap (tests/unit/stage-decomposition.test.ts).
import { SectionToolbar } from "../../layout.tsx";
import { useState } from "react";
import { SECTION_IDS } from "./constants.ts";
import { S6CriteriaPanel } from "./S6CriteriaPanel.tsx";

import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";
import { useTranslations } from "next-intl";
import { AiEvalRunsPanel } from "./AiEvalChips.tsx";
import { estimateBulkStart } from "./aiEvalQueueState.ts";
import { AiEvalCriteriaDialog } from "./AiEvalCriteriaPanel.tsx";
import { AiEvalStartButton } from "./AiEvalStart.tsx";
import { LonglistTable } from "./LonglistTable.tsx";
import { useAiEval } from "./useAiEval.ts";

export function LonglistSection({ ctx }: { ctx: BrownfieldStageState }) {
  const t = useTranslations("stages.s67.longlistSection");
  const {
    selected,
    canAct,
    busy,
    targets,
    shortlistedTargets,
    displayedTargets,
    shortlistOrder,
    evalRank,
    shortlist,
    rerank,
  } = ctx;
  // ADR-0199 — 일괄 AI 평가: 임시(잠정) 초안만 만든다. 확정·순위·승격에는 관여하지 않는다.
  const ai = useAiEval({ oppId: selected?.opportunity.id ?? null, loadDetail: ctx.loadDetail });
  const ta = useTranslations("stages.s67.aiEval");
  // ADR-0200 §5.2: after promoting with unreviewed AI / rule verdicts, say so (the response carries the count).
  const [promoteNote, setPromoteNote] = useState<string | null>(null);
  async function promote(targetId: string) {
    setPromoteNote(null);
    const n = await shortlist(targetId);
    if (n > 0) setPromoteNote(ta("promotedWithUnreviewed", { n }));
  }
  const evalCandidates = targets.filter((x) => x.status !== "excluded");
  return (
    <>
      {selected && (
        <div id={SECTION_IDS.longlist} style={{ scrollMarginTop: "1rem" }}>
          {/* ── S6/S7: 후보 등록 + 후보 전체 목록 + 스크리닝 ── */}
          <section aria-label={t("targetCandidateScreening")} className="market-section">
            {/* 후보 등록 폼은 위 "후보 발굴" 카드에 항상 표시된다(사용자 요청,
              2026-09-15) — 시장·기업 마스터/웹 검색·LLM 제안과 나란히 묶인다. */}

            {/* S7 선정 퍼널·게이트·위원회·승격은 아래 이어지는 섹션에서 계속된다
              (mockup처럼 탭 없이 한 화면 — 사용자 요청, 2026-09-15). */}

            {/* 후보 전체 목록 테이블 — 목표 시장 정의·후보 발굴 카드와 같은 카드 표면으로
              감싸 화면 위계를 맞춘다(UX 정리, 2026-09-15). */}
            <SectionToolbar
              title={t("fullCandidateListJudgementAnd")}
              summary={
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("fullCandidateList")} {targets.length} {t("shortlist")} {shortlistedTargets.length}
                </span>
              }
              actions={
                <>
                  {canAct && (
                    <AiEvalStartButton
                      candidates={evalCandidates.length}
                      dartEligible={evalCandidates.filter((x) => !!x.dart_corp_code).length}
                      estimate={estimateBulkStart(
                        evalCandidates.map((x) => ({ id: x.id, hasDart: !!x.dart_corp_code })),
                        ai.activeRuns,
                      )}
                      busy={ai.busy}
                      onStart={ai.start}
                    />
                  )}
                  {/* ADR-0199 — 평가 기준은 툴바의 모달로 연다(기존 인라인 접기 패널 대체).
                    뷰어도 기준·문구를 읽을 수 있어야 하므로 canAct와 무관하게 항상 렌더한다. */}
                  <AiEvalCriteriaDialog oppId={selected.opportunity.id} canAct={canAct} />
                </>
              }
            />
            {/* ── S6 완료기준 strip — 왜 S7에 못 들어가는지 후보 전체 목록 바로 위에서
                답한다 (design 2026-11-21-s67-completion-visibility Fix ①-a).
                엔진 상태는 BrownfieldStage의 useS6Gate 읽기 하나를 ctx로 공유한다. ── */}
            <S6CriteriaPanel
              gate={ctx.s6Gate}
              targets={targets}
              minLongList={selected.universe?.min_long_list ?? 3}
              stage={ctx.stage}
            />
            {promoteNote && (
              <p role="status" className="text-[length:var(--fs-caption)] mt-0 mb-2">
                <span aria-hidden="true">⚠ </span>
                {promoteNote}
              </p>
            )}
            {ai.notice && (
              <p role="status" className="text-[length:var(--fs-caption)] mt-0 mb-2">
                <span aria-hidden="true">ⓘ </span>
                {ai.notice}
              </p>
            )}
            {ai.message && (
              <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-0 mb-2">
                {ai.message}
              </p>
            )}
            <AiEvalRunsPanel
              activeRuns={ai.activeRuns}
              latest={ai.view}
              canAct={canAct}
              busy={ai.busy}
              onResume={ai.resume}
              onCancel={ai.cancel}
            />
            <LonglistTable
              selected={selected}
              targets={targets}
              displayedTargets={displayedTargets}
              shortlistOrder={shortlistOrder}
              evalRank={evalRank}
              ai={ai}
              canAct={canAct}
              busy={busy}
              promote={promote}
              rerank={rerank}
            />
          </section>
        </div>
      )}
    </>
  );
}
