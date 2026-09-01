"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";

// 규정·체크리스트 — 운영 매뉴얼·규정·체크리스트 문서를 열람한다.
// (딜 단위 체크리스트 판정은 S4 이후 흐름 재구축 시 다시 제공된다.)

type Category = "checklist" | "manual" | "policy";

interface ChecklistDoc {
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
}

// ── 문서 열람 탭 (기존 뷰어) ────────────────────────────────────────────────
function MarkdownView({ text }: { text: string }) {
  const stripped = text.startsWith("---\n") ? text.slice(text.indexOf("\n---", 4) + 4).replace(/^\n+/, "") : text;
  const blocks: React.ReactNode[] = [];
  const lines = stripped.split("\n");
  let list: string[] = [];
  let code: string[] | null = null;
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {list.map((li, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inline(li) }} />
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of lines) {
    if (code !== null) {
      if (line.startsWith("```")) {
        blocks.push(
          <pre key={`code-${blocks.length}`} className="library-code">
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.startsWith("```")) {
      flushList();
      code = [];
    } else if (/^#{1,4}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#+\s*/, "");
      blocks.push(
        level <= 2 ? (
          <h2 key={`h-${blocks.length}`}>{content}</h2>
        ) : (
          <h3 key={`h-${blocks.length}`}>{content}</h3>
        ),
      );
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      list.push(line.replace(/^\s*([-*]|\d+\.)\s*/, ""));
    } else if (line.startsWith("> ")) {
      flushList();
      blocks.push(
        <p key={`p-${blocks.length}`} className="library-blockquote" dangerouslySetInnerHTML={{ __html: inline(line.replace(/^>\s*/, "")) }} />,
      );
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={`p-${blocks.length}`} dangerouslySetInnerHTML={{ __html: inline(line) }} />);
    }
  }
  flushList();
  if (code !== null)
    blocks.push(
      <pre key="code-tail" className="library-code">
        <code>{code.join("\n")}</code>
      </pre>,
    );
  return <div className="library-doc-body">{blocks}</div>;
}

function DocViewer({ docs }: { docs: DocSummary[] }) {
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
              <code className="library-doc-path">{detail.file}</code>
            </div>
            <MarkdownView text={detail.content} />
          </>
        )}
      </div>
    </div>
  );
}

// ── 페이지 ─────────────────────────────────────────────────────────────────
export function LibraryView() {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docCategory, setDocCategory] = useState<Category>("manual");

  useEffect(() => {
    api
      .get<DocSummary[]>("/api/library")
      .then((r) => setDocs(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  const checklists = useMemo(() => (docs ?? []).filter((d) => d.category === "checklist"), [docs]);
  const docList = useMemo(() => (docs ?? []).filter((d): d is DocSummary => d.category === docCategory), [docs, docCategory]);

  return (
    <main>
      <h1>규정·체크리스트</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        운영 매뉴얼·규정·체크리스트 문서를 열람합니다. (딜 단위 체크리스트 판정은 S4 이후 흐름 재구축 시 제공됩니다.)
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
            <button type="button" role="tab" aria-selected={docCategory === "manual"} className={`library-tab ${docCategory === "manual" ? "library-tab-active" : ""}`} onClick={() => setDocCategory("manual")}>
              운영 매뉴얼
            </button>
            <button type="button" role="tab" aria-selected={docCategory === "policy"} className={`library-tab ${docCategory === "policy" ? "library-tab-active" : ""}`} onClick={() => setDocCategory("policy")}>
              규정
            </button>
            <button type="button" role="tab" aria-selected={docCategory === "checklist"} className={`library-tab ${docCategory === "checklist" ? "library-tab-active" : ""}`} onClick={() => setDocCategory("checklist")}>
              체크리스트
            </button>
          </div>
          <DocViewer docs={docList} />
        </>
      )}
    </main>
  );
}

export default LibraryView;
