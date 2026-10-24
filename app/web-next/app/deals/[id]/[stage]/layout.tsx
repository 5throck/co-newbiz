import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { STAGE_META } from "../../../../lib/stage-meta.ts";

// Per-stage document title (WCAG 2.4.2, R2-A page contract): "S3 시너지·전략적 적합성".
export async function generateMetadata({ params }: { params: Promise<{ stage: string }> }): Promise<Metadata> {
  const { stage } = await params;
  const upper = stage.toUpperCase();
  const id = upper.startsWith("S") ? upper : `S${upper}`;
  const meta = STAGE_META.find((s) => s.id === id);
  const t = await getTranslations("pages.titles");
  return { title: meta ? `${meta.id} ${meta.name}` : t("dealStage") };
}

export default function StageLayout({ children }: { children: ReactNode }) {
  return children;
}
