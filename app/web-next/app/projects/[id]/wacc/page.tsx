"use client";

// S8 WACC 입력 세션 — thin wrapper route kept alive for deep-link
// compatibility (bookmarks, external links). The actual UI now lives in
// components/wacc/WaccPanel.tsx and is also embedded as a tab inside
// business-case/page.tsx (?tab=wacc) — this route renders the same panel
// standalone so old links keep working.
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { WaccPanel } from "../../../../components/wacc/WaccPanel.tsx";

export default function ProjectWaccPage() {
  const t = useTranslations("pages.projects.wacc");
  const { id: projectId } = useParams<{ id: string }>();
  return (
    <main className="market-page">
      <StageTabs projectId={projectId} />
      <StageFrame stageId="S8" heading={t("heading")}>
        <WaccPanel projectId={projectId} />
      </StageFrame>
    </main>
  );
}
