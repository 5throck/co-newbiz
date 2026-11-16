"use client";

// Row-level "confirm" action for the S6 longlist (ADR-0199): opens one dialog for ONE candidate covering the latest
// draft version of each category. Confirmation is human-only and per candidate and per selected category; there is
// deliberately no longlist-wide confirm-all.
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { ApiError, api } from "../../../lib/api.ts";
import { AiEvalModal } from "./AiEvalDialogs.tsx";
import {
  KNOWN_CALL_ERRORS,
  buildConfirmPlan,
  type ConfirmPlan,
  type DraftCategory,
  type EvalDraftView,
  type VersionRow,
} from "./aiEvalTypes.ts";

const CATEGORIES: DraftCategory[] = ["financial", "technical"];

export interface ConfirmSection {
  category: DraftCategory;
  versionNo: number;
  plan: ConfirmPlan;
}

/** Why the row button is disabled, or null. Counts come from the list's `eval_draft` chips (proposed_count). */
export function confirmDisabledReason(o: {
  excluded: boolean;
  hasDart: boolean;
  running: boolean;
  draft: EvalDraftView | undefined;
}): "excluded" | "noDart" | "running" | "noDraft" | "nothingWritable" | null {
  if (o.excluded) return "excluded";
  if (!o.hasDart) return "noDart";
  if (o.running) return "running";
  const chips = CATEGORIES.map((c) => o.draft?.[c]).filter((c) => !!c);
  if (chips.length === 0) return "noDraft";
  if (chips.every((c) => c?.proposed_count === 0)) return "nothingWritable";
  return null;
}

function Items({ heading, items }: { heading: string; items: Array<{ id: string; label: string; suffix?: string }> }) {
  return (
    <div>
      <h4 className="m-0 text-[length:var(--fs-caption)] font-semibold">
        {heading} ({items.length})
      </h4>
      {items.length > 0 && (
        <ul className="m-0 mt-1 pl-5 text-[length:var(--fs-caption)]">
          {items.map((i) => (
            <li key={i.id}>
              {i.label}
              {i.suffix ? ` — ${i.suffix}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Dialog body (plain component, rendered under test): one checkbox section per category, no confirm-all. */
export function AiEvalRowConfirmBody({
  sections,
  selected,
  onToggle,
  busy,
  onSubmit,
  onCancel,
}: {
  sections: ConfirmSection[];
  selected: DraftCategory[];
  onToggle: (c: DraftCategory) => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const tc = useTranslations("common");
  const total = sections.filter((s) => selected.includes(s.category)).reduce((n, s) => n + s.plan.write.length, 0);
  return (
    <div className="flex flex-col gap-3 mt-2">
      <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("rowConfirmIntro")}</p>
      {sections.map((s) => {
        const writable = s.plan.write.length > 0;
        return (
          <section key={s.category} aria-label={t(`category.${s.category}`)} className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-[length:var(--fs-body)] font-semibold">
              <input
                type="checkbox"
                checked={selected.includes(s.category)}
                disabled={!writable}
                onChange={() => onToggle(s.category)}
              />
              {t("rowConfirmCategory", { category: t(`category.${s.category}`), n: s.versionNo })}
            </label>
            {!writable && <p className="m-0 text-[length:var(--fs-caption)]">{t("rowConfirmNothing")}</p>}
            <Items
              heading={t("willWrite")}
              items={s.plan.write.map((w) => ({
                id: w.criterion_id,
                label: w.label,
                suffix: t(`verdict.${w.status}`),
              }))}
            />
            <Items
              heading={t("skippedHuman")}
              items={s.plan.skippedHuman.map((w) => ({ id: w.criterion_id, label: w.label }))}
            />
            <Items
              heading={t("skippedUnverified")}
              items={s.plan.skippedUnverified.map((w) => ({ id: w.criterion_id, label: w.label }))}
            />
          </section>
        );
      })}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          {tc("cancel")}
        </button>
        <button type="button" className="btn-premium btn-sm" disabled={busy || total === 0} onClick={onSubmit}>
          {t("confirmSubmit", { n: total })}
        </button>
      </div>
    </div>
  );
}

export function AiEvalRowConfirm({
  oppId,
  targetId,
  companyName,
  excluded,
  hasDart,
  running,
  draft,
  onConfirmed,
}: {
  oppId: string;
  targetId: string;
  companyName: string;
  excluded: boolean;
  hasDart: boolean;
  running: boolean;
  draft: EvalDraftView | undefined;
  onConfirmed: () => void;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<ConfirmSection[] | null>(null);
  const [versions, setVersions] = useState<Partial<Record<DraftCategory, string>>>({});
  const [selected, setSelected] = useState<DraftCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reason = confirmDisabledReason({ excluded, hasDart, running, draft });
  const base = `/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-draft-versions`;

  const errText = (e: unknown) =>
    e instanceof ApiError && (KNOWN_CALL_ERRORS as readonly string[]).includes(e.code)
      ? t(`callErrors.${e.code}`)
      : e instanceof Error
        ? e.message
        : t("callErrors.unknown");

  async function openDialog() {
    setOpen(true);
    setSections(null);
    setMessage(null);
    try {
      const res = await Promise.all(
        CATEGORIES.map((c) => api.get<{ versions: VersionRow[] }>(`${base}?category=${c}&limit=1&include=payload`)),
      );
      const out: ConfirmSection[] = [];
      const ids: Partial<Record<DraftCategory, string>> = {};
      CATEGORIES.forEach((c, i) => {
        const v = res[i].data.versions[0];
        if (!v?.payload) return;
        ids[c] = v.id;
        out.push({ category: c, versionNo: v.version_no, plan: buildConfirmPlan(v.payload) });
      });
      setVersions(ids);
      setSections(out);
      setSelected(out.filter((s) => s.plan.write.length > 0).map((s) => s.category));
    } catch (e) {
      setMessage(errText(e));
    }
  }

  async function submit() {
    setBusy(true);
    let confirmed = 0;
    let skipped = 0;
    try {
      for (const c of selected) {
        const id = versions[c];
        if (!id) continue;
        const r = await api.post<{ confirmed: number; skipped: unknown[] }>(
          `${base}/${encodeURIComponent(id)}/confirm`,
          {},
        );
        confirmed += r.data.confirmed;
        skipped += r.data.skipped.length;
      }
      setMessage(t("confirmResult", { confirmed, skipped }));
      onConfirmed();
      setSections(null);
      setOpen(false);
    } catch (e) {
      setMessage(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setOpen(false);
    setSections(null);
  };
  return (
    <>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={reason !== null || busy}
        aria-label={t("rowConfirmLabel", { company: companyName })}
        aria-describedby={reason ? reasonId : undefined}
        title={reason ? t(`rowConfirmDisabled.${reason}`) : t("rowConfirmTitle", { company: companyName })}
        onClick={() => void openDialog()}
      >
        {t("rowConfirm")}
      </button>
      {reason && (
        <span id={reasonId} className="sr-only">
          {t(`rowConfirmDisabled.${reason}`)}
        </span>
      )}
      {message && !open && (
        <span role="status" className="sr-only">
          {message}
        </span>
      )}
      {open && (
        <AiEvalModal title={t("rowConfirmTitle", { company: companyName })} onClose={close}>
          {message && (
            <p role="alert" className="m-0 text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
              {message}
            </p>
          )}
          {sections ? (
            <AiEvalRowConfirmBody
              sections={sections}
              selected={selected}
              onToggle={(c) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
              busy={busy}
              onSubmit={() => void submit()}
              onCancel={close}
            />
          ) : (
            !message && <p className="m-0 text-[color:var(--muted-fg)]">{t("loading")}</p>
          )}
        </AiEvalModal>
      )}
    </>
  );
}
