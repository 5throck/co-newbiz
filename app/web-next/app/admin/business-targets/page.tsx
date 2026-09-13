"use client";

// /admin/business-targets (ADR-0114) — group-common and affiliate-specific
// business-target standards consumed by the fs-gate evidence table. Admin-only
// surface wiring the (previously unwired) BusinessTargetsSection component.
import { BusinessTargetsSection } from "../../../components/admin/BusinessTargetsSection.tsx";

export default function AdminBusinessTargetsPage() {
  return (
    <main>
      <h1>사업목표 기준</h1>
      <p className="objective">
        그룹 공통·계열사별 사업목표 마스터 — FS 진행에서 기준 충족 여부 판정의 근거입니다. 계열사 행은 그룹 공통 행을 덮어씁니다.
      </p>
      <BusinessTargetsSection />
    </main>
  );
}
