import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

// Per-page document title (WCAG 2.4.2, R2-A page contract). The root layout
// supplies the "· 신규사업 검토" suffix through its title template.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.titles");
  return { title: t("dealsBoard") };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
