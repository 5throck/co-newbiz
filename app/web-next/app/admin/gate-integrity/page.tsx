"use client";

// /admin/gate-integrity - gate integrity KPIs G1-G12 for the system-operator seat. Admin only (app/admin/layout.tsx).
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../components/layout.tsx";
import { ReconfirmCreateForm } from "../../../components/admin/ReconfirmCreateForm.tsx";
import { GateIntegrityKpiSection } from "../../../components/admin/GateIntegrityKpiSection.tsx";

export default function AdminGateIntegrityPage() {
  const t = useTranslations("admin.gateIntegrity");
  return (
    <main className="admin-console-page">
      <PageHeader title={t("h1")} description={t("intro")} />
      <GateIntegrityKpiSection />
      <ReconfirmCreateForm />
    </main>
  );
}
