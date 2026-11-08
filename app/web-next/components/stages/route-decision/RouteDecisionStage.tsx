"use client";

// S4 진출방식 결정 — 목업 v5 baseline(docs/designs/mockups/baseline-v5.html
// id="s4") 구조로 재작성. /deals/[id]/s4에 마운트되며 opportunityId는 URL의
// [id]로 고정된다(목업처럼 검토/안건 하나를 바로 보여준다 — 전역 기회 선택 칩 없음).
//
// 로직은 기존 /route-decision 화면(flow.spec v2.0.0, ADR-0052/0086/0104/0097)
// 그대로 유지한다 — 이 재작성은 시각 언어(.card/.control-chip)와 스코프(단일
// 검토/안건)만 목업에 맞춘다. 원칙(경계 #2, CLAUDE.md 2026-09-11 개정): 최종 결정은
// 사람이 기록하며, 화면은 LLM 정보·추천을 적극 제공한다 — "LLM 추천" 섹션이
// 그 구현이고, 산출물은 제안일 뿐 결정 기록(POST /route-decision)은 사람의 몫.
// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import { ReviewBuckets } from "../../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../../lib/review/stage-artifact-labels.ts";
import { Tabs, PrimaryAction } from "../../ui.tsx";
import { CommitteePanel } from "../../CommitteePanel.tsx";
import { useRouteDecision } from "./useRouteDecision.ts";
import { FactGrid } from "./FactGrid.tsx";
import { DecisionTab } from "./DecisionTab.tsx";
import { CompetitiveTab } from "./CompetitiveTab.tsx";
import { EvalTab } from "./EvalTab.tsx";
import { useTranslations } from "next-intl";

export function RouteDecisionStage(props0: {
  opportunityId: string;
  rationaleParam?: string | null;
  tabParam?: string | null;
}) {
  const t = useTranslations("stages.s4.routeDecisionStage");
  const tc = useTranslations("common");
  const h0 = useRouteDecision(props0);
  const ctx = { ...h0 };
  const {
    opportunityId,
    selected,
    advisory,
    tab,
    setTab,
    error,
    savedNotice,
    confirmDialog,
    notFound,
    canAct,
    canSubmit,
    saving,
  } = ctx;

  if (notFound) {
    return (
      <>
        <PrimaryAction
          inline
          label={tc("routeProposalHumanConfirm")}
          disabled
          disabledReason={t("noSelectedOpportunitySoA")}
        />
        <div className="card">
          <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
            {t("noSelectedOpportunityFoundOnly")}{" "}
            {/* 리뷰 2026-10-22 (저니 F5): 막다른 글이 아니라 이전 단계로 돌아가는 링크를 제공한다.
              품평회 잔여 #4 — next/link로 SPA 내비게이션 유지. */}
            <Link
              className="text-[length:var(--fs-body)] underline"
              href={`/deals/${encodeURIComponent(opportunityId)}/s3`}
            >
              {t("goToS3SynergyAnd")}
            </Link>
          </p>
        </div>
      </>
    );
  }

  if (!selected) {
    return (
      <>
        <PrimaryAction
          inline
          label={tc("routeProposalHumanConfirm")}
          disabled
          disabledReason={t("proposalsUnlockOnceTheDeal")}
        />
        <div className="card">
          <p>{tc("loading")}</p>
        </div>
      </>
    );
  }
  const proposeBlocked = !canAct || saving || !canSubmit;
  const proposeReason = !canAct
    ? t("theRouteDecisionRequiresThe")
    : saving
      ? t("confirming")
      : t("onceScoringEvidenceAndAlternatives");
  return (
    <>
      {tab === "decision" ? (
        <PrimaryAction
          inline
          form="route-form"
          label={tc("routeProposalHumanConfirm")}
          disabled={proposeBlocked}
          disabledReason={proposeReason}
        />
      ) : (
        <PrimaryAction
          inline
          label={tc("routeProposalHumanConfirm")}
          onClick={() => setTab("decision")}
          disabled={proposeBlocked}
          disabledReason={proposeReason}
        />
      )}
      <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S4")} />
      {/* ── 진출방식 추천 — 탭 밖 상시 노출 (2026-09-14 재설계). 예전엔 이 카드와
          "의사결정" 탭 안의 룰 기반 추천이 서로 다른 표면에서 겹치는 얘기를 했다.
          이제 신호(항상 있음) → AI 서술(선택, 신호를 풀어씀) 하나의 위계로 통합한다.
          "제안" 칩은 기존 status-chip 클래스만 재사용 — 새 CSS 없음. ── */}
      <FactGrid ctx={ctx} selected={selected} />
      {selected && advisory === null && (
        <div className="card" id="reco-card">
          <h2>{t("routeRecommendation")}</h2>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
            {t("failedToLoadTheRecommendation")}
          </p>
        </div>
      )}

      <Tabs
        label={t("s4DecisionTab")}
        active={tab}
        onSelect={(k) => setTab(k as typeof tab)}
        tabs={[
          { key: "competitive", label: tc("competitiveStructure") },
          { key: "eval", label: t("evaluationEvidence") },
          { key: "committee", label: t("committeeDeliberation") },
          { key: "decision", label: tc("decision") },
        ]}
      />

      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {savedNotice && (
        // 리뷰 2026-10-22 (저니 F5): 결정 기록 직후의 전진 큐 — 엔진 nextStage의
        // 스킵 semantics와 동일(greenfield→S5, brownfield→S6).
        <p role="status" className="text-[length:var(--fs-body)]">
          {t("decisionRecordedNext")}{" "}
          <Link
            className="underline"
            href={`/deals/${encodeURIComponent(opportunityId)}/s${savedNotice.track === "brownfield" ? "6" : "5"}`}
          >
            {savedNotice.track === "brownfield" ? t("s6TargetCandidateDiscovery") : t("s5GreenfieldEntry")}
          </Link>{" "}
          →
        </p>
      )}

      {/* ── 의사결정 탭: 트랙·라우트·의도 선택 + 근거 + 저장 (채점은 별도 탭) ── */}
      <DecisionTab ctx={ctx} selected={selected} />

      {/* ── 경쟁 구조 탭 (2026-09-14, 평가 근거에서 분리): S1 경쟁 구조 근거만
          단독으로 — 신호별 근거·필요 역량 수준·채점과 섞이지 않게 별도 탭으로 둔다. ── */}
      <CompetitiveTab ctx={ctx} selected={selected} />

      {/* ── 평가 근거 탭 (2026-09-14 재설계): 신호별 근거·필요 역량 수준·5기준 채점 —
          감사 가능한 형태 그대로 유지한다(삭제하지 않음). 경쟁 구조는 별도
          탭으로 분리했다. 위 "진출방식 추천" 카드는 이 근거를 요약한 것이고,
          이 탭은 "왜 이 딜이 이 점수를 받았는가"의 전체 근거다. 역량 결정성·
          시장 불확실성 두 5기준이 바로 이 근거를 인용해 채점하므로 근거와
          채점을 한 탭에 둔다. ── */}
      <EvalTab ctx={ctx} selected={selected} />

      {/* ── 위원회 심의 탭 (ADR-0097) — 에이전트는 제안, 확정은 인간 ── */}
      {tab === "committee" && (
        <div className="card">
          <CommitteePanel
            opportunityId={selected.id}
            committeeKey="route-steering-committee"
            committeeLabel={t("s4RouteSteeringCommittee")}
            gates={["pre_fs"]}
          />
        </div>
      )}

      {confirmDialog}
    </>
  );
}
