"use client";

import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { ReviewBadgeChip } from "../../components/ReviewBadge.tsx";
import type { ReviewStatus } from "../../lib/checklist-review-status.ts";

// 문서 허브 — 정책집·절차서·체크리스트·매뉴얼·참고문서·템플릿·디자인·DD 실사
// 문서 전체를 저장소 원본에서 실시간으로 읽어 열람하는 단일 화면(ADR-0108).
// 예전에는 이 화면과 별도로 정적 빌드되는 knowledge-hub 포털이 있었으나,
// 두 표면이 같은 원본을 서로 다른 방식으로 복제해 SSOT가 깨지는 문제가 있어
// 폐기하고 이 화면 하나로 합쳤다.

type Category = "checklist" | "manual" | "policy" | "procedure" | "reference" | "template" | "design" | "dd" | "runbook" | "guideline";

interface DocSummary {
  id: string;
  category: Category;
  title: string;
  file: string;
  gate?: string;
  enforceability?: string;
  version?: string;
  owner_agent?: string;
  item_count?: number;
  lang: "en" | "ko";
}

interface DocContent {
  id: string;
  title: string;
  file: string;
  content: string;
  version?: string;
  enforceability?: string;
  owner_agent?: string;
  review_items?: Array<{ id: string; review_status?: ReviewStatus; reviewer?: string; verified_on?: string }>;
}

// ── 문서 열람 탭 ─────────────────────────────────────────────────────────
// `marked`로 렌더링(표 포함 CommonMark 전체 지원) — 이전의 손수 만든 파서는
// 표 문법이 없어 design/dd 문서(표를 광범위하게 씀)가 깨져 보였다. 렌더 대상은
// 저장소에 커밋된 내부 문서(정책/절차/체크리스트/설계 가이드)뿐이고 사용자
// 입력이 이 경로로 들어올 방법이 없으므로(lib/library.ts는 고정 파일 목록만
// 읽음, 쓰기 경로 없음) XSS 표면이 아니다 — 이전 손수 파서도 동일 신뢰 모델로
// dangerouslySetInnerHTML을 이미 쓰고 있었다.
function MarkdownView({ text }: { text: string }) {
  const stripped = text.startsWith("---\n") ? text.slice(text.indexOf("\n---", 4) + 4).replace(/^\n+/, "") : text;
  const html = marked.parse(stripped, { async: false });
  return <div className="library-doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function DocViewer({ docs, allDocs }: { docs: DocSummary[]; allDocs: DocSummary[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setError(null);
    api
      .get<DocContent>(`/api/library/${selectedId}`)
      .then((r) => setDetail(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [selectedId]);

  // 페어 문서 전환 — frontmatter의 `counterpart:` 파일을 같은 카테고리 목록에서 찾는다.
  const counterpartDoc = useMemo(() => {
    if (!detail) return null;
    const m = detail.content.match(/^counterpart:\s*(\S+)\s*$/m);
    if (!m) return null;
    const targetFile = detail.file.replace(/[^/]+$/, m[1]);
    return allDocs.find((d) => d.file === targetFile) ?? null;
  }, [detail, allDocs]);

  return (
    <div className="library-layout">
      <div className="library-list-pane">
        <ul className="library-doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={`library-doc-item ${selectedId === d.id ? "library-doc-item-active" : ""}`}
                onClick={() => setSelectedId(d.id)}
              >
                <span className="library-doc-title">{d.title}</span>
                <span className="library-doc-meta">
                  <span className="library-doc-lang">{d.lang.toUpperCase()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="library-content-pane">
        {!selectedId ? (
          <p className="text-[color:var(--muted-fg)] italic">왼쪽에서 문서를 선택하면 내용이 표시됩니다.</p>
        ) : error ? (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {error}
          </p>
        ) : !detail ? (
          <p>불러오는 중...</p>
        ) : (
          <>
            <div className="library-content-head">
              <h2 className="library-content-title">{detail.title}</h2>
              {counterpartDoc && (
                <button
                  type="button"
                  className="library-tab"
                  onClick={() => setSelectedId(counterpartDoc.id)}
                >
                  {counterpartDoc.lang === "ko" ? "한국어로 보기" : "Read in English"}
                </button>
              )}
              <code className="library-doc-path">{detail.file}</code>
            </div>
            {detail.review_items && detail.review_items.length > 0 && (
              <ul className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[length:var(--fs-caption)]" aria-label="항목별 검토 상태">
                {detail.review_items.map((i) => (
                  <li key={i.id}>
                    <span className="tabular-nums">{i.id}</span>
                    <ReviewBadgeChip item={i} />
                  </li>
                ))}
              </ul>
            )}
            <MarkdownView text={detail.content} />
          </>
        )}
      </div>
    </div>
  );
}

// 탭 순서·라벨. lib/library.ts의 LibraryCategory와 1:1 대응.
const CATEGORY_TABS: Array<{ category: Category; label: string }> = [
  { category: "policy", label: "규정집" },
  { category: "procedure", label: "업무절차서" },
  { category: "checklist", label: "체크리스트" },
  { category: "manual", label: "업무 매뉴얼" },
  { category: "runbook", label: "런북/플레이북" },
  { category: "guideline", label: "가이드라인" },
  { category: "reference", label: "참고문서" },
  { category: "template", label: "산출물 템플릿" },
  { category: "design", label: "디자인" },
  { category: "dd", label: "DD 실사" },
];

// 언어 필터 — 기본값은 전체. 문서는 ko/en 페어 파일로 관리되고 언어가 섞인
// 문서는 없으므로 필터는 ko/en만 좁혀 본다.
type LangFilter = "ko" | "en" | "all";
const LANG_OPTIONS: Array<{ value: LangFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

// ── 페이지 ─────────────────────────────────────────────────────────────────
export function LibraryView() {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docCategory, setDocCategory] = useState<Category>("policy");
  const [langFilter, setLangFilter] = useState<LangFilter>("all");

  useEffect(() => {
    api
      .get<DocSummary[]>("/api/library")
      .then((r) => setDocs(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  const docList = useMemo(
    () =>
      (docs ?? []).filter(
        (d): d is DocSummary => d.category === docCategory && (langFilter === "all" || d.lang === langFilter),
      ),
    [docs, docCategory, langFilter],
  );

  const categoryLabel = CATEGORY_TABS.find((t) => t.category === docCategory)?.label ?? docCategory;

  return (
    <main>
      <h1>문서 허브</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        정책집·절차서·체크리스트·매뉴얼·참고문서·템플릿·디자인 가이드·DD 실사 문서를 저장소 원본에서
        실시간으로 읽어 열람합니다. (검토/안건 단위 체크리스트 판정은 S4 이후 흐름 재구축 시 제공됩니다.)
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {docs === null ? (
        <p>불러오는 중...</p>
      ) : (
        <>
          <div className="library-tabs" role="tablist" aria-label="문서 종류">
            {CATEGORY_TABS.map(({ category, label }) => (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={docCategory === category}
                className={`library-tab ${docCategory === category ? "library-tab-active" : ""}`}
                onClick={() => setDocCategory(category)}
              >
                {label}
              </button>
            ))}
          </div>
          <SectionToolbar
            title={categoryLabel}
            icon="📄"
            count={docList.length}
            filters={
              <label className="section-meta">
                언어{" "}
                <select
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value as LangFilter)}
                  className="sizing-new-input sizing-new-input-sm"
                  aria-label="문서 언어 필터"
                >
                  {LANG_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            }
          />
          <DocViewer docs={docList} allDocs={docs} />
        </>
      )}
    </main>
  );
}

export default LibraryView;
