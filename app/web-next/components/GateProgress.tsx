"use client";

// Gate progress bar — stages: Screening → Pre-FS → FS → DD → Entity IC → Group IC
// ui-spec §3: icon + label + color together (FR-SYS-05)

const STAGES = [
  { key: "screening", label: "Screening" },
  { key: "pre_fs", label: "Pre-FS" },
  { key: "fs", label: "FS" },
  { key: "dd", label: "DD" },
  { key: "entity_ic", label: "Entity IC" },
  { key: "group_ic", label: "Group IC" },
] as const;

const STAGE_COLORS: Record<string, { bg: string; fg: string }> = {
  screening: { bg: "var(--green-bg)", fg: "var(--green-fg)" },
  pre_fs: { bg: "var(--green-bg)", fg: "var(--green-fg)" },
  fs: { bg: "var(--amber-bg)", fg: "var(--amber-fg)" },
  dd: { bg: "var(--amber-bg)", fg: "var(--amber-fg)" },
  entity_ic: { bg: "var(--primary-bg)", fg: "var(--primary-fg)" },
  group_ic: { bg: "var(--accent-bg)", fg: "var(--accent-fg)" },
};

export function GateProgress({ currentStage }: { currentStage?: string | null }) {
  const currentIdx = STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="gate-progress" role="progressbar" aria-valuenow={currentIdx + 1} aria-valuemin={1} aria-valuemax={STAGES.length}>
      <div className="gate-bar">
        {STAGES.map((stage, idx) => {
          const isComplete = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const color = STAGE_COLORS[stage.key];
          return (
            <div
              key={stage.key}
              className={`gate-step ${isComplete ? "complete" : ""} ${isCurrent ? "current" : ""}`}
              style={{
                backgroundColor: isComplete || isCurrent ? color.bg : undefined,
                color: isComplete || isCurrent ? color.fg : undefined,
              }}
            >
              <span className="gate-step-label">{stage.label}</span>
            </div>
          );
        })}
      </div>
      <span className="gate-current-label">
        {currentIdx >= 0 ? STAGES[currentIdx].label : "미정"}
      </span>
    </div>
  );
}
