"use client";

// ADR-0156 (amended 2026-10-09): per-target analysis selector shared by the WACC,
// financial-analysis and DD pages. Chips are the shared FilterChip (Onyx tokens,
// aria-pressed). Rendered only when more than one shortlisted target exists.
// There is no project-level chip: the default is the S8-selected target (or the
// first shortlisted one), and that target carries the "게이트 기준" marker.

import { FilterChip } from "./ui.tsx";

export interface AnalysisTarget {
  targetId: string;
  name: string;
  companyId: string | null;
  isBound: boolean;
  /** Optional short status badge (ADR-0157: e.g. "DD 미개설"); text, never color alone. */
  note?: string;
}

interface TargetSelectorProps {
  targets: AnalysisTarget[];
  /** Active target id. */
  selected: string | null;
  onSelect: (targetId: string) => void;
  /** Badge on the bound target chip. Default "게이트 기준". */
  boundLabel?: string;
  /** Accessible name of the chip group. Default "분석 대상 선택". */
  ariaLabel?: string;
}

const badge = "ml-1.5 rounded-full border border-current px-1.5 text-[length:var(--fs-caption)] font-normal";

export default function TargetSelector({ targets, selected, onSelect, boundLabel = "게이트 기준", ariaLabel = "분석 대상 선택" }: TargetSelectorProps) {
  if (targets.length <= 1) return null;
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2" data-testid="target-selector">
      {targets.map((t) => (
        <FilterChip
          key={t.targetId}
          selected={selected === t.targetId}
          aria-current={selected === t.targetId ? "true" : undefined}
          title={t.companyId ? undefined : "연결된 회사 데이터가 없어 재무 분석이 제한됩니다."}
          onClick={() => onSelect(t.targetId)}
        >
          {t.name}
          {t.isBound ? <span className={badge}>{boundLabel}</span> : null}
          {t.note ? <span className={badge}>{t.note}</span> : null}
          {!t.companyId ? <span aria-hidden="true"> ·</span> : null}
        </FilterChip>
      ))}
    </div>
  );
}
