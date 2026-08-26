"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type GlossaryTermSummary } from "../../lib/api.ts";
import { GlossaryTerm } from "../../components/GlossaryTerm.tsx";

// 용어집 (Glossary) searchable view — ui-spec §2's 용어집 node. Built as a
// top-level route (/glossary), not a ProjectDetail tab: the glossary is
// workspace reference data — GET /api/glossary carries no project binding —
// and ProjectDetail's tab bar already carries 11 project-scoped tabs. The
// IA tree keeps 용어집 under Project Detail as the design target; the
// route choice is recorded in ui-spec §2's as-built deltas.
//
// Search is client-side over the fields the list payload actually carries
// (key/ko/en/category). Aliases are NOT in the GET /api/glossary payload —
// they exist only on the per-term detail endpoint — so alias search is a
// backend gap, not an omission here. Term cards reuse the existing
// GlossaryTerm tooltip (dashed underline + popover), which lazily fetches
// the detail endpoint for definition_ko / why_it_matters_ko.

export function GlossaryView() {
  const [terms, setTerms] = useState<GlossaryTermSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .get<GlossaryTermSummary[]>("/api/glossary")
      .then((res) => setTerms(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  const filtered = useMemo(() => {
    if (terms === null) return null;
    const needle = query.trim().toLowerCase();
    if (needle === "") return terms;
    return terms.filter((t) =>
      [t.key, t.ko, t.en, t.category].some((field) => field.toLowerCase().includes(needle)),
    );
  }, [terms, query]);

  return (
    <main>
      <h1>용어집</h1>
      <input
        type="search"
        aria-label="용어 검색"
        placeholder="용어·영문명·분류 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {filtered === null ? (
        <p>불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">검색어와 일치하는 용어가 없습니다.</p>
      ) : (
        <>
          <p className="cell-sub">총 {filtered.length}건</p>
          <ul className="glossary-grid">
            {filtered.map((t) => (
              <li key={t.key} className="glossary-card">
                <div className="glossary-card-head">
                  <GlossaryTerm term={t.key}>
                    <strong>{t.ko}</strong>
                  </GlossaryTerm>
                  {t.category && <span className="dd-category-badge">{t.category}</span>}
                </div>
                <p className="cell-sub">
                  {t.en} · <code>{t.key}</code>
                </p>
              </li>
            ))}
          </ul>
          <p className="helper-note">
            용어를 클릭하면 정의와 “왜 중요한가”가 열립니다. 용어명·영문명·분류로 검색할 수 있습니다(별칭 검색은
            목록 API에 별칭이 포함되지 않아 제공되지 않습니다).
          </p>
        </>
      )}
    </main>
  );
}

export default GlossaryView;
