"use client";

// /wiki — 사용자 안내서 위키 인덱스(2026-10-23 위키 인앱 뷰어 설계 D1/§4).
// docs/wiki/ko/는 그대로 SSOT(GitHub 위키 미러링 전제)이고 이 화면은 생성
// 투영(wiki.generated.ts)과 /api/wiki·/api/wiki/[slug]로 읽기만 한다.
// Home.md 본문 + _Sidebar.md의 여정 그룹 순 페이지 목록. 위키 자체의 여정
// 내비는 전역 사이드바에 넣지 않고 [slug] 화면 안 왼쪽 열로 낸다(D6).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { defaultRewriteContext, renderWikiMarkdown, rewriteWikiLinks } from "../../lib/wiki.ts";
import type { WikiPageSummary, WikiSidebarGroup } from "../../lib/wiki.ts";

interface WikiIndexData {
  pages: WikiPageSummary[];
  groups: WikiSidebarGroup[];
  footer: string;
}

interface WikiPageData {
  slug: string;
  title: string;
  body: string;
}

// Home 본문의 첫 h1은 화면 제목(사용 안내서)과 겹치므로 인덱스에서만 벗기고
// 렌더한다(설계 §4 목업 — 제목 아래 "처음이라면" 절부터 이어짐). 원본은
// 재작성하지 않고 렌더 직전 문자열에서만 뗀다.
function stripLeadingH1(body: string): string {
  return body.replace(/^#\s+.+?\n+/, "");
}

// 렌더 대상은 저장소에 커밋된 위키 원본뿐이고 사용자 입력이 이 경로로 들어올
// 방법이 없다(키 집합 조회뿐, 쓰기 경로 없음) — /library와 동일 근거로
// dangerouslySetInnerHTML을 쓴다.
function WikiMarkdown({ text, stripTitle = false }: { text: string; stripTitle?: boolean }) {
  const rewritten = rewriteWikiLinks(stripTitle ? stripLeadingH1(text) : text, defaultRewriteContext());
  const html = renderWikiMarkdown(rewritten);
  return <div className="library-doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function WikiIndexView() {
  const t = useTranslations("pages.wiki");
  const tc = useTranslations("common");
  const [index, setIndex] = useState<WikiIndexData | null>(null);
  const [home, setHome] = useState<WikiPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<WikiIndexData>("/api/wiki")
      .then((r) => setIndex(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    api
      .get<WikiPageData>("/api/wiki/Home")
      .then((r) => setHome(r.data))
      .catch(() => setHome(null)); // Home 미존재는 인덱스 목록만으로도 화면이 성립한다
  }, []);

  return (
    <main>
      <h1>{t("heading")}</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("introPre")}
        <code className="library-doc-path"> docs/wiki/ko/</code>{t("introPost")}
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {home && (
        <section className="wiki-home-body" aria-label={t("homeSectionAria")}>
          <WikiMarkdown text={home.body} stripTitle />
        </section>
      )}
      {index && (
        <section aria-label={t("listSectionAria")}>
          <h2 className="wiki-list-title">{t("listHeading")}</h2>
          <div className="wiki-groups">
            {index.groups.map((g) => (
              <div key={g.group} className="wiki-group">
                <h3 className="wiki-group-title">{g.group}</h3>
                <ul className="wiki-group-items">
                  {g.items.map((item) => (
                    <li key={item.slug}>
                      <Link href={`/wiki/${item.slug}`}>{item.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {/* 푸터는 원문이 마크다운 링크([변경 이력](82-변경-이력.md))를 담고
              있으므로 본문과 같은 재작성·렌더 파이프라인으로 그린다(2차 검토). */}
          <div className="wiki-footer-note">
            <WikiMarkdown text={index.footer} />
          </div>
        </section>
      )}
      {!index && !error && <p>{tc("loading")}</p>}
    </main>
  );
}

export default WikiIndexView;
