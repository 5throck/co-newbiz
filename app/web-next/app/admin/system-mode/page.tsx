"use client";

// /admin/system-mode (ADR-0133) — production|development 전역 스위치. 관리자
// 전용 화면(상위 app/admin/layout.tsx가 role을 가른다).
import { SystemModeSection } from "../../../components/admin/SystemModeSection.tsx";

export default function AdminSystemModePage() {
  return (
    <main>
      <h1>시스템 모드</h1>
      <p className="objective">
        운영(production)/개발(development) 전역 스위치 — 운영 모드에서는 딜 데이터 삭제를 차단합니다.
      </p>
      <SystemModeSection />
    </main>
  );
}
