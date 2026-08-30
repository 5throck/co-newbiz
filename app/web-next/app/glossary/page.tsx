"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type GlossaryTermSummary } from "../../lib/api.ts";

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
  const [terms, setTerms] = useState<GlossaryTermSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<GlossaryTermDetail | null>(null);

  useEffect(() => {
    api
      .get<GlossaryTermSummary[]>("/api/glossary")
      .then((r) => setTerms(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

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
    return terms.filter((t) =>
      [t.key, t.ko, t.en, t.category].some((f) => f.toLowerCase().includes(needle)),
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
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {filtered === null ? (
        <p>불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">검색어와 일치하는 용어가 없습니다.</p>
      ) : (
        <>
          <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">총 {filtered.length}건 · 카드를 클릭하면 상세가 열립니다</p>
          <div className="glossary-split">
            <ul className="glossary-grid">
              {filtered.map((t) => (
                <li key={t.key} className="glossary-card">
                  <button
                    type="button"
                    className={`glossary-card-open ${selectedKey === t.key ? "glossary-card-active" : ""}`}
                    onClick={() => loadDetail(t.key)}
                  >
                    <div className="glossary-card-head">
                      <strong>{t.ko}</strong>
                      {t.category && <span className="dd-category-badge">{t.category}</span>}
                    </div>
                    <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
                      {t.en} · <code>{t.key}</code>
                    </p>
                    <GlossaryPreview termKey={t.key} />
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
  if (!detail) {
    return (
      <aside className="glossary-detail" aria-label="용어 상세">
        <p className="text-[color:var(--muted-fg)] italic">
          {loading ? "불러오는 중..." : "카드를 클릭하면 상세가 표시됩니다."}
        </p>
      </aside>
    );
  }
  return (
    <aside className="glossary-detail" aria-label={`${detail.ko} 상세`}>
      <div className="glossary-detail-head">
        <h2>{detail.ko}</h2>
        <button type="button" className="btn-ghost" onClick={onClose} aria-label="상세 닫기">
          닫기
        </button>
      </div>
      <p className="glossary-detail-en">
        {detail.en} · <code>{detail.key}</code>
        {detail.category && <span className="dd-category-badge ml-2">{detail.category}</span>}
      </p>
      <section aria-label="정의">
        <h3>정의</h3>
        <p>{detail.definition_ko || "—"}</p>
      </section>
      <section aria-label="왜 중요한가">
        <h3>왜 중요한가</h3>
        <p>{detail.why_it_matters_ko || "—"}</p>
      </section>
      {detail.aliases && detail.aliases.length > 0 && (
        <section aria-label="별칭">
          <h3>별칭</h3>
          <p>{detail.aliases.join(", ")}</p>
        </section>
      )}
      {detail.related && detail.related.length > 0 && (
        <section aria-label="관련 용어">
          <h3>관련 용어</h3>
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
        <section aria-label="사용 프로시저·스킬">
          <h3>사용 프로시저·스킬</h3>
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
        <section aria-label="소유 에이전트">
          <h3>소유 에이전트</h3>
          <p>
            <code>{detail.owner}</code>
          </p>
        </section>
      )}
    </aside>
  );
}

export default GlossaryView;
