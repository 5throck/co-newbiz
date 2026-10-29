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
      <section aria-labelledby="gi-reconfirm" className="mt-4">
        <h2 id="gi-reconfirm" className="m-0">{t("reconfirm.title")}</h2>
        <p className="m-0 mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("reconfirm.intro")}</p>
        <ReconfirmCreateForm />
      </section>
    </main>
  );
}
