"use client";

// /admin/business-targets (ADR-0114) — group-common and affiliate-specific
// business-target standards consumed by the fs-gate evidence table. Admin-only
// surface wiring the (previously unwired) BusinessTargetsSection component.
import { useTranslations } from "next-intl";
import { BusinessTargetsSection } from "../../../components/admin/BusinessTargetsSection.tsx";

export default function AdminBusinessTargetsPage() {
  const t = useTranslations("admin.businessTargetsPage");
  return (
    <main>
      <h1>{t("h1")}</h1>
      <p className="objective">
        {t("intro")}
      </p>
      <BusinessTargetsSection />
    </main>
  );
}
