"use client";


// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { MasterDataSection } from "../MasterDataSection.tsx";
import { useAdminData } from "./useAdminData.ts";
import { useAdminActions } from "./useAdminActions.ts";
import { UsersNoticePanel, UsersTablePanel } from "./UsersSection.tsx";
import { AuditPanel } from "./AuditSection.tsx";
import { DataSourcesPanel, SchedulePanel, DatabasePanel, NotificationsPanel } from "./OpsSections.tsx";
import { GlossaryListPanel, GlossaryLintPanel, GlossaryFormPanel } from "./GlossarySections.tsx";
import { ReviewAuditPanel, GovernancePanel, AdrPanel } from "./GovernanceSections.tsx";
import { SECTION_TITLE } from "./constants.ts";
import type { Section } from "./types.ts";

export function AdminConsole(props0: { section: Section }) {
  const h0 = useAdminData(props0);
  const h1 = useAdminActions({ ...h0 });
  const ctx = { ...h0, ...h1 };
  const { confirmDialog, section, error, issuedSecret, secretModalKeyDown, secretModalPanelRef, setIssuedSecret } = ctx;
  return (
    <main className="admin-console-page">
      {confirmDialog}
      <h1>{SECTION_TITLE[section]}</h1>
      {issuedSecret && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="발급된 비밀 정보" onKeyDown={secretModalKeyDown}>
          <div ref={secretModalPanelRef} className="modal-panel">
            <div className="modal-head"><h2>✅ {issuedSecret.kind} 발급 완료</h2></div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-2">
              아래 값은 <strong>지금 이 창에서만</strong> 표시됩니다 — 닫으면 다시 볼 수 없습니다. 안전한 곳에 저장하세요.
            </p>
            <div className="flex items-center gap-2">
              <code className="dd-item-id" style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>{issuedSecret.value}</code>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => { void navigator.clipboard.writeText(issuedSecret.value); }}
              >
                복사
              </button>
            </div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">{issuedSecret.detail}</p>
            <div className="flex justify-end mt-3">
              <button type="button" className="btn-ghost" onClick={() => setIssuedSecret(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      <UsersNoticePanel ctx={ctx} />
      <UsersTablePanel ctx={ctx} />

      <AuditPanel ctx={ctx} />

      <DataSourcesPanel ctx={ctx} />

      <SchedulePanel ctx={ctx} />

      <DatabasePanel ctx={ctx} />

      <NotificationsPanel ctx={ctx} />

      <GlossaryListPanel ctx={ctx} />

      <GlossaryLintPanel ctx={ctx} />

      <GlossaryFormPanel ctx={ctx} />

      <ReviewAuditPanel ctx={ctx} />

      <GovernancePanel ctx={ctx} />

      {section === "master-data" && <MasterDataSection />}

      <AdrPanel ctx={ctx} />
    </main>
  );
}
