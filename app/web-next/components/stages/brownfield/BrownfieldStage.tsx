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
import { UniverseSection } from "./UniverseSection.tsx";
import { WebDiscoveryPanel, UniverseEditModal } from "./DiscoveryPanels.tsx";
import { LonglistSection } from "./LonglistSection.tsx";
import { ShortlistSection } from "./ShortlistSection.tsx";
import { PrimaryAction } from "../../ui.tsx";
import { useTranslations } from "next-intl";

/** `dealShapePanel`: mount the "진출 형태 평가" panel (ADR-0195 — recorded at the end of S7, after the short list is ranked). The /deals/[id]/s6 tab shares this body and leaves it off. */
export function BrownfieldStage(props0: { opportunityId: string; onSaved?: () => void; dealShapePanel?: boolean }) {
  const t = useTranslations("stages.s67.brownfieldStage");
  const h0 = useBrownfieldBase(props0);
  const h1 = useBrownfieldUniverse({ ...h0 });
  const h2 = useBrownfieldTargets({ ...h0, ...h1 });
  const ctx = { ...h0, ...h1, ...h2 };
  const { error, opportunityId, shortlistedTargets, canAct } = ctx;
  return (
    <>
      {(shortlistedTargets.length === 0 || !canAct) && (
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
      <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S6", "S7")} />

      {/* ── 목표 시장 정의 (S6) — 보기(읽기 전용) / 수정(모달) 분리. mockup처럼
          탭 없이 항상 렌더링, 흐름 배너에서 스크롤로만 이동한다. ── */}
      <UniverseSection ctx={ctx} />

      {/* ── 웹검색 결과 모달 — 검색·선택을 한 화면에서 끝낸다(사용자 요청,
          2026-09-15). 제안 수용은 사람이 항목별로 클릭한다(경계 #2). ── */}
      <WebDiscoveryPanel ctx={ctx} />

      {/* ── 목표 시장 정의 수정 모달 — 취소하면 어떤 값도 반영되지 않는다 ── */}
      <UniverseEditModal ctx={ctx} />

      <LonglistSection ctx={ctx} />

      {/* ── S7 선정 퍼널 + 게이트 결정 + 위원회 심의 + 승격(mockup 구조 —
          후보 전체 목록 아래 이어서 렌더링, 탭 없음) ── */}
      <ShortlistSection ctx={ctx} dealShapePanel={props0.dealShapePanel === true} />
    </>
  );
}
