"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { GF_HEADING_KEY } from "../../lib/label-keys.ts";
import type { ModeState } from "../../lib/establishment-mode-view.ts";
import { StageFrame } from "../StageFrame.tsx";
import { StageTabs } from "../StageTabs.tsx";

/** The S10 head title - shared by deal-structure and every S10 sub-tab so all tabs show the identical head. */
export function useS10Subtitle(isGf: boolean, isBu: boolean): string {
  const tr = useTranslations();
  const t = useTranslations("stages.s10.stage");
  const tc = useTranslations("common");
  return isGf
    ? t("s10P1P2ReviewFunding", { p1: tr(GF_HEADING_KEY.s10Stage), p2: isBu ? tc("newDivisionForm") : tc("establishedEntityForm") })
    : t("s10InvestmentStructureDesignInvesting");
}

/** S10 StageFrame head for the sub-tab pages (debt, incentives, sites, permits). Resolves the
    track/mode the same way DealStructureStage does so the heading is identical. */
export function S10Frame({ projectId }: { projectId: string }) {
  const [isGf, setIsGf] = useState(false);
  const [isBu, setIsBu] = useState(false);
  useEffect(() => {
    let alive = true;
    const base = `/api/projects/${encodeURIComponent(projectId)}`;
    api.get<{ greenfield_scope: unknown | null }>(`${base}/greenfield-scope`)
      .then((r) => {
        if (!alive) return;
        const gf = !!r.data.greenfield_scope;
        setIsGf(gf);
        if (gf) {
          api.get<ModeState>(`${base}/establishment-mode`)
            .then((m) => { if (alive) setIsBu(m.data.active_mode === "business_unit"); })
            .catch(() => { if (alive) setIsBu(false); });
        }
      })
      .catch(() => { if (alive) setIsGf(false); });
    return () => { alive = false; };
  }, [projectId]);
  const heading = useS10Subtitle(isGf, isBu);
  return <StageFrame stageId="S10" subtitle={heading} railSlot={<StageTabs projectId={projectId} />} />;
}
