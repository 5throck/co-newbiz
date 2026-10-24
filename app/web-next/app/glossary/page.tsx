"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type GlossaryTermSummary } from "../../lib/api.ts";
import { dedupTermNames, glossaryCategoryLabel } from "../../lib/labels.ts";

// 용어집 (Glossary) — 목록 카드(정의 미리보기 포함) + 클릭 시 상세 사이드
// 패널(정의·중요성·별칭·관련 용어·사용 프로시저/스킬·소유 에이전트). 상세는
// GET /api/glossary/:term의 전체 레코드를 사용한다.

interface GlossaryTermDetail extends GlossaryTermSummary {
  definition_ko: string;
  why_it_matters_ko: string;
  aliases?: string[];
  related?: string[];
  used_in?: string[];
  owner?: string;
}

export function GlossaryView() {
  const t = useTranslations("pages.glossary");
  const tc = useTranslations("common");
  const [terms, setTerms] = useState<GlossaryTermSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<GlossaryTermDetail | null>(null);

  useEffect(() => {
    api
      .get<GlossaryTermSummary[]>("/api/glossary")
      .then((r) => setTerms(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [tc]);

  const loadDetail = useCallback((key: string) => {
    setSelectedKey(key);
    api
      .get<GlossaryTermDetail>(`/api/glossary/${encodeURIComponent(key)}`)
      .then((r) => setDetail(r.data))
      .catch(() => setDetail(null));
  }, []);

  const filtered = useMemo(() => {
    if (terms === null) return null;
    const needle = query.trim().toLowerCase();
    if (needle === "") return terms;
    return terms.filter((term) =>
      [term.key, term.ko, term.en, term.category].some((f) => f.toLowerCase().includes(needle)),
    );
  }, [terms, query]);

  return (
    <main>
      <h1>{t("heading")}</h1>
      <input
        type="search"
        aria-label={t("searchAria")}
        placeholder={t("phSearch")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {filtered === null ? (
        <p>{tc("loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{t("totalCount", { count: filtered.length })}</p>
          <div className="glossary-split">
            <ul className="glossary-grid">
              {filtered.map((term) => (
                <li key={term.key} className="glossary-card">
                  <button
                    type="button"
                    className={`glossary-card-open ${selectedKey === term.key ? "glossary-card-active" : ""}`}
                    onClick={() => loadDetail(term.key)}
                  >
                    <div className="glossary-card-head">
                      <strong>{dedupTermNames(term.ko, term.en).primary}</strong>
                      {term.category && <span className="dd-category-badge">{glossaryCategoryLabel(term.category).label}</span>}
                    </div>
                    <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
                      {dedupTermNames(term.ko, term.en).secondary && `${dedupTermNames(term.ko, term.en).secondary} · `}
                      <code>{term.key}</code>
                    </p>
                    <GlossaryPreview termKey={term.key} />
                  </button>
                </li>
              ))}
            </ul>
            <GlossaryDetailPanel
              detail={detail}
              loading={!!selectedKey && !detail}
              onOpenTerm={loadDetail}
              onClose={() => {
                setSelectedKey(null);
                setDetail(null);
              }}
            />
          </div>
        </>
      )}
    </main>
  );
}

// 목록 카드의 정의 미리보기 — 상세 로딩 없이 목록 API 범위에서 첫 줄만 노출.
// (목록 페이로드에 정의가 없으므로 상세를 한 번 가져와 캐시한다.)
const previewCache = new Map<string, string>();

function GlossaryPreview({ termKey }: { termKey: string }) {
  const [preview, setPreview] = useState<string | null>(previewCache.get(termKey) ?? null);
  useEffect(() => {
    if (previewCache.has(termKey)) {
      setPreview(previewCache.get(termKey) ?? null);
      return;
    }
    let alive = true;
    api
      .get<GlossaryTermDetail>(`/api/glossary/${encodeURIComponent(termKey)}`)
      .then((r) => {
        const line = (r.data.definition_ko || "").split(/[.。]/)[0];
        previewCache.set(termKey, line);
        if (alive) setPreview(line);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [termKey]);
  return preview ? (
    <p className="glossary-preview">{preview}</p>
  ) : null;
}

function GlossaryDetailPanel({
  detail,
  loading,
  onOpenTerm,
  onClose,
}: {
  detail: GlossaryTermDetail | null;
  loading: boolean;
  onOpenTerm: (key: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pages.glossary");
  const tc = useTranslations("common");
  if (!detail) {
    return (
      <aside className="glossary-detail" aria-label={t("detailAriaEmpty")}>
        <p className="text-[color:var(--muted-fg)] italic">
          {loading ? tc("loading") : t("detailEmptyPrompt")}
        </p>
      </aside>
    );
  }
  return (
    <aside className="glossary-detail" aria-label={t("detailAria", { name: detail.ko })}>
      <div className="glossary-detail-head">
        <h2>{detail.ko}</h2>
        <button type="button" className="btn-ghost" onClick={onClose} aria-label={t("closeAria")}>
          {tc("close")}
        </button>
      </div>
      <p className="glossary-detail-en">
        {dedupTermNames(detail.ko, detail.en).secondary && `${dedupTermNames(detail.ko, detail.en).secondary} · `}
        <code>{detail.key}</code>
        {detail.category && <span className="dd-category-badge ml-2">{glossaryCategoryLabel(detail.category).label}</span>}
      </p>
      <section aria-label={t("secDefinition")}>
        <h3>{t("secDefinition")}</h3>
        <p>{detail.definition_ko || "—"}</p>
      </section>
      <section aria-label={t("secWhy")}>
        <h3>{t("secWhy")}</h3>
        <p>{detail.why_it_matters_ko || "—"}</p>
      </section>
      {detail.aliases && detail.aliases.length > 0 && (
        <section aria-label={t("secAliases")}>
          <h3>{t("secAliases")}</h3>
          <p>{detail.aliases.join(", ")}</p>
        </section>
      )}
      {detail.related && detail.related.length > 0 && (
        <section aria-label={t("secRelated")}>
          <h3>{t("secRelated")}</h3>
          <div className="glossary-related">
            {detail.related.map((r) => (
              <button key={r} type="button" className="btn-ghost" onClick={() => onOpenTerm(r)}>
                {r}
              </button>
            ))}
          </div>
        </section>
      )}
      {detail.used_in && detail.used_in.length > 0 && (
        <section aria-label={t("secUsedIn")}>
          <h3>{t("secUsedIn")}</h3>
          <ul className="glossary-usedin">
            {detail.used_in.map((u) => (
              <li key={u}>
                <code>{u}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {detail.owner && (
        <section aria-label={t("secOwner")}>
          <h3>{t("secOwner")}</h3>
          <p>
            <code>{detail.owner}</code>
          </p>
        </section>
      )}
    </aside>
  );
}

export default GlossaryView;
