import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

// Per-page document title (WCAG 2.4.2, R2-C page contract) — 2026-10-26 UX
// review F13 (/flows was the one client page rendering a bare title). The root
// layout supplies the "· 신규사업 검토" suffix through its title template,
// rendering "Flow console · {brand}" exactly like pipeline/layout.tsx.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.titles");
  return { title: t("flows") };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
