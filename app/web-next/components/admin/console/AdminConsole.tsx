"use client";


// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useTranslations } from "next-intl";
import { MasterDataSection } from "../MasterDataSection.tsx";
import { useAdminData } from "./useAdminData.ts";
import { useAdminActions } from "./useAdminActions.ts";
import { UsersNoticePanel, UsersTablePanel } from "./UsersSection.tsx";
import { HumanRolesPanel } from "./HumanRolesSection.tsx";
import { AuditPanel } from "./AuditSection.tsx";
import { DataSourcesPanel, SchedulePanel, DatabasePanel, NotificationsPanel } from "./OpsSections.tsx";
import { GlossaryListPanel, GlossaryLintPanel, GlossaryFormPanel } from "./GlossarySections.tsx";
import { ReviewAuditPanel, GovernancePanel, AdrPanel } from "./GovernanceSections.tsx";
import { SECTION_TITLE_KEY } from "./constants.ts";
import type { Section } from "./types.ts";

export function AdminConsole(props0: { section: Section }) {
  const t = useTranslations();
  const st = useTranslations("admin.secretDialog");
  const h0 = useAdminData(props0);
  const h1 = useAdminActions({ ...h0 });
  const ctx = { ...h0, ...h1 };
  const { confirmDialog, section, error, issuedSecret, secretModalKeyDown, secretModalPanelRef, setIssuedSecret } = ctx;
  return (
    <main className="admin-console-page">
      {confirmDialog}
      <h1>{t(SECTION_TITLE_KEY[section])}</h1>
      {issuedSecret && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={st("aria")} onKeyDown={secretModalKeyDown}>
          <div ref={secretModalPanelRef} className="modal-panel">
            <div className="modal-head"><h2>{st("issuedTitle", { kind: issuedSecret.kind })}</h2></div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-2">
              {st("bodyHead")} <strong>{st("bodyEmphasis")}</strong> {st("bodyTail")}
            </p>
            <div className="flex items-center gap-2">
              <code className="dd-item-id" style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>{issuedSecret.value}</code>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => { void navigator.clipboard.writeText(issuedSecret.value); }}
              >
                {t("common.copy")}
              </button>
            </div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">{issuedSecret.detail}</p>
            <div className="flex justify-end mt-3">
              <button type="button" className="btn-ghost" onClick={() => setIssuedSecret(null)}>{t("common.close")}</button>
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
      <HumanRolesPanel ctx={ctx} />

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
