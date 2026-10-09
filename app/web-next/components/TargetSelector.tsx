"use client";

// ADR-0156: per-target analysis selector shared by the WACC and
// financial-analysis pages. FilterChip pattern (same rounded-full border
// chips as the WACC kdMode buttons); rendered only when more than one
// shortlisted target exists — a single-target project has no choice to make.
// The project-level chip ("프로젝트 기준") keeps the ADR-0116 gate view; the
// isBound target is marked so the user can tell which chip matches the
// gate-feeding binding.

export interface AnalysisTarget {
  targetId: string;
  name: string;
  companyId: string | null;
  isBound: boolean;
}

interface TargetSelectorProps {
  targets: AnalysisTarget[];
  /** null = project-level (ADR-0116 bound subject / fs-gate view). */
  selected: string | null;
  onSelect: (targetId: string | null) => void;
}

const chipBase =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus,theme(colors.blue.500))]";
const chipIdle =
  "border-[var(--border-secondary,theme(colors.gray.300))] bg-[var(--bg-secondary,theme(colors.white))] text-[var(--text-secondary,theme(colors.gray.700))] hover:border-[var(--border-strong,theme(colors.gray.400))]";
const chipActive =
  "border-[var(--color-primary,theme(colors.blue.600))] bg-[var(--color-primary-soft,theme(colors.blue.50))] font-medium text-[var(--color-primary,theme(colors.blue.700))]";

export default function TargetSelector({ targets, selected, onSelect }: TargetSelectorProps) {
  if (targets.length <= 1) return null;
  return (
    <div
      role="group"
      aria-label="분석 대상 선택"
      className="flex flex-wrap items-center gap-2"
      data-testid="target-selector"
    >
      <button
        type="button"
        className={`${chipBase} ${selected === null ? chipActive : chipIdle}`}
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        프로젝트 기준
      </button>
      {targets.map((t) => (
        <button
          key={t.targetId}
          type="button"
          className={`${chipBase} ${selected === t.targetId ? chipActive : chipIdle}`}
          aria-pressed={selected === t.targetId}
          aria-current={selected === t.targetId ? "true" : undefined}
          title={t.companyId ? undefined : "연결된 회사 데이터가 없어 재무 분석이 제한됩니다."}
          onClick={() => onSelect(t.targetId)}
        >
          {t.name}
          {t.isBound ? (
            <span className="rounded-full bg-[var(--color-primary-soft,theme(colors.blue.100))] px-1.5 text-[length:var(--fs-caption)]">
              게이트 기준
            </span>
          ) : null}
          {!t.companyId ? <span aria-hidden="true">·</span> : null}
        </button>
      ))}
    </div>
  );
}
