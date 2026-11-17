"use client";

// Editable conclusion fields of the direction form (design §7.2): headline, scope,
// value chain, prioritise / exclude lines (up to 3, type + reason). Refs, basis,
// support line and evidence stay read-only in the preview above and in the saved card.
import { useTranslations } from "next-intl";
import {
  addItem,
  type DirListKey,
  type DirTextKey,
  editItem,
  editText,
  MAX_ITEMS,
  removeItem,
  TEXT_CAPS,
  type UniverseDraft,
} from "./universeDraft.ts";

const LABEL = "text-[length:var(--fs-caption)] block mb-3";

export function UniverseDirectionFields({
  draft,
  setDraft,
}: {
  draft: UniverseDraft;
  setDraft: (d: UniverseDraft) => void;
}) {
  const t = useTranslations("stages.s67.directionCard");
  const d = draft.direction;
  if (!d) return null;
  const text = (key: DirTextKey, value: string, label: string) => (
    <label className={LABEL}>
      <span className="block mb-1">{label}</span>
      <textarea
        value={value}
        rows={2}
        maxLength={TEXT_CAPS[key]}
        onChange={(e) => setDraft(editText(draft, key, e.target.value))}
        className="sizing-new-input w-full"
      />
    </label>
  );
  const list = (key: DirListKey, label: string) => (
    <fieldset className="mb-3 border-0 p-0 min-w-0">
      <legend className="text-[length:var(--fs-caption)] mb-1 p-0">{label}</legend>
      {d[key].map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a positional list of at most 3 editable lines with no stable id
        <div key={i} className="flex flex-wrap items-end gap-2 mb-2">
          <input
            value={it.type}
            maxLength={TEXT_CAPS.type}
            aria-label={`${label} ${i + 1} ${t("itemType")}`}
            placeholder={t("itemType")}
            onChange={(e) => setDraft(editItem(draft, key, i, { type: e.target.value }))}
            className="sizing-new-input"
            style={{ flex: "1 1 12rem" }}
          />
          <input
            value={it.why}
            maxLength={TEXT_CAPS.why}
            aria-label={`${label} ${i + 1} ${t("itemWhy")}`}
            placeholder={t("itemWhy")}
            onChange={(e) => setDraft(editItem(draft, key, i, { why: e.target.value }))}
            className="sizing-new-input"
            style={{ flex: "2 1 16rem" }}
          />
          <button
            type="button"
            className="btn-ghost btn-sm"
            aria-label={`${label} ${i + 1} ${t("removeItem")}`}
            onClick={() => setDraft(removeItem(draft, key, i))}
          >
            {t("removeItem")}
          </button>
        </div>
      ))}
      {d[key].length < MAX_ITEMS && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft(addItem(draft, key))}>
          + {label}
        </button>
      )}
    </fieldset>
  );
  return (
    <>
      <p className="mb-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("editHint")}</p>
      {text("headline", d.headline.text, t("conclusion"))}
      {text("industry", d.scope.industry.text, `${t("scope")} · ${t("industry")}`)}
      {text("region", d.scope.region.text, `${t("scope")} · ${t("region")}`)}
      {text("size", d.scope.size.text, `${t("scope")} · ${t("size")}`)}
      {text("value_chain", d.value_chain.text, t("valueChain"))}
      {list("prioritise", t("prioritise"))}
      {list("exclude", t("exclude"))}
    </>
  );
}
