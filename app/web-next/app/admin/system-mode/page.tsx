"use client";

// /admin/system-mode (ADR-0133) — production|development 전역 스위치. 관리자
// 전용 화면(상위 app/admin/layout.tsx가 role을 가른다).
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../components/layout.tsx";
import { SystemModeSection } from "../../../components/admin/SystemModeSection.tsx";

export default function AdminSystemModePage() {
  const t = useTranslations("admin.systemModePage");
  return (
    <main className="admin-console-page">
      <PageHeader title={t("h1")} description={t("intro")} />
      <SystemModeSection />
    </main>
  );
}
