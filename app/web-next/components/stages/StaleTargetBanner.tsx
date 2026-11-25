"use client";

// ADR-0206 / design 2026-11-24-s8-excluded-target-handling §5: the selected or adopted S8 target left the
// Short List. Warning callout (amber, icon + label + text, never colour alone) announced politely as a status.
// The records are never changed here; the banner only tells a person to re-select and re-adopt.
import { useTranslations } from "next-intl";
import type { S8Staleness } from "../../lib/business-case.ts";
import { staleTargetMessages } from "../../lib/s8-stale-target-view.ts";

export function StaleTargetBanner({
  staleness,
  onOpenSelection,
  className = "mb-3",
}: {
  staleness: S8Staleness | null | undefined;
  /** Jumps to the target comparison and selection control (omit where the control is already on screen). */
  onOpenSelection?: () => void;
  className?: string;
}) {
  const t = useTranslations("stages.s8.staleTarget");
  const messages = staleTargetMessages(staleness);
  if (messages.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="stale-target-banner"
      className={`${className} flex flex-col gap-1 border border-[color:var(--amber-border)] bg-[color:var(--amber-bg)] px-3 py-2 text-[color:var(--amber-fg)] rounded-lg`}
    >
      <span className="text-[length:var(--fs-body)] font-semibold">
        <span aria-hidden="true">▲</span> {t("label")}
      </span>
      {messages.map((m) => (
        <p key={m.kind} className="m-0 text-[length:var(--fs-caption)]">
          {/* INTERIM-WORDING */}
          {m.kind === "adoptionMismatch"
            ? t("adoptionMismatch")
            : m.kind === "adoptionExcluded"
              ? t("adoptionExcluded", { name: m.name ?? t("unnamedTarget") })
              : t("selectionExcluded", { name: m.name ?? t("unnamedTarget") })}
        </p>
      ))}
      {onOpenSelection && (
        <div>
          <button type="button" className="btn-ghost btn-sm" onClick={onOpenSelection}>
            {t("openSelection")}
          </button>
        </div>
      )}
    </div>
  );
}
