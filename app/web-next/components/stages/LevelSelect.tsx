"use client";

// Shared 5-step capability level picker (ADR-0168): 없음 / 기초 / 실무 / 숙련 / 선도.
// A legacy free-text value (anything off the scale) stays visible as an extra
// option and as a caption until someone picks a step — it is never deleted silently.
import { LEVEL_SCALE, isLegacyLevelText } from "../../lib/capability-gap.ts";

export function LevelSelect({ value, onChange, ariaLabel, disabled }: { value: string; onChange: (v: string) => void; ariaLabel: string; disabled?: boolean }) {
  const legacy = isLegacyLevelText(value);
  return (
    <>
      <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="sizing-new-input sizing-new-input-sm">
        <option value="">미판정</option>
        {legacy && <option value={value}>기존 입력: {value}</option>}
        {LEVEL_SCALE.map((l) => <option key={l.step} value={l.label}>{l.step}. {l.label}</option>)}
      </select>
      {legacy && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기존 입력(척도 밖): {value}</span>}
    </>
  );
}
