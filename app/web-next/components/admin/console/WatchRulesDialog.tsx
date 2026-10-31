"use client";

// Watch-rules dialog (design 2026-10-29-scheduled-jobs-design §13.6, P4).
// Lists one watch's rules (GET /api/admin/watches/[id]/rules) with per-rule actions
// (edit → WatchRuleForm, preview → the zero-write evaluation, delete → hard DELETE of the
// configuration row). The preview results panel renders inside this dialog for BOTH entry
// points — the unsaved draft preview from the form and the per-rule preview — with the
// explicit "저장되지 않은 미리보기 · no data written" caption. Recipients arrive MASKED and
// are shown as-is (§13.8).
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api, ApiError, type RowList } from "../../../lib/api.ts";
import { ColGroup, useToast } from "../../ui.tsx";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { RowMenu, useConfirm } from "../../crud.tsx";
import { useAdminLabel } from "./admin-ui.tsx";
import { WatchRuleForm } from "./WatchRuleForm.tsx";
import type { WatchRuleDraft, WatchRulePreview, WatchRuleRow } from "./types.ts";

// 규칙 6열 — 트리거·임계값·쿨다운·채널·상태 + 작업.
const RULES_COL_PCT = [24, 14, 14, 14, 14, 20] as const;

interface PreviewState {
  draft: WatchRuleDraft;
  state: "running" | "ready" | "error";
  result: WatchRulePreview | null;
  error: string | null;
}

export function WatchRulesDialog({
  watch,
  onClose,
}: {
  watch: { id: string; project: { id: string; project_no: string | null } | null; user_id: string };
  onClose: () => void;
}) {
  const t = useTranslations("admin.watches");
  const ta = useTranslations("admin.actions");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [rules, setRules] = useState<WatchRuleRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<"create" | WatchRuleRow | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  function reload() {
    // {rows} list envelope (lib/api.ts RowList) — the compiler-enforced path to res.data.rows.
    api.get<RowList<WatchRuleRow>>(`/api/admin/watches/${encodeURIComponent(watch.id)}/rules`)
      .then((res) => { setRules(res.data.rows); setLoadError(null); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : t("ruleLoadFailed")));
  }
  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [watch.id]);

  /** Zero-write draft evaluation — shared by the form's Preview button and the per-rule action. */
  function runPreview(draft: WatchRuleDraft) {
    setPreview({ draft, state: "running", result: null, error: null });
    api.post<WatchRulePreview>("/api/admin/watch-rules/preview", { watch_id: watch.id, ...draft })
      .then((res) => setPreview({ draft, state: "ready", result: res.data, error: null }))
      .catch((err) => {
        if (err instanceof ApiError && err.code === "validation_failed") {
          const fields = err.details?.fields;
          setPreview({ draft, state: "error", result: null, error: fields !== undefined ? Object.values(fields as Record<string, string>).join(" ") : null });
          return;
        }
        setPreview({ draft, state: "error", result: null, error: err instanceof Error ? err.message : t("previewFailed") });
      });
  }

  function deleteRule(rule: WatchRuleRow) {
    confirm(t("ruleDeleteConfirmTitle"), () => {
      api.delete(`/api/admin/watch-rules/${encodeURIComponent(rule.id)}`)
        .then(() => reload())
        .catch((err) => toast(err instanceof Error ? err.message : ta("watchDeleteFailed"), "alert"));
    }, { body: t("ruleDeleteConfirmBody"), confirmLabel: t("ruleDelete") });
  }

  const watchName = watch.project?.project_no ?? watch.id;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("rulesAria", { p1: watchName })} onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" style={{ maxWidth: "56rem", width: "100%" }}>
        <div className="modal-head"><h2>{t("rulesAria", { p1: watchName })}</h2></div>
        <p className="mt-1 mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{watch.user_id}</p>
        {confirmDialog}

        {formTarget !== null && (
          <WatchRuleForm
            watchId={watch.id}
            initial={formTarget === "create" ? null : formTarget}
            onSaved={() => { setFormTarget(null); setPreview(null); reload(); }}
            onCancel={() => setFormTarget(null)}
            onPreview={runPreview}
          />
        )}

        {formTarget === null && (
          <>
            <div className="mb-2">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setFormTarget("create")}>{t("ruleAdd")}</button>
            </div>
            {loadError && <p role="alert" className="mb-2 text-[color:var(--red-fg)]">{loadError}</p>}
            {rules === null ? (
              <p>{tc("loading")}</p>
            ) : rules.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">{t("rulesEmpty")}</p>
            ) : (
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                <table className="data-table list-table table-fixed-pct tmin-48">
                  <caption className="sr-only">{t("rulesHeading")}</caption>
                  <ColGroup widths={RULES_COL_PCT} />
                  <thead>
                    <tr>
                      <th scope="col">{t("colTrigger")}</th>
                      <th scope="col">{t("colThreshold")}</th>
                      <th scope="col">{t("colCooldown")}</th>
                      <th scope="col">{t("colChannel")}</th>
                      <th scope="col">{t("colRuleState")}</th>
                      <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id}>
                        <td>{label("trigger", r.trigger_type)}</td>
                        <td>{r.threshold !== null ? (r.trigger_type === "staleness" ? t("thresholdDays", { n: r.threshold }) : t("thresholdPct", { n: r.threshold })) : t("thresholdNone")}</td>
                        <td>{t("cooldownHoursValue", { n: r.cooldown_hours })}</td>
                        <td>{label("channel", r.channel)}</td>
                        <td>
                          {r.enabled === 1 ? (
                            <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--green-bg)] text-[color:var(--green-fg)]">
                              <span aria-hidden="true">●</span> {t("stateEnabled")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]">
                              <span aria-hidden="true">○</span> {t("stateDisabled")}
                            </span>
                          )}
                        </td>
                        <td className="sizing-actions-cell">
                          <RowMenu
                            label={t("ruleRowMenuAria", { p1: label("trigger", r.trigger_type) })}
                            items={[
                              { key: "edit", label: t("ruleEdit"), onSelect: () => setFormTarget(r) },
                              {
                                key: "preview",
                                label: t("rulePreview"),
                                onSelect: () => {
                                  setFormTarget(null);
                                  runPreview({ trigger_type: r.trigger_type, threshold: r.threshold, cooldown_hours: r.cooldown_hours, channel: r.channel });
                                },
                              },
                              { key: "delete", label: t("ruleDelete"), danger: true, separatorBefore: true, onSelect: () => deleteRule(r) },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {preview !== null && <WatchRulePreviewPanel preview={preview} onDismiss={() => setPreview(null)} />}

        <div className="mt-3 flex justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>{tc("close")}</button>
        </div>
      </div>
    </div>
  );
}

/** Zero-write evaluation results — status trio, reason, expected severity, masked recipients. */
function WatchRulePreviewPanel({ preview, onDismiss }: { preview: PreviewState; onDismiss: () => void }) {
  const t = useTranslations("admin.watches");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const r = preview.result;
  return (
    <section className="mt-4 rounded p-3" style={{ background: "var(--muted-bg)" }} aria-label={t("previewCaption")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="m-0 text-[length:var(--fs-body)] font-semibold">{t("previewButton")}</h3>
        <button type="button" className="btn-ghost btn-sm" aria-label={tc("close")} onClick={onDismiss}>✕</button>
      </div>
      <p className="m-0 mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]">{t("previewCaption")}</p>
      {preview.state === "running" && <p className="m-0">{t("previewRunning")}</p>}
      {preview.state === "error" && (
        <p role="alert" className="m-0 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">{preview.error ?? t("previewFailed")}</p>
      )}
      {preview.state === "ready" && r !== null && (
        <>
          <dl className="m-0 grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: "auto 1fr" }}>
            <dt className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("previewEvaluated")}</dt>
            <dd className="m-0">{r.evaluated ? t("previewYes") : t("previewNo")}</dd>
            <dt className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("previewWouldFire")}</dt>
            <dd className="m-0">{r.would_fire ? t("previewYes") : t("previewNo")}</dd>
            <dt className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("previewSuppressed")}</dt>
            <dd className="m-0">{r.suppressed_by_cooldown ? t("previewYes") : t("previewNo")}</dd>
            <dt className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("previewReason")}</dt>
            <dd className="m-0">{r.reason !== "" ? r.reason : "—"}</dd>
            <dt className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("previewSeverity")}</dt>
            <dd className="m-0">{r.severity !== null ? label("severity", r.severity) : "—"}</dd>
          </dl>
          <p className="mb-0 mt-2 text-[length:var(--fs-caption)] font-semibold">{t("previewRecipients")}</p>
          {r.recipients.length === 0 ? (
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("previewRecipientsEmpty")}</p>
          ) : (
            <ul className="mb-0 mt-1 pl-5 text-[length:var(--fs-caption)]">
              {r.recipients.map((rec) => (
                <li key={rec.user_id}>
                  {rec.user_id}
                  {rec.email_masked !== null && <> · <code className="font-mono">{rec.email_masked}</code></>}
                  {" · "}{rec.channels.map((c) => label("channel", c)).join(", ")}
                </li>
              ))}
            </ul>
          )}
          <p className="mb-0 mt-2 text-[length:var(--fs-caption)] font-semibold">{t("previewInApp")}</p>
          <p className="m-0 text-[length:var(--fs-caption)]">
            {r.in_app_user_ids.length === 0 ? <span className="text-[color:var(--muted-fg)]">{t("previewInAppEmpty")}</span> : r.in_app_user_ids.join(", ")}
          </p>
        </>
      )}
    </section>
  );
}
