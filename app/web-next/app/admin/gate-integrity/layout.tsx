import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

// Per-page document title (WCAG 2.4.2, R2-C page contract).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.titles");
  return { title: t("adminGateIntegrity") };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
