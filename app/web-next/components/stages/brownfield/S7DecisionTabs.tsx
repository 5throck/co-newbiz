"use client";

// S7 sub-tabs under the shortlist: 진출 형태 평가 (deal-shape evaluation) and 의사결정 — 승인 기록.
// Rendered on the S7 page only; the shared S6 tab body leaves it out. Only the active tab's panel is mounted.
// The approval tab records target_screening, the S7 shortlist gate. pre_fs is recorded on S6 only
// (ADR-0205, design 2026-11-21-s67-completion-visibility Amendment 2): it is the closing act of S6 and
// S7 opens only after a person said GO — so no pre_fs panel or notice exists on this screen.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { GateDecisionPanel } from "../../GateDecisionPanel.tsx";
import { DealShapePanel } from "../DealShapePanel.tsx";

export function S7DecisionTabs({
  opportunityId,
  canAct,
  s7Blocked = false,
  preFsOnly = false,
  zeroCandidatesPassed,
}: {
  opportunityId: string;
  canAct: boolean;
  /** design 2026-11-21-s67-completion-visibility — S6 criteria unmet (S7 not reached): the deal-shape
   *  buttons pre-disable client-side; the server write guard stays the single enforcement point. */
  s7Blocked?: boolean;
  /** The Pre-FS GO is the only open S6 criterion — the blocked reason links straight to the S6 Pre-FS panel. */
  preFsOnly?: boolean;
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
          <DealShapePanel opportunityId={opportunityId} canAct={canAct} s7Blocked={s7Blocked} preFsOnly={preFsOnly} />
        </div>
      )}
      {tab === "approval" && (
        <div role="tabpanel" id="s7-panel-approval" aria-labelledby="s7-tab-approval">
          {/* the gate panel is a .market-section (2rem top margin); the deal-shape card has none — align the two tab bodies.
              Single gate: pre_fs lives at the end of the S6 body (ADR-0205) — this tab records only the
              target_screening shortlist gate, so no gate select is needed.
              killHint stays target_screening-only (conditional): flow.spec's pre_fs kill criterion ("진출방식이
              결정되지 않았다") belongs to the pre_fs panel now, and target_screening's own criterion
              ("knock-out 통과 후보 0건") is what this hint carries. */}
          <div className="[&>section]:!mt-0">
            <GateDecisionPanel
              opportunityId={opportunityId}
              gates={["target_screening"]}
              killHint={zeroCandidatesPassed ? t("zeroCandidatesPassedTheScreening") : null}
            />
          </div>
        </div>
      )}
    </>
  );
}
