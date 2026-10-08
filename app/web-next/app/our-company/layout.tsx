import type { Metadata } from "next";
import type { ReactNode } from "react";

// Per-page document title (WCAG 2.4.2, R2-A page contract). The root layout
// supplies the "· 신규사업 검토" suffix through its title template.
export const metadata: Metadata = { title: "S3 그룹/계열사 분석" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
