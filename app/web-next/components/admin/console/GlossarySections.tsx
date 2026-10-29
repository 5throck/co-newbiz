"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ListSearch, Pager, matchesQuery, useAdminLabel, usePaged } from "./admin-ui.tsx";
import { ColGroup } from "../../ui.tsx";
import { addAliases, findGlossaryDuplicates, GLOSSARY_OWNER_KEYS, suggestKey } from "../../../lib/glossary-form.ts";

const GLOSSARY_LIST_COL_PCT = [28, 26, 30, 16] as const;
const GLOSSARY_LINT_COL_PCT = [28, 44, 12, 16] as const;
const GLOSSARY_CATEGORIES = ["business", "financial", "legal", "technical", "industry", "unit"] as const;
const MONO_CAPTION = "font-mono text-[length:var(--fs-caption)] break-words";

const GLOSSARY_PAGE_SIZE = 25;

export function GlossaryListPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.glossarySection");
  const tc = useTranslations("common");
  const tl = useTranslations("admin.list");
  const label = useAdminLabel();
  const { section, glossary } = ctx;
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => (glossary ?? []).filter((g) => matchesQuery(query, g.key, g.ko, g.en, label("glossaryCategory", g.category))), [glossary, query, label]);
  const paged = usePaged(filtered, GLOSSARY_PAGE_SIZE);
  return (
    <>{section === "glossary" &&
        (glossary === null ? (
          <p>{tc("loading")}</p>
        ) : glossary.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyTerms")}</p>
        ) : (
          <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchAria")} placeholder={t("searchPlaceholder")} />
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("readOnlyNote")}</span>
          </div>
          {filtered.length === 0 ? <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p> : (
          <>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table table-fixed-pct tmin-48">
            <caption className="sr-only">{t("listCaption")}</caption>
            <ColGroup widths={GLOSSARY_LIST_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colKey")}</th>
                <th scope="col">{t("colKo")}</th>
                <th scope="col">{t("colEn")}</th>
                <th scope="col">{t("colCategory")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((term) => (
                <tr key={term.key}>
                  <td className={MONO_CAPTION}>{term.key}</td>
                  <td>{term.ko}</td>
                  <td>{term.en}</td>
                  <td>{label("glossaryCategory", term.category)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} />
          </>
          )}
          </>
        ))}</>
  );
}

export function GlossaryLintPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.glossarySection");
  const tc = useTranslations("common");
  const { section, lintQueue } = ctx;
  return (
    <>{section === "glossary" && (
        <div className="glossary-lint-queue mt-6">
          <h3>{t("lintHeading")}</h3>
          {lintQueue === null ? (
            <p>{t("scanning")}</p>
          ) : lintQueue.undefined.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">
              {t("lintEmpty", { p1: lintQueue.scanned_files, p2: lintQueue.known_count })}
            </p>
          ) : (
            <>
              <p className="helper-note">
                {t("lintSummary", { p1: lintQueue.scanned_files, p2: lintQueue.known_count, p3: lintQueue.undefined.length })}
              </p>
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48">
                <caption className="sr-only">{t("lintCaption")}</caption>
                <ColGroup widths={GLOSSARY_LINT_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{t("colToken")}</th>
                    <th scope="col">{t("colFile")}</th>
                    <th scope="col">{t("colLine")}</th>
                    <th scope="col">{t("colCount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lintQueue.undefined.map((u, i) => (
                    <tr key={`${u.token}-${u.file}-${u.line}-${i}`}>
                      <td className={MONO_CAPTION}>{u.token}</td>
                      <td className={MONO_CAPTION}>{u.file}</td>
                      <td>{u.line}</td>
                      <td>{u.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}</>
  );
}


interface TermDraft {
  key: string;
  ko: string;
  en: string;
  category: string;
  owner: string;
  aliases: string[];
  definition_ko: string;
  why_it_matters_ko: string;
}

const EMPTY_DRAFT: TermDraft = { key: "", ko: "", en: "", category: "business", owner: "glossary-curator", aliases: [], definition_ko: "", why_it_matters_ko: "" };
const FIELD_CLASS = "flex flex-col gap-1";
const HINT_CLASS = "text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]";

export function GlossaryFormPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.glossarySection");
  const td = useTranslations("admin.data");
  const label = useAdminLabel();
  const { section, registerGlossaryTerm, glossary, glossaryWritable } = ctx;
  const [draft, setDraft] = useState<TermDraft>(EMPTY_DRAFT);
  const [keyTouched, setKeyTouched] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const duplicates = useMemo(
    () => findGlossaryDuplicates({ key: draft.key, ko: draft.ko, en: draft.en, aliases: draft.aliases }, glossary ?? []),
    [draft.key, draft.ko, draft.en, draft.aliases, glossary],
  );

  if (section !== "glossary") return null;

  if (!glossaryWritable) {
    return (
      <section className="mt-6" aria-label={t("formAria")}>
        <h3>{t("formHeading")}</h3>
        <div role="note" className="mt-2 rounded border border-[color:var(--border)] p-3">
          <p className="font-semibold">{t("prodReadOnlyHeading")}</p>
          <p className={`${HINT_CLASS} mt-1`}>{t("prodReadOnlyBody")}</p>
        </div>
      </section>
    );
  }

  const patch = (next: Partial<TermDraft>) => setDraft((d) => ({ ...d, ...next }));
  const suggested = suggestKey(draft.en);

  function commitAliasDraft() {
    if (!aliasDraft.trim()) return;
    patch({ aliases: addAliases(draft.aliases, aliasDraft) });
    setAliasDraft("");
  }

  function onAliasKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitAliasDraft();
    } else if (e.key === "Backspace" && !aliasDraft && draft.aliases.length) {
      patch({ aliases: draft.aliases.slice(0, -1) });
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const aliases = aliasDraft.trim() ? addAliases(draft.aliases, aliasDraft) : draft.aliases;
    if (!draft.key.trim() || !draft.ko.trim() || !draft.en.trim() || !draft.definition_ko.trim()) {
      setError(td("errRequiredFields"));
      return;
    }
    if (!draft.why_it_matters_ko.trim()) {
      setError(td("errWhyRequired"));
      return;
    }
    if (duplicates.length) {
      setError(t("submitBlockedDuplicate"));
      return;
    }
    setBusy(true);
    try {
      const res = await registerGlossaryTerm({
        key: draft.key.trim(),
        ko: draft.ko.trim(),
        en: draft.en.trim(),
        definition_ko: draft.definition_ko.trim(),
        why_it_matters_ko: draft.why_it_matters_ko.trim(),
        category: draft.category,
        owner: draft.owner,
        aliases,
      });
      setNotice(t("createdNotice", { p1: res.key, p2: res.file }));
      setDraft(EMPTY_DRAFT);
      setKeyTouched(false);
      setAliasDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : td("termCreateFailed"));
    } finally {
      setBusy(false);
    }
  }

  const fieldLabel = (field: "key" | "ko" | "en" | "alias") =>
    ({ key: t("fieldKey"), ko: t("fieldKo"), en: t("fieldEn"), alias: t("fieldAlias") })[field];

  return (
    <form className="glossary-form mt-6 flex flex-col gap-6" onSubmit={onSubmit} aria-label={t("formAria")}>
      <div>
        <h3>{t("formHeading")}</h3>
        <p className="helper-note">{t("formNote")}</p>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <section aria-label={t("groupIdentity")} className="flex flex-col gap-4">
          <h4>{t("groupIdentity")}</h4>

          <label className={FIELD_CLASS}>
            {t("labelEn")}
            <input
              type="text"
              value={draft.en}
              placeholder={t("placeholderEn")}
              onChange={(e) => patch({ en: e.target.value, ...(keyTouched ? {} : { key: suggestKey(e.target.value) }) })}
              required
            />
          </label>

          <label className={FIELD_CLASS}>
            {t("labelKo")}
            <input type="text" value={draft.ko} placeholder={t("placeholderKo")} onChange={(e) => patch({ ko: e.target.value })} required />
          </label>

          <div className={FIELD_CLASS}>
            <label className={FIELD_CLASS}>
              {t("labelKey")}
              <input
                type="text"
                value={draft.key}
                onChange={(e) => {
                  setKeyTouched(true);
                  patch({ key: e.target.value });
                }}
                aria-describedby="glossary-key-hint"
                required
              />
            </label>
            <p id="glossary-key-hint" className={HINT_CLASS}>
              {t("keyHint")}
              {keyTouched && suggested && suggested !== draft.key && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setKeyTouched(false);
                    patch({ key: suggested });
                  }}
                >
                  {" "}{t("keyResetSuggestion", { p1: suggested })}
                </button>
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={FIELD_CLASS}>
              {t("labelCategory")}
              <select value={draft.category} onChange={(e) => patch({ category: e.target.value })}>
                {GLOSSARY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{label("glossaryCategory", c)}</option>
                ))}
              </select>
            </label>
            <label className={FIELD_CLASS}>
              {t("labelOwner")}
              <select value={draft.owner} onChange={(e) => patch({ owner: e.target.value })}>
                {GLOSSARY_OWNER_KEYS.map((o) => (
                  <option key={o} value={o}>{label("govOwner", o)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className={FIELD_CLASS}>
            <label className={FIELD_CLASS}>
              {t("labelAliases")}
              <input
                type="text"
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onKeyDown={onAliasKey}
                onBlur={commitAliasDraft}
                aria-describedby="glossary-alias-hint"
              />
            </label>
            <p id="glossary-alias-hint" className={HINT_CLASS}>{t("aliasHint")}</p>
            {draft.aliases.length > 0 && (
              <ul className="flex flex-wrap gap-2 list-none p-0" aria-label={t("aliasListAria")}>
                {draft.aliases.map((alias) => (
                  <li key={alias} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] px-2 py-0.5">
                    <span>{alias}</span>
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label={t("aliasRemoveAria", { p1: alias })}
                      onClick={() => patch({ aliases: draft.aliases.filter((a) => a !== alias) })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label={t("groupDefinition")} className="flex flex-col gap-4">
          <h4>{t("groupDefinition")}</h4>

          <label className={FIELD_CLASS}>
            {t("labelDefinition")}
            <textarea value={draft.definition_ko} onChange={(e) => patch({ definition_ko: e.target.value })} rows={6} required />
          </label>
          <label className={FIELD_CLASS}>
            {t("labelWhy")}
            <textarea value={draft.why_it_matters_ko} onChange={(e) => patch({ why_it_matters_ko: e.target.value })} rows={6} required />
          </label>
        </section>

        <div aria-live="polite" className="md:col-span-2">
          {duplicates.length > 0 ? (
          <div role="alert" className="rounded border border-[color:var(--red-fg)] p-3">
            <p className="font-semibold">⚠ {t("dupHeading")}</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.map((d, i) => (
                <li key={`${d.field}-${d.value}-${d.entryKey}-${i}`}>
                  {t("dupItem", { p1: fieldLabel(d.field), p2: d.value, p3: d.entryKey, p4: fieldLabel(d.entryField) })}
                </li>
              ))}
            </ul>
            <p className={`${HINT_CLASS} mt-1`}>{t("dupAdvice")}</p>
          </div>
        ) : (
          (draft.key || draft.ko || draft.en) && <p className={HINT_CLASS}>✓ {t("dupNone")}</p>
        )}
      </div>

      <section aria-label={t("previewHeading")} className="rounded border border-[color:var(--border)] p-3 md:col-span-2">
        <h4>{t("previewHeading")}</h4>
        <p className={HINT_CLASS}>{t("previewHint")}</p>
        <div className="mt-2 flex flex-col gap-1">
          <p>
            <span className="border-b border-dotted border-current font-semibold">{draft.ko || t("previewEmptyTerm")}</span>
            {draft.en && <span className={HINT_CLASS}> · {draft.en}</span>}
          </p>
          <p>{draft.definition_ko || "—"}</p>
          <p><strong>{t("previewWhy")}</strong> {draft.why_it_matters_ko || "—"}</p>
          <p className={HINT_CLASS}>
            {label("glossaryCategory", draft.category)} · {label("govOwner", draft.owner)}
            {draft.aliases.length > 0 && <> · {t("fieldAlias")}: {draft.aliases.join(", ")}</>}
          </p>
        </div>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      <div className="md:col-span-2">
        <button type="submit" className="btn-primary" disabled={busy || duplicates.length > 0}>{busy ? t("submitting") : t("submitButton")}</button>
      </div>
      </div>
    </form>
  );
}
