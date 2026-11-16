"use client";

// Complete-sentence progress wording for the S6 AI evaluation (ADR-0199, 2026-11-16 user report: truncated fragments):
// a run item's state as glyph + text segments, and the elapsed time of a run. Never truncated, never tooltip-only.
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";
import { elapsedParts, parseUtcMs, phaseSegments } from "./aiEvalActive.ts";

/** `✓ 재무 초안 완료 · ⋯ 기술 초안 작성 중(LLM 분석)`: the glyph is decoration, the words carry the state. */
export function PhaseText({ state }: { state: string }) {
  const t = useTranslations("stages.s67.aiEval");
  return (
    <>
      {phaseSegments(state).map((seg, i) => (
        <Fragment key={seg.key}>
          {i > 0 && " · "}
          <span aria-hidden="true">{seg.glyph} </span>
          {t(`rowSeg.${seg.key}`)}
        </Fragment>
      ))}
    </>
  );
}

/** `경과 1분 05초` since the run started; ticks every second while mounted (`nowMs` pins the clock under test). */
export function ElapsedTime({ startedAt, nowMs }: { startedAt?: string | null; nowMs?: number }) {
  const t = useTranslations("stages.s67.aiEval");
  const [now, setNow] = useState(() => nowMs ?? Date.now());
  useEffect(() => {
    if (nowMs !== undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nowMs]);
  const start = parseUtcMs(startedAt);
  if (start === null) return null;
  const p = elapsedParts((nowMs ?? now) - start);
  const time = t(`elapsedUnit.${p.unit}`, {
    h: p.h,
    m: String(p.m).padStart(p.unit === "hm" ? 2 : 1, "0"),
    s: String(p.s).padStart(2, "0"),
  });
  return <span className="tabular-nums">{t("elapsed", { time })}</span>;
}
