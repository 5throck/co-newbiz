"use client";

// /admin/gate-integrity - gate integrity KPIs G1-G12 for the system-operator seat. Admin only (app/admin/layout.tsx).
import { useTranslations } from "next-intl";
import { ReconfirmCreateForm } from "../../../components/admin/ReconfirmCreateForm.tsx";
import { GateIntegrityKpiSection } from "../../../components/admin/GateIntegrityKpiSection.tsx";

export default function AdminGateIntegrityPage() {
  const t = useTranslations("admin.gateIntegrity");
  return (
    <main className="admin-console-page">
      <h1>{t("h1")}</h1>
      <p className="objective">{t("intro")}</p>
      <GateIntegrityKpiSection />
      <ReconfirmCreateForm />
    </main>
  );
}
