"use client";

// S6 완료기준 strip (design 2026-11-21-s67-completion-visibility Fix ①-a) — the
// three S6 completion criteria (universe 정의 / 필수 속성·출처 / 최소 커버리지),
// the coverage fraction, and the cure hint, rendered inside the Long List
// section so "why is S7 locked" is answered on the screen where the work
// happens. One engine-state read feeds everything: `useS6Gate` fetches
// GET /api/opportunities/{id}/process ONCE and is called in BrownfieldStage
// (StageFrame single-read rule) — the same state drives the per-candidate gap
// chips and the deal-shape panel's pre-emptive disabled state.
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../../lib/api.ts";
import { localizeBlocker } from "../../../lib/labels.ts";
import type { TargetRow } from "./types.ts";

/** stages[] entry of GET /api/opportunities/{id}/process (design §API A). */
interface ProcessStageEntry {
  id: string;
  status: string;
  /** Korean engine prose, index-aligned with `missing`. */
  blockers?: string[];
  /** Stable blocker keys (lib/process-blocker-keys.ts), index-aligned with `blockers`. */
  missing?: string[];
}

interface ProcessResponse {
  terminated?: boolean;
  stages: ProcessStageEntry[];
}

/** Shared S6 gate state: the criteria strip, the Long List chips and the deal-shape panel all read this one object. */
export interface S6GateState {
  /** The process read succeeded (false = fail-quiet: the strip hides, buttons stay enabled — the server guard stays the enforcement point). */
  ready: boolean;
  terminated: boolean;
  /** "complete" | "current" | "locked" | "skipped" | "terminated" | null (stage not found). */
  s6Status: string | null;
  s6Missing: string[];
  s6Blockers: string[];
  /** S7 not reached (S6 not complete) — the deal-shape buttons pre-disable. Stale state is still caught by the server guard. */
  s7Blocked: boolean;
}

export const EMPTY_S6_GATE: S6GateState = {
  ready: false,
  terminated: false,
  s6Status: null,
  s6Missing: [],
  s6Blockers: [],
  s7Blocked: false,
};

function gateFromProcess(data: ProcessResponse): S6GateState {
  const s6 = data.stages.find((s) => s.id === "S6");
  const terminated = data.terminated === true;
  return {
    ready: true,
    terminated,
    s6Status: s6?.status ?? null,
    s6Missing: s6?.missing ?? [],
    s6Blockers: s6?.blockers ?? [],
    s7Blocked: !terminated && (s6?.status ?? null) !== "complete",
  };
}

/** ONE fetch per stage view (StageFrame single engine-state read rule). A failed read leaves the empty state — fail-quiet. */
export function useS6Gate(opportunityId: string): S6GateState {
  const [gate, setGate] = useState<S6GateState>(EMPTY_S6_GATE);
  useEffect(() => {
    if (!opportunityId) return;
    let alive = true;
    setGate(EMPTY_S6_GATE);
    api
      .get<ProcessResponse>(`/api/opportunities/${encodeURIComponent(opportunityId)}/process`)
      .then((r) => {
        if (alive) setGate(gateFromProcess(r.data));
      })
      .catch(() => {
        if (alive) setGate(EMPTY_S6_GATE);
      });
    return () => {
      alive = false;
    };
  }, [opportunityId]);
  return gate;
}

// The three S6 criteria, in engine push order (lib/process-flow.ts S6 branch).
// Row state comes from the stage's `missing` keys; the criterion NAME resolves
// through the same processBlockers catalog localizeBlocker uses (single source).
const S6_CRITERIA = [
  { key: "s6.target_universe", catalogKey: "processBlockers.s6_target_universe" },
  { key: "s6.longlist_attributes", catalogKey: "processBlockers.s6_longlist_attributes" },
  { key: "s6.longlist_coverage", catalogKey: "processBlockers.s6_longlist_coverage" },
] as const;

/** Coverage = candidates with no gaps (longListCandidateGaps output verbatim); grandfathered rows carry `[]`, so the fraction degrades to the registered count, matching the engine. */
export const s6Coverage = (
  targets: Array<Pick<TargetRow, "gaps">>,
  minLongList: number,
): { covered: number; min: number; registered: number; qualified: number } => {
  const qualified = targets.filter((t) => (t.gaps ?? []).length === 0).length;
  return { covered: qualified, min: minLongList, registered: targets.length, qualified };
};

export type S6GapChipKey = "gapAttributes" | "gapSource" | "gapAttributesSource";

/** Long List chip text by gap composition (design Fix ①-b) — i18n key under `stages.s67.longlistSection`. */
export function s6GapChipKey(gaps: Array<"attributes" | "source">): S6GapChipKey {
  const hasAttr = gaps.includes("attributes");
  const hasSource = gaps.includes("source");
  return hasAttr && hasSource ? "gapAttributesSource" : hasAttr ? "gapAttributes" : "gapSource";
}

/** design Fix ①-b — the per-candidate unqualified chip: a label-cell subline (the exclusion_reason slot
 * pattern) styled as an amber RAG chip (icon + text, never color-only), LINKING to the detail edit form
 * where the gaps can be cured. Excluded rows keep the chip (history is information). */
export function LonglistGapChip({
  targetId,
  companyName,
  gaps,
}: {
  targetId: string;
  companyName: string;
  gaps: Array<"attributes" | "source">;
}) {
  const t = useTranslations("stages.s67.longlistSection");
  const gapText = t(s6GapChipKey(gaps));
  return (
    <div className="text-[length:var(--fs-caption)] mt-0.5">
      <a
        href={`/brownfield/targets/${encodeURIComponent(targetId)}?edit=1`}
        className="status-chip status-amber longlist-gap-chip"
        data-gaps={gaps.join(",")}
        aria-label={t("gapChipAria", { company: companyName, gap: gapText })}
      >
        <span aria-hidden="true">⚠</span> {gapText}
      </a>
    </div>
  );
}

export function S6CriteriaPanel({
  gate,
  targets,
  minLongList,
}: {
  gate: S6GateState;
  targets: TargetRow[];
  minLongList: number;
}) {
  const tr = useTranslations();
  const t = useTranslations("stages.s67.criteriaPanel");
  const headingId = useId().replace(/:/g, "");
  // Fail-quiet: no engine read, or a killed process (nothing left to complete), or a
  // stage the engine did not evaluate (locked/skipped — `missing` is [] there by
  // contract, which is absence of evaluation, not evidence of completion).
  if (!gate.ready || gate.terminated || (gate.s6Status !== "complete" && gate.s6Status !== "current")) {
    return null;
  }
  const missing = new Set(gate.s6Missing);
  const allMet = gate.s6Missing.length === 0;
  const coverage = s6Coverage(targets, minLongList);
  const anyGaps = coverage.qualified < coverage.registered;
  return (
    <section
      id="s6-criteria"
      aria-labelledby={`${headingId}-h`}
      className="s67-criteria"
      style={{ scrollMarginTop: "1rem" }}
      data-testid="s6-criteria-panel"
      data-all-met={allMet ? "true" : "false"}
    >
      <h3 id={`${headingId}-h`} className="s67-criteria-heading">
        {t("heading")}
      </h3>
      {allMet ? (
        <p className="s67-criteria-allmet mb-0">
          <span className="status-chip status-green">
            <span aria-hidden="true">✓</span>
            <span className="sr-only">{t("srMet")}</span>
          </span>{" "}
          {t("allMet")}
        </p>
      ) : (
        <ul className="s67-criteria-list">
          {S6_CRITERIA.map((criterion) => {
            const open = missing.has(criterion.key);
            // Pair the engine prose by index (§ API A pins blockers[i] ↔ missing[i]) — never parse prose to find state.
            const proseIdx = open ? gate.s6Missing.indexOf(criterion.key) : -1;
            const prose = proseIdx >= 0 ? gate.s6Blockers[proseIdx] : undefined;
            return (
              <li
                key={criterion.key}
                className="s67-criteria-row"
                data-criterion={criterion.key}
                data-open={open ? "true" : "false"}
              >
                <div className="s67-criteria-head">
                  <span className={`status-chip ${open ? "status-amber" : "status-green"}`}>
                    <span aria-hidden="true">{open ? "✕" : "✓"}</span>
                    <span className="sr-only">{open ? t("srOpen") : t("srMet")}</span>{" "}
                    {open ? t("openChip") : t("metChip")}
                  </span>
                  <span className="s67-criteria-name">{tr(criterion.catalogKey)}</span>
                </div>
                {prose && <p className="s67-criteria-sub mb-0">{localizeBlocker((k) => tr(k), prose, "S6")}</p>}
                {criterion.key === "s6.longlist_coverage" && (
                  <p className="s67-criteria-sub mb-0">
                    {t("coverageLine", { covered: coverage.covered, min: coverage.min })}
                    {coverage.qualified !== coverage.registered &&
                      ` · ${t("qualifiedNote", { qualified: coverage.qualified, registered: coverage.registered })}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!allMet && anyGaps && (
        <p className="s67-criteria-sub s67-criteria-cure mb-0">
          <span aria-hidden="true">ⓘ </span>
          {t("cureHint")}
        </p>
      )}
    </section>
  );
}
