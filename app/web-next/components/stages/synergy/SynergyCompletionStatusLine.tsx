"use client";

// S3 completion status line — design 2026-11-07-s3-completion-into-decision-tab §2, as amended.
// Rendered ONLY while S3 is not complete: one compact role="status" row above the tabs with a ghost jump link
// to the decision tab (information only, never a primary). Once complete the state is a status chip in the
// report header chip row (SynergyResult) — no standalone row — and the way forward is the standard
// handoff-cta in the StageHandoffStrip (StageFrame), never a second S4 button here.
import { useTranslations } from "next-intl";

export function SynergyCompletionStatusLine(props: { onJumpToDecision: () => void }) {
  const t = useTranslations("stages.s3.synergySelectPanel");
  return (
    <div role="status" className="completion-line" data-testid="s3-completion-status">
      <span aria-hidden="true">○</span>
      <span>{t("statusLinePending")}</span>
      <button type="button" className="btn-ghost btn-sm" onClick={props.onJumpToDecision}>
        {t("statusLineJump")}
      </button>
    </div>
  );
}
