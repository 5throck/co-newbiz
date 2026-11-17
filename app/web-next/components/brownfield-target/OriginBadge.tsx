"use client";

// Origin badge of an item verdict (ADR-0200 §7.2): text + icon, never color alone. `자동 규칙` = deterministic rule,
// `AI` = AI judgement, `사람` = a person's verdict. Non-human origins are unreviewed until a person saves or confirms.
import { useTranslations } from "next-intl";

export type VerdictOrigin = "human" | "auto_rule" | "ai_draft";

const GLYPH: Record<VerdictOrigin, string> = { auto_rule: "⚙", ai_draft: "✦", human: "☻" };
const LABEL_KEY: Record<VerdictOrigin, string> = {
  auto_rule: "originRule",
  ai_draft: "originAi",
  human: "originHuman",
};

export function OriginBadge({ source, assessedBy }: { source: VerdictOrigin; assessedBy: string | null }) {
  const ta = useTranslations("stages.s67.aiEval");
  const label = ta(LABEL_KEY[source]);
  const tip = [label, source === "human" ? null : ta("originUnreviewed"), assessedBy].filter(Boolean).join(" · ");
  return (
    <span
      className={`status-chip ${source === "human" ? "status-not-started" : "status-amber"}`}
      title={tip}
      data-origin={source}
    >
      <span aria-hidden="true">{GLYPH[source]} </span>
      {label}
    </span>
  );
}
