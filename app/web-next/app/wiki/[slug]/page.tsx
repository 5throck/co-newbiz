"use client";

// /wiki/[slug] — 위키 본문 열람(2026-10-23 위키 인앱 뷰어 설계 D1/§4/D7).
// slug는 화면 상태일 뿐 fs에 닿지 않고(데이터는 키 집합 조회 API에서 온다),
// 왼쪽 열은 _Sidebar.md 투영의 여정 그룹으로 현재 페이지를 하이라이트한다.
// 모바일에서는 왼쪽 열이 본문 위로 내려온다(library와 같은 media query 규약).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "../../../lib/api.ts";
import { decodePathSegment, defaultRewriteContext, renderWikiMarkdown, rewriteWikiLinks } from "../../../lib/wiki.ts";
import type { WikiPageContent, WikiSidebarGroup } from "../../../lib/wiki.ts";

// 렌더 대상은 저장소에 커밋된 위키 원본뿐(인덱스 화면과 동일 신뢰 모델).
function WikiMarkdown({ text }: { text: string }) {
  const rewritten = rewriteWikiLinks(text, defaultRewriteContext());
  const html = renderWikiMarkdown(rewritten);
  return <div className="library-doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

// 문서 속성 배지(설계 §4 — [how-to] [S9] [공통] [P1] · 검증일 줄).
function PageBadges({ page }: { page: WikiPageContent }) {
  return (
    <ul className="wiki-badges" aria-label="문서 속성">
      <li className="wiki-badge">{page.doc_type}</li>
      {page.stage && <li className="wiki-badge">{page.stage}</li>}
      {(page.tracks ?? []).map((t) => (
        <li key={t} className="wiki-badge">
          {t}
        </li>
      ))}
      {(page.personas ?? []).map((p) => (
        <li key={p} className="wiki-badge">
          {p}
        </li>
      ))}
      {page.verified_on && <li className="wiki-badge wiki-badge-verified">{page.verified_on} 검증</li>}
    </ul>
  );
}

function JourneyNav({ groups, current }: { groups: WikiSidebarGroup[]; current: string | null }) {
  return (
    <nav className="wiki-toc" aria-label="안내서 여정 목차">
      <ul className="wiki-group-items">
        <li>
          <Link
            href="/wiki"
            className={current === null ? "wiki-toc-item wiki-toc-current" : "wiki-toc-item"}
            aria-current={current === null ? "page" : undefined}
          >
            홈
          </Link>
        </li>
      </ul>
      {groups.map((g) => (
        <div key={g.group} className="wiki-toc-group">
          <h3 className="wiki-group-title">{g.group}</h3>
          <ul className="wiki-group-items">
            {g.items.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/wiki/${item.slug}`}
                  className={item.slug === current ? "wiki-toc-item wiki-toc-current" : "wiki-toc-item"}
                  aria-current={item.slug === current ? "page" : undefined}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function WikiPageView() {
  // useParams는 세그먼트를 인코딩된 채 돌려준다(실측 결함: 인코딩된 값을
  // encodeURIComponent로 다시 싸서 이중 인코딩 URL로 조회 → 404). 한 번 풀어
  // 상태로 쓴다 — fetch 인자·목차 하이라이트·effect 의존성이 전부 이 값이다.
  const rawSlug = useParams<{ slug: string }>().slug;
  const slug = decodePathSegment(rawSlug ?? "");
  const [groups, setGroups] = useState<WikiSidebarGroup[]>([]);
  const [footer, setFooter] = useState("");
  const [page, setPage] = useState<WikiPageContent | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ groups: WikiSidebarGroup[]; footer: string }>("/api/wiki")
      .then((r) => {
        setGroups(r.data.groups);
        setFooter(r.data.footer);
      })
      .catch(() => setGroups([])); // 목차 실패는 본문 열람을 막지 않는다
  }, []);

  useEffect(() => {
    setMissing(false);
    setError(null);
    setPage(null);
    api
      .get<WikiPageContent>(`/api/wiki/${encodeURIComponent(slug)}`)
      .then((r) => setPage(r.data))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof Error ? err.message : "불러오기 실패");
      });
  }, [slug]);

  return (
    <main>
      <div className="wiki-layout">
        <JourneyNav groups={groups} current={slug} />
        <div className="wiki-content-pane">
          {missing ? (
            <p role="alert">해당 문서를 찾을 수 없습니다. 왼쪽 목록에서 페이지를 고르세요.</p>
          ) : error ? (
            <p role="alert" className="text-[color:var(--red-fg)]">
              {error}
            </p>
          ) : !page ? (
            <p>불러오는 중...</p>
          ) : (
            <>
              <PageBadges page={page} />
              <WikiMarkdown text={page.body} />
              {/* 푸터도 본문과 같은 파이프라인으로 그린다 — 원문에 마크다운 링크가
                  있어 평문 렌더로는 링크가 동작하지 않는다(2차 검토). */}
              {footer && (
                <div className="wiki-footer-note wiki-content-footer">
                  <WikiMarkdown text={footer} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default WikiPageView;
