"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ListSearch, Pager, matchesQuery, useAdminLabel, usePaged } from "./admin-ui.tsx";

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
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table">
            <caption className="sr-only">{t("listCaption")}</caption>
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
                  <td className="font-mono text-xs">{term.key}</td>
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
              <table className="data-table">
                <caption className="sr-only">{t("lintCaption")}</caption>
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
                      <td className="font-mono text-xs">{u.token}</td>
                      <td className="font-mono text-xs">{u.file}</td>
                      <td>{u.line}</td>
                      <td>{u.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}</>
  );
}

export function GlossaryFormPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.glossarySection");
  const label = useAdminLabel();
  const { section, submitGlossaryTerm, termForm, setTermForm, termFormError, termFormNotice, termFormBusy } = ctx;
  return (
    <>{section === "glossary" && (
        <form className="glossary-form mt-6" onSubmit={submitGlossaryTerm} aria-label={t("formAria")}>
          <h3>{t("formHeading")}</h3>
          <p className="helper-note">
            {t("formNote")}
          </p>
          <div className="form-grid">
            <label>
              {t("labelKey")}
              <input type="text" value={termForm.key} onChange={(e) => setTermForm({ ...termForm, key: e.target.value })} required />
            </label>
            <label>
              {t("labelKo")}
              <input type="text" value={termForm.ko} onChange={(e) => setTermForm({ ...termForm, ko: e.target.value })} required />
            </label>
            <label>
              {t("labelEn")}
              <input type="text" value={termForm.en} onChange={(e) => setTermForm({ ...termForm, en: e.target.value })} required />
            </label>
            <label>
              {t("labelCategory")}
              <select value={termForm.category} onChange={(e) => setTermForm({ ...termForm, category: e.target.value })}>
                <option value="business">{label("glossaryCategory", "business")}</option>
                <option value="financial">{label("glossaryCategory", "financial")}</option>
                <option value="legal">{label("glossaryCategory", "legal")}</option>
                <option value="technical">{label("glossaryCategory", "technical")}</option>
                <option value="industry">{label("glossaryCategory", "industry")}</option>
                <option value="unit">{label("glossaryCategory", "unit")}</option>
              </select>
            </label>
            <label>
              {t("labelOwner")}
              <input type="text" value={termForm.owner} onChange={(e) => setTermForm({ ...termForm, owner: e.target.value })} />
            </label>
            <label>
              {t("labelAliases")}
              <input type="text" value={termForm.aliases} onChange={(e) => setTermForm({ ...termForm, aliases: e.target.value })} />
            </label>
          </div>
          <label className="block mt-2">
            {t("labelDefinition")}
            <textarea value={termForm.definition_ko} onChange={(e) => setTermForm({ ...termForm, definition_ko: e.target.value })} rows={2} required />
          </label>
          <label className="block mt-2">
            {t("labelWhy")}
            <textarea value={termForm.why_it_matters_ko} onChange={(e) => setTermForm({ ...termForm, why_it_matters_ko: e.target.value })} rows={2} required />
          </label>
          {termFormError && <p className="form-error mt-2" role="alert">{termFormError}</p>}
          {termFormNotice && <p className="form-success mt-2">{termFormNotice}</p>}
          <button type="submit" className="btn-primary mt-2" disabled={termFormBusy}>
            {termFormBusy ? t("submitting") : t("submitButton")}
          </button>
        </form>
      )}</>
  );
}
