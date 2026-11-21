"use client";

// S7-only pointer to the S6 authoring surfaces (design 2026-11-21-s67-completion-visibility Amendment 3).
// Relative href: on S7 it resolves to the sibling /deals/{routeId}/s6 route (the route id may be a carrier
// id, not the opportunity id) — same convention as the criteria strip's Pre-FS link.
import { useTranslations } from "next-intl";
import { SECTION_IDS } from "./constants.ts";

export function S7AuthoringHint() {
  const t = useTranslations("stages.s67.s7AuthoringHint");
  return (
    <p className="s67-criteria-sub mb-0" data-testid="s7-authoring-hint">
      {t("text")} ·{" "}
      <a href={`s6#${SECTION_IDS.universe}`} data-testid="s7-authoring-hint-link">
        {t("link")} <span aria-hidden="true">→</span>
      </a>
    </p>
  );
}
