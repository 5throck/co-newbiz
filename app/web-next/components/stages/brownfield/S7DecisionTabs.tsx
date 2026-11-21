"use client";

// S7 sub-tabs under the shortlist: 진출 형태 평가 (deal-shape evaluation) and 의사결정 — 승인 기록.
// Rendered on the S7 page only; the shared S6 tab body leaves it out. Only the active tab's panel is mounted.
// The approval tab records both brownfield opportunity gates (defect 2026-11-21: pre_fs had no recording
// surface on this track, yet promotion requires it): pre_fs is the S6→S7 entry gate, target_screening the
// S7 shortlist gate — array order renders pre_fs first (decide entry, then the screening gate).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { GateDecisionPanel } from "../../GateDecisionPanel.tsx";
import { DealShapePanel } from "../DealShapePanel.tsx";

export function S7DecisionTabs({
  opportunityId,
  canAct,
  s7Blocked = false,
  zeroCandidatesPassed,
}: {
  opportunityId: string;
  canAct: boolean;
  /** design 2026-11-21-s67-completion-visibility — S6 criteria unmet (S7 not reached): the deal-shape
   *  buttons pre-disable client-side; the server write guard stays the single enforcement point. */
  s7Blocked?: boolean;
  /** flow.spec target_screening kill criterion: no knock-out survivor (informational hint on the gate panel). */
  zeroCandidatesPassed: boolean;
}) {
  const t = useTranslations("stages.s67.shortlistSection");
  const [tab, setTab] = useState<"dealShape" | "approval">("dealShape");
  return (
    <>
      <div className="library-tabs mb-3" role="tablist" aria-label={t("s7TabsLabel")}>
        {(
          [
            ["dealShape", t("s7TabDealShape")],
            ["approval", t("s7TabApproval")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`s7-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`s7-panel-${key}`}
            className={`library-tab ${tab === key ? "library-tab-active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "dealShape" && (
        <div role="tabpanel" id="s7-panel-dealShape" aria-labelledby="s7-tab-dealShape">
          <DealShapePanel opportunityId={opportunityId} canAct={canAct} s7Blocked={s7Blocked} />
        </div>
      )}
      {tab === "approval" && (
        <div role="tabpanel" id="s7-panel-approval" aria-labelledby="s7-tab-approval">
          {/* the gate panel is a .market-section (2rem top margin); the deal-shape card has none — align the two tab bodies.
              killHint stays target_screening-only (conditional): flow.spec's pre_fs kill criterion ("진출방식이
              결정되지 않았다") cannot fire here — the screen renders only after the S4 route decision fixed the
              brownfield entry route — and pre_fs's human-judged registry criteria surface via the gate snapshot
              acknowledgements below, not a static hint (greenfield's pre_fs panel passes none either). */}
          <div className="[&>section]:!mt-0">
            <GateDecisionPanel
              opportunityId={opportunityId}
              gates={["pre_fs", "target_screening"]}
              killHint={zeroCandidatesPassed ? t("zeroCandidatesPassedTheScreening") : null}
            />
          </div>
        </div>
      )}
    </>
  );
}
