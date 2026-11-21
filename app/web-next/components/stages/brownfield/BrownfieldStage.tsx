"use client";

// S6~S7 브라운필드 대상 경로 본문 — ADR-0120 Wave 2 Phase B 추출(/brownfield
// 페이지와 /deals/[id]/s6·s7 탭이 동일 컴포넌트를 소비한다). StageFrame·main
// 셸·기회 선택 칩은 호출자가 제공한다(공통 규칙 #6): 이 컴포넌트는 opportunityId
// 하나에 고정된 작업 화면(목표 시장 정의 → 후보 전체 목록 → 사전 검토 → 최종 후보 목록 →
// 게이트·위원회·승격)을 렌더링한다.
// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { ReviewBuckets } from "../../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../../lib/review/stage-artifact-labels.ts";
import { useBrownfieldBase } from "./useBrownfieldBase.ts";
import { useBrownfieldUniverse } from "./useBrownfieldUniverse.tsx";
import { useBrownfieldTargets } from "./useBrownfieldTargets.ts";
import { useS6Gate } from "./S6CriteriaPanel.tsx";
import { UniverseSection } from "./UniverseSection.tsx";
import { WebDiscoveryPanel, UniverseEditModal } from "./DiscoveryPanels.tsx";
import { LonglistSection } from "./LonglistSection.tsx";
import { ShortlistSection } from "./ShortlistSection.tsx";
import { GateDecisionPanel } from "../../GateDecisionPanel.tsx";
import { PrimaryAction } from "../../ui.tsx";
import { useTranslations } from "next-intl";

/** `stage`: which route renders this body (design 2026-11-21-s67-completion-visibility Amendment 2, ADR-0205).
 * S6 = Universe → Long List (criteria strip + table) → the Pre-FS gate decision panel LAST.
 * S7 = the same read context + 사전 검토·위원회 추천, the deal-shape / approval tabs and the S7→S8 promotion; NO Pre-FS panel.
 * Required: there is no "combined" mode. */
export function BrownfieldStage(props0: { opportunityId: string; onSaved?: () => void; stage: "S6" | "S7" }) {
  const t = useTranslations("stages.s67.brownfieldStage");
  const h0 = useBrownfieldBase(props0);
  const h1 = useBrownfieldUniverse({ ...h0 });
  const h2 = useBrownfieldTargets({ ...h0, ...h1 });
  // design 2026-11-21-s67-completion-visibility — ONE engine-state read for the
  // stage (StageFrame single-read rule): the S6 criteria strip, the Long List
  // gap chips and the deal-shape panel's blocked state all read this object.
  const s6Gate = useS6Gate(props0.opportunityId);
  const { stage } = props0;
  const ctx = { ...h0, ...h1, ...h2, s6Gate, stage };
  const { error, opportunityId, shortlistedTargets, canAct, selected } = ctx;
  return (
    <>
      {stage === "S7" && (shortlistedTargets.length === 0 || !canAct) && (
        <PrimaryAction
          inline
          label={t("runCommitteeRecommendationReview")}
          disabled
          disabledReason={!canAct ? t("requiresTheAnalystRole") : t("runningUnlocksOnceAShortlist")}
        />
      )}
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs(stage)} />

      {/* ── 목표 시장 정의 (S6) — 보기(읽기 전용) / 수정(모달) 분리. mockup처럼
          탭 없이 항상 렌더링, 흐름 배너에서 스크롤로만 이동한다. ── */}
      {/* S6 전용 작성 영역(방향성 카드 + 후보 발굴·등록 카드 + 웹검색/수정 모달). S7은 읽기·판정 화면이라
          렌더하지 않는다(소유자 요청, Amendment 2). useBrownfieldUniverse 훅은 위에서 계속 실행된다 —
          S6CriteriaPanel의 min_long_list와 후보 전체 목록이 universe 상태를 읽는다. */}
      {stage === "S6" && (
        <>
          <UniverseSection ctx={ctx} />

          {/* ── 웹검색 결과 모달 — 검색·선택을 한 화면에서 끝낸다(사용자 요청,
              2026-09-15). 제안 수용은 사람이 항목별로 클릭한다(경계 #2). ── */}
          <WebDiscoveryPanel ctx={ctx} />

          {/* ── 목표 시장 정의 수정 모달 — 취소하면 어떤 값도 반영되지 않는다 ── */}
          <UniverseEditModal ctx={ctx} />
        </>
      )}

      <LonglistSection ctx={ctx} />

      {/* ── S7 선정 퍼널 + 게이트 결정 + 위원회 심의 + 승격(mockup 구조 —
          후보 전체 목록 아래 이어서 렌더링, 탭 없음) ── */}
      <ShortlistSection ctx={ctx} stage={stage} />

      {/* ── Pre-FS 게이트 결정 (S6 전용, 본문 마지막) — S6 완료는 사람이 기록한 Pre-FS GO에 달려 있다
          (ADR-0205). 읽는 순서 = 작업 순서: 기준 확인 → Long List 완성 → 결정. S7 DOM에는 두지 않는다
          (같은 게이트를 두 경로에서 기록하지 않는다). 앵커 id gate-decision-pre_fs는 패널이 내보낸다. ── */}
      {stage === "S6" && selected && <GateDecisionPanel opportunityId={selected.opportunity.id} gates={["pre_fs"]} />}
    </>
  );
}
