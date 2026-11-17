"use client";

// Body of the S6 `평가 대상 방향성` card: the direction view for new records, the
// pre-direction definition paragraph (plus a hint) for legacy records — no auto-convert.
import { useTranslations } from "next-intl";
import type { OppDetail } from "./types.ts";
import { UniverseDirectionView } from "./UniverseDirectionView.tsx";

export function UniverseDirectionCard({ universe }: { universe: NonNullable<OppDetail["universe"]> }) {
  const t = useTranslations("stages.s67.directionCard");
  const tu = useTranslations("stages.s67.universeSection");
  if (universe.direction_version === 1 && universe.direction) {
    return (
      <UniverseDirectionView
        direction={universe.direction}
        evidence={universe.evidence ?? []}
        origin={universe.origin}
        drafted={universe.drafted}
        minLongList={universe.min_long_list}
      />
    );
  }
  return (
    <>
      {universe.scope && (
        <p className="mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {tu("coverageScope")} {universe.scope}
        </p>
      )}
      <p className="mb-2 text-[length:var(--fs-body)] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {universe.definition}
      </p>
      <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("legacyHint")}</p>
    </>
  );
}
