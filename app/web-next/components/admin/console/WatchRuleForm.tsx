"use client";

// Watch-rule create/edit form (design 2026-10-29-scheduled-jobs-design §13.6, P4).
// POST /api/admin/watches/[id]/rules (create) and PATCH /api/admin/watch-rules/[id] (edit —
// only the fields the form shows are sent; adr_ref is untouched on edit). The validation
// matrix is server-authoritative: threshold exists and is required only for
// threshold_breach | staleness (percentage points / days hints), cooldown 1–720, channel
// gated on server configuration — a 400 validation_failed carries per-field messages in
// error.details.fields and each renders inline under its field. The Preview button evaluates
// the UNSAVED draft through POST /api/admin/watch-rules/preview (zero-write; the result
// panel lives in the parent dialog with the "no data written" caption).
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import { useAdminLabel } from "./admin-ui.tsx";
import type { WatchRuleDraft, WatchRuleRow } from "./types.ts";

/** The watch_rule CHECK's 7-value set — NOT the notification table's 11 (see lib/admin/watch-rules.ts). */
export const RULE_TRIGGER_TYPES = [
  "rag_upgrade", "rag_downgrade", "kill_criteria", "regulation_change", "threshold_breach", "staleness", "batch_failure",
] as const;
/** threshold is required (> 0) for exactly these triggers and rejected for the other five. */
export const THRESHOLD_BEARING_TRIGGERS: readonly string[] = ["threshold_breach", "staleness"];
/** Every channel the rule body may name; unconfigured external ones are gated by the server 400. */
const RULE_CHANNELS = ["in_app", "all", "email", "webhook"] as const;
const COOLDOWN_MIN = 1;
const COOLDOWN_MAX = 720;
const DEFAULT_COOLDOWN = 24;

export function isThresholdBearing(triggerType: string): boolean {
  return THRESHOLD_BEARING_TRIGGERS.includes(triggerType);
}

export function WatchRuleForm({
  watchId,
  initial,
  onSaved,
  onCancel,
  onPreview,
}: {
  watchId: string;
  /** Edit mode when present, create mode when null. */
  initial: WatchRuleRow | null;
  onSaved: () => void;
  onCancel: () => void;
  onPreview: (draft: WatchRuleDraft) => void;
}) {
  const t = useTranslations("admin.watches");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const editing = initial !== null;
  const [triggerType, setTriggerType] = useState<string>(initial?.trigger_type ?? "rag_downgrade");
  const [threshold, setThreshold] = useState<string>(initial?.threshold !== null && initial?.threshold !== undefined ? String(initial.threshold) : "");
  const [cooldown, setCooldown] = useState<string>(String(initial?.cooldown_hours ?? DEFAULT_COOLDOWN));
  const [channel, setChannel] = useState<string>(initial?.channel ?? "in_app");
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled !== 0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const thresholdBearing = isThresholdBearing(triggerType);
  const thresholdValue = Number(threshold);
  const thresholdOk = !thresholdBearing || (threshold.trim() !== "" && Number.isFinite(thresholdValue) && thresholdValue > 0);
  const cooldownValue = Number(cooldown);
  const cooldownOk = Number.isInteger(cooldownValue) && cooldownValue >= COOLDOWN_MIN && cooldownValue <= COOLDOWN_MAX;
  const canSave = thresholdOk && cooldownOk && !busy;

  /** Body carries only what the form edits; an absent threshold key keeps the server's
   * merge/validate behavior honest for non-bearing triggers (create sends threshold only
   * when the trigger bears one — the server rejects it otherwise). */
  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { trigger_type: triggerType, cooldown_hours: cooldownValue, channel };
    if (thresholdBearing) body.threshold = thresholdValue;
    if (editing) body.enabled = enabled;
    return body;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    try {
      if (editing && initial !== null) {
        await api.patch(`/api/admin/watch-rules/${encodeURIComponent(initial.id)}`, buildBody());
      } else {
        await api.post(`/api/admin/watches/${encodeURIComponent(watchId)}/rules`, buildBody());
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") {
        const fields = err.details?.fields;
        if (fields !== null && typeof fields === "object") setFieldErrors(fields as Record<string, string>);
        else setFormError(err.message);
      } else {
        setFormError(err instanceof Error ? err.message : t("ruleSaveFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  function runPreview() {
    if (!thresholdOk || !cooldownOk) return;
    const draft: WatchRuleDraft = {
      trigger_type: triggerType,
      threshold: thresholdBearing ? thresholdValue : null,
      cooldown_hours: cooldownValue,
      channel,
    };
    onPreview(draft);
  }

  return (
    <form onSubmit={(e) => { void submit(e); }} aria-label={editing ? t("ruleFormEditAria") : t("ruleFormCreateAria")} className="stack-form">
      <div className="stack-form-row">
        <label htmlFor="ruleTrigger">{t("triggerLabel")}</label>
        <select
          id="ruleTrigger"
          value={triggerType}
          onChange={(e) => { setTriggerType(e.target.value); setThreshold(""); setFieldErrors((f) => ({ ...f, trigger_type: "", threshold: "" })); }}
          aria-describedby="ruleTriggerHint"
          aria-invalid={fieldErrors.trigger_type !== undefined && fieldErrors.trigger_type !== ""}
        >
          {RULE_TRIGGER_TYPES.map((v) => <option key={v} value={v}>{label("trigger", v)}</option>)}
        </select>
        <p id="ruleTriggerHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("triggerHint")}</p>
        <FieldError message={fieldErrors.trigger_type} />
      </div>
      {thresholdBearing && (
        <div className="stack-form-row">
          <label htmlFor="ruleThreshold">{t("thresholdLabel")}</label>
          <input
            id="ruleThreshold"
            inputMode="decimal"
            className="sizing-new-input"
            style={{ width: "8rem" }}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            aria-describedby="ruleThresholdHint"
            aria-invalid={!thresholdOk || (fieldErrors.threshold !== undefined && fieldErrors.threshold !== "")}
            required
          />
          <p id="ruleThresholdHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {triggerType === "staleness" ? t("thresholdHintDays") : t("thresholdHintPct")}
          </p>
          <FieldError message={fieldErrors.threshold} />
        </div>
      )}
      <div className="stack-form-row">
        <label htmlFor="ruleCooldown">{t("cooldownLabel")}</label>
        <input
          id="ruleCooldown"
          inputMode="numeric"
          className="sizing-new-input"
          style={{ width: "8rem" }}
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
          aria-describedby="ruleCooldownHint"
          aria-invalid={!cooldownOk || (fieldErrors.cooldown_hours !== undefined && fieldErrors.cooldown_hours !== "")}
        />
        <p id="ruleCooldownHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("cooldownHint")}</p>
        <FieldError message={fieldErrors.cooldown_hours} />
      </div>
      <div className="stack-form-row">
        <label htmlFor="ruleChannel">{t("channelLabel")}</label>
        <select id="ruleChannel" value={channel} onChange={(e) => setChannel(e.target.value)} aria-describedby="ruleChannelHint" aria-invalid={fieldErrors.channel !== undefined && fieldErrors.channel !== ""}>
          {RULE_CHANNELS.map((v) => <option key={v} value={v}>{label("channel", v)}</option>)}
        </select>
        <p id="ruleChannelHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("channelHint")}</p>
        <FieldError message={fieldErrors.channel} />
      </div>
      {editing && (
        <div className="stack-form-row">
          <label htmlFor="ruleEnabled">{t("enabledLabel")}</label>
          <input id="ruleEnabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <FieldError message={fieldErrors.enabled} />
        </div>
      )}
      <FieldError message={fieldErrors.body} />
      {formError !== null && <p role="alert" className="m-0 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">{formError}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={runPreview} disabled={!thresholdOk || !cooldownOk}>{t("previewButton")}</button>
        <span className="flex-1" />
        <button type="button" className="btn-ghost" onClick={onCancel}>{tc("cancel")}</button>
        <button type="submit" className="btn-primary" disabled={!canSave}>{busy ? tc("saving") : tc("save")}</button>
      </div>
    </form>
  );
}

/** One inline server field error (validation_failed → error.details.fields). */
export function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined || message === "") return null;
  return <p role="alert" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{message}</p>;
}
