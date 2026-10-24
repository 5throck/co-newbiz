"use client";

// ADR-0161 소급 적용 패널 — 프로젝트 lead 에게만 보이는 보조 행동. 지금 이 프로젝트에 무엇이 적용되는지
// 미리 보여 주고, lead 가 사람으로서 정책 이행 기록(migration_note 필수)을 한 번 남길 수 있다. 기록은
// 추가 전용 감사 항목이며 정책 고정(pin)을 바꾸거나 기존 기록을 지우지 않는다. 에이전트는 기록할 수 없다.
// 주요 행동(primary)이 아니므로 버튼은 ghost 이고 접힌 영역(details) 안에 둔다.

import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { ColGroup } from "../ui.tsx";
import { useConfirm } from "../crud.tsx";
import { baselineErrorText, INSIDER_REQUIRED_KEY, MAX_MIGRATION_NOTE_LEN } from "../../lib/execution-baseline-view.ts";
import { useIsProjectLead } from "./useIsProjectLead.ts";
import { useTranslations } from "next-intl";
import { resolveI18n } from "../../lib/execution-baseline-view.ts";
import {
  migrationFormState,
  migrationPreview,
  validateMigrationNote,
  type PolicyMigrationView,
} from "../../lib/post-management-view.ts";

/** Column shares (%): item, applies, note. */
const PREVIEW_COL_PCT = [40, 18, 42] as const;

export function PolicyMigrationPanel({ projectId, canAct }: { projectId: string; canAct: boolean }) {const t = useTranslations("stages.s12.policyMigration"); const tc = useTranslations("common"); const tr = useTranslations();
  /** Resolve a lib-emitted render reference: catalog key + params, or raw server text passthrough. */
  const tx = (m: { key: string | null; params: Record<string, string>; text: string | null }): string => (m.key ? tr(m.key, m.params) : m.text ?? "");
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<PolicyMigrationView | null>(null);
  const isLead = useIsProjectLead(projectId);
  const [insiderBlocked, setInsiderBlocked] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const base = `/api/projects/${encodeURIComponent(projectId)}/policy-migration`;

  const formState = migrationFormState(isLead, view?.entry ?? null);

  useEffect(() => {
    if (!isLead) return;
    let live = true;
    api.get<PolicyMigrationView>(base)
      .then((r) => { if (live) setView(r.data); })
      .catch((e) => {
        if (!live) return;
        // Insider (read) gate: the same Korean message the other ADR-0161 GETs show.
        if ((e as { code?: string } | null)?.code === "insider_required") setInsiderBlocked(true);
        setError(e instanceof Error ? e.message : t("failedToLoadThePolicy"));
      });
    return () => { live = false; };
  }, [base, isLead]);

  if (insiderBlocked) {
    return (
      <p className="market-section mt-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="pm-migration-insider">
        {tr(INSIDER_REQUIRED_KEY)}
      </p>
    );
  }

  if (formState === "hidden") return null;

  function record() {
    const problem = validateMigrationNote(note, MAX_MIGRATION_NOTE_LEN);
    setNoteError(problem);
    if (problem) return;
    confirm(t("policyImplementationRecord"), () => {
      void (async () => {
        if (busy) return;
        setBusy(true); setError(null);
        try {
          await api.post(base, { migration_note: note.trim() });
          const r = await api.get<PolicyMigrationView>(base);
          setView(r.data);
          setNote("");
          setAnnounce(t("policyImplementationRecorded")); // INTERIM-WORDING
        } catch (e) {
          const msg = tx(baselineErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : undefined));
          setError(msg);
          setAnnounce(t("failedToRecordP1", { p1: msg })); // INTERIM-WORDING
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: t("recordsOnceAsAPerson"), // INTERIM-WORDING
      confirmLabel: tc("record"),
      tone: "neutral",
    });
  }

  const rows = view ? migrationPreview(view.applies, view.completed_stages) : [];

  return (
    <details className="market-section sizing-step mt-3" data-testid="pm-migration">
      <summary className="cursor-pointer text-[length:var(--fs-body)]">{t("policyImplementationRecordProjectLead")}</summary>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] my-2">
        {t("previewsHowTheNewBusiness")}
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {view && (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-40" aria-label={t("applicationPreview")}>
            <caption className="sr-only">{t("previewOfItemsApplyingTo")}</caption>
            <ColGroup widths={PREVIEW_COL_PCT} />
            <thead><tr><th scope="col">{tc("items")}</th><th scope="col">{tc("apply")}</th><th scope="col">{t("explanation")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{resolveI18n(r.label, tr)}</td>
                  <td><span className={`status-chip ${r.applies ? "status-amber" : "status-not-started"}`}>{r.applies ? t("applied") : t("notApplicable")}</span></td>
                  <td className="text-[length:var(--fs-caption)]">{resolveI18n(r.text, tr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view?.entry && formState === "recorded" && (
        <p className="text-[length:var(--fs-caption)] mt-2" data-testid="pm-migration-recorded">
          <span className="status-chip status-green">{t("implementationRecorded")}</span>
          <span className="block mt-1">{tc("recordedBy")} {view.entry.actor} · {view.entry.at.slice(0, 10)}
            {view.entry.completed_stages.length > 0 && <> {t("stepsCompletedAtRecordTime")} {view.entry.completed_stages.join(", ")}</>}</span>
          <span className="block text-[color:var(--muted-fg)]">{t("memo")} {view.entry.migration_note}</span>
          {view.entry.migration_note_hash && (
            <span className="block text-[color:var(--muted-fg)] tabular-nums break-all" data-testid="pm-migration-hash">
              {t("hash")} {view.entry.migration_note_hash}
            </span>
          )}
        </p>
      )}
      {formState === "form" && (
        canAct ? (
          <form className="sizing-new-form mt-2" aria-label={t("policyImplementationRecord2")} onSubmit={(e) => { e.preventDefault(); record(); }}>
            <label className="text-[length:var(--fs-caption)] block">
              <span className="block mb-1">{t("implementationMemoRequired")} {MAX_MIGRATION_NOTE_LEN}{t("charsOrFewer")}</span>
              <textarea className="sizing-new-input w-full" rows={3} maxLength={MAX_MIGRATION_NOTE_LEN} value={note} aria-required="true"
                aria-invalid={noteError ? true : undefined}
                onChange={(e) => { setNote(e.target.value); if (noteError) setNoteError(null); }} />
              <span className="block text-[color:var(--muted-fg)] tabular-nums">{note.trim().length}/{MAX_MIGRATION_NOTE_LEN}</span>
            </label>
            {noteError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {noteError}</p>}
            <button type="submit" className="btn-ghost btn-sm mt-2" disabled={busy}>{busy ? tc("recording") : t("policyImplementationRecordConfirmationNeeded")}</button>
          </form>
        ) : (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">{t("recordingRequiresTheAnalystRole")}</p>
        )
      )}
      {confirmDialog}
    </details>
  );
}
