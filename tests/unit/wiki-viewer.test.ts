// @version 1.0.0
/**
 * 위키 뷰어 순수 함수 시험(2026-10-23 위키 인앱 뷰어 설계 §7.2): 링크 재작성
 * 5규칙(D5), 헤딩 슬러그(한글 포함, 실측 앵커 2건), GitHub alert 콜아웃
 * 변환, slug·이미지 허용목록 해석(D3/D4). 렌더 대상 원본은 전부 저장소
 * 커밋 문서이므로 이 계층의 계약이 곧 보안·정확성 계약이다.
 */

import { test, expect, describe } from "bun:test";
import { decodePathSegment, defaultRewriteContext, getWikiPage, renderWikiMarkdown, resolveWikiImageFile, rewriteWikiLinks } from "../../app/web-next/lib/wiki.ts";
import { wikiHeadingSlug, wikiHeadingSlugs, stripInlineMarkdown } from "../../app/web-next/lib/wiki-heading-slug.ts";

const CTX = defaultRewriteContext();

describe("link rewriting (design D5 — five rules)", () => {
  test("rule 1: in-folder .md links → /wiki/<slug>, hash preserved", () => {
    expect(rewriteWikiLinks("[실사](31-공통-S9-실사.md)", CTX)).toBe("[실사](/wiki/31-공통-S9-실사)");
    // 원본에는 아직 없는(실측 0건) page.md#anchor 형태도 규칙상 해시를 보존한다
    expect(rewriteWikiLinks("[실사](31-공통-S9-실사.md#m-a-필수-검증-여섯-가지)", CTX)).toBe(
      "[실사](/wiki/31-공통-S9-실사#m-a-필수-검증-여섯-가지)",
    );
  });

  test("rule 1b: unknown in-folder targets are left as-is (broken beats silent)", () => {
    expect(rewriteWikiLinks("[없음](99-없는-문서.md)", CTX)).toBe("[없음](99-없는-문서.md)");
  });

  test("rule 2: Home.md → /wiki", () => {
    expect(rewriteWikiLinks("[홈](Home.md)", CTX)).toBe("[홈](/wiki)");
  });

  test("rule 3: images/ → /api/wiki/images/, unknown image kept", () => {
    expect(rewriteWikiLinks("![로그인 화면](images/common-01-login.png)", CTX)).toBe(
      "![로그인 화면](/api/wiki/images/common-01-login.png)",
    );
    expect(rewriteWikiLinks("![없는 그림](images/없는-그림.png)", CTX)).toBe("![없는 그림](images/없는-그림.png)");
  });

  test("rule 4: out-of-folder manuals → /library?doc=<id>, null mapping demoted to plain text", () => {
    expect(rewriteWikiLinks("[관리자 매뉴얼](../../manuals/admin-manual_ko.md)", CTX)).toBe(
      "[관리자 매뉴얼](/library?doc=man-admin-manual_ko)",
    );
    const ctx: Parameters<typeof rewriteWikiLinks>[1] = {
      slugs: new Set(["Home"]),
      imageFiles: new Set(),
      libraryLinks: { "../../manuals/없는-매뉴얼_ko.md": null },
    };
    // 매칭 실패는 링크를 평문으로 강등한다(생성기가 미리 판정한다 — 렌더 시 추측 없음)
    expect(rewriteWikiLinks("[없는 매뉴얼](../../manuals/없는-매뉴얼_ko.md)", ctx)).toBe("없는 매뉴얼");
    // 매핑에 없는 폴더 밖 대상은 원본 유지
    expect(rewriteWikiLinks("[기타](../../other/x.md)", CTX)).toBe("[기타](../../other/x.md)");
  });

  test("rule 5: pure in-page anchors, app-absolute and external URLs untouched", () => {
    expect(rewriteWikiLinks("[여섯 가지](#m-a-필수-검증-여섯-가지)", CTX)).toBe("[여섯 가지](#m-a-필수-검증-여섯-가지)");
    expect(rewriteWikiLinks("[보드](/deals)", CTX)).toBe("[보드](/deals)");
    expect(rewriteWikiLinks("[GitHub](https://github.com)", CTX)).toBe("[GitHub](https://github.com)");
  });

  test("rewriting is pure — the source markdown is not mutated", () => {
    const src = "[홈](Home.md) ![그림](images/common-01-login.png)";
    rewriteWikiLinks(src, CTX);
    expect(src).toBe("[홈](Home.md) ![그림](images/common-01-login.png)");
  });
});

describe("heading slugs (github-slugger compatible, measured anchors)", () => {
  test("measured case 1 (page 53): M&A → m-a (the source anchor convention)", () => {
    expect(wikiHeadingSlug("M&A 필수 검증 여섯 가지")).toBe("m-a-필수-검증-여섯-가지");
  });

  test("measured case 2 (page 54): plain Korean headings slug with hyphens", () => {
    expect(wikiHeadingSlug("합작 조건 기록하기")).toBe("합작-조건-기록하기");
  });

  test("punctuation dropped, case folded, link syntax stripped", () => {
    expect(wikiHeadingSlug("그린필드 사업성 분석하기 (S8)")).toBe("그린필드-사업성-분석하기-s8");
    expect(wikiHeadingSlug("0. 시작 ([01-시작하기](01-시작하기.md))")).toBe("0-시작-01-시작하기");
    expect(stripInlineMarkdown("**굵게**과 `코드`")).toBe("굵게과 코드");
  });

  test("duplicate headings get github-slugger style -1 suffixes", () => {
    expect(wikiHeadingSlugs(["단계", "단계", "단계"])).toEqual(["단계", "단계-1", "단계-2"]);
  });

  test("the renderer emits heading ids matching the generator's verification", () => {
    const body = "## M&A 필수 검증 여섯 가지\n\n[위로](#m-a-필수-검증-여섯-가지)\n\n## 합작 조건 기록하기\n";
    const html = renderWikiMarkdown(rewriteWikiLinks(body, CTX));
    expect(html).toContain('<h2 id="m-a-필수-검증-여섯-가지">');
    expect(html).toContain('<h2 id="합작-조건-기록하기">');
  });
});

describe("GitHub alert conversion (design D5 renderer add-on)", () => {
  test("NOTE blockquote becomes a callout div with a Korean label and parsed inner markdown", () => {
    const html = renderWikiMarkdown(rewriteWikiLinks("> [!NOTE]\n> **데모 자료**로 찍었습니다. [시작하기](Home.md)\n", CTX));
    expect(html).toContain('class="wiki-callout wiki-callout-note"');
    expect(html).toContain("노트");
    expect(html).toContain("<strong>데모 자료</strong>");
    expect(html).toContain('href="/wiki"');
    expect(html).not.toContain("<blockquote>");
  });

  test("WARNING becomes the amber callout variant", () => {
    const html = renderWikiMarkdown("> [!WARNING]\n> 되돌릴 수 없습니다.\n");
    expect(html).toContain('class="wiki-callout wiki-callout-warning"');
    expect(html).toContain("주의");
  });

  test("plain blockquotes are not converted", () => {
    const html = renderWikiMarkdown("> 그냥 인용문\n");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("wiki-callout");
  });
});

describe("slug and image allowlists (design D3/D4)", () => {
  test("wiki slug resolution is generated-keys-only (unknown → null → route 404)", () => {
    // getWikiPage는 키 집합 조회다 — 경로 핸들러가 null을 404 봉투로 바꾼다.
    expect(getWikiPage("31-공통-S9-실사")).not.toBeNull();
    expect(getWikiPage("Home")).not.toBeNull();
    expect(getWikiPage("../secret")).toBeNull();
    expect(getWikiPage("존재하지-않음")).toBeNull();
  });

  test("prototype-chain names are not page lookups (own-property contract)", () => {
    // `WIKI_CONTENT[slug] ?? null`은 프로토타입 체인을 참조해 이 이름들이
    // truthy(Object.prototype 멤버)를 반환했다(2차 검토 MAJOR) — own-property
    // 조회로 막고 여기서 핀다.
    expect(getWikiPage("__proto__")).toBeNull();
    expect(getWikiPage("constructor")).toBeNull();
    expect(getWikiPage("hasOwnProperty")).toBeNull();
    expect(getWikiPage("toString")).toBeNull();
  });

  test("image resolution normalizes the basename and rejects traversal (404 upstream)", () => {
    expect(resolveWikiImageFile("common-01-login.png")).toBe("common-01-login.png");
    expect(resolveWikiImageFile("images/common-01-login.png")).toBe("common-01-login.png");
    expect(resolveWikiImageFile("../../../etc/passwd")).toBeNull();
    expect(resolveWikiImageFile("..\\..\\secret.png")).toBeNull();
    expect(resolveWikiImageFile("not-in-allowlist.png")).toBeNull();
  });

  test("encoded segment decodes once; raw and malformed input pass through without throwing", () => {
    // 라우터가 인코딩된 세그먼트를 그대로 싣는 실측 결함의 해제 헬퍼 계약.
    expect(decodePathSegment("31-%EA%B3%B5%ED%86%B5-S9-%EC%8B%A4%EC%82%AC")).toBe("31-공통-S9-실사");
    // 이미 풀린 원값은 no-op(키 집합 조회와 동일한 문자열).
    expect(decodePathSegment("31-공통-S9-실사")).toBe("31-공통-S9-실사");
    // malformed 시퀀스(%zz)는 URIError 대신 원값 통과 — 경로가 500이 되지 않는다.
    expect(decodePathSegment("%zz")).toBe("%zz");
    expect(decodePathSegment("100%2")).toBe("100%2");
  });
});

describe("single tilde is not strikethrough (2026-10-23 defect fix)", () => {
  test("S1~S4 ranges render the literal tilde with zero <del> elements", () => {
    const html = renderWikiMarkdown("공통 단계 S1~S4를 지나 S8부터 두 길이 다시 만나 S12까지 함께 간다.");
    expect(html).toContain("S1~S4");
    expect(html).toContain("S12");
    expect(html).not.toContain("<del>");
  });

  test("the Home.md track-comparison cell renders intact inside a table", () => {
    // 실측 결함의 원형 셀 — marked의 단일 ~ del 토크나이저가 셀을
    // "S1"+취소선("S4 → S8~")+S12로 삼켰다. 두 범위 모두 평문으로 남아야 한다.
    const html = renderWikiMarkdown("| 길 | 경로 |\n|---|---|\n| 그린필드 | S1~S4 → **S5** → S8~S12 |\n");
    expect(html).toContain("<td>S1~S4 → <strong>S5</strong> → S8~S12</td>");
    expect(html).not.toContain("<del>");
  });

  test("double tilde is likewise plain text — the corpus never uses strikethrough (measured)", () => {
    // docs/wiki/ko 전역 grep 실측 0건: 취소선 문법은 위키 원문에 없으므로
    // 이중 물결도 토크나이저가 삼키지 않는 쪽이 정확하다(단일·이중 함께 비활성).
    const html = renderWikiMarkdown("~~취소선~~ 문장");
    expect(html).toContain("~~취소선~~");
    expect(html).not.toContain("<del>");
  });
});

describe("images render as figure + figcaption with a new-tab full-size link (2026-10-26 design §2)", () => {
  test("a lone image paragraph becomes <figure class=doc-figure> with alt as figcaption", () => {
    const html = renderWikiMarkdown("![로그인 화면](/api/wiki/images/login.png)");
    expect(html).toContain('<figure class="doc-figure">');
    expect(html).toContain('<figcaption>로그인 화면</figcaption>');
    expect(html).toContain('href="/api/wiki/images/login.png" target="_blank" rel="noopener"');
    expect(html).toContain('<img src="/api/wiki/images/login.png" alt="로그인 화면"');
    expect(html).not.toContain("<p><figure");
  });
  test("link accessible name comes from the caller-supplied i18n label", () => {
    const html = renderWikiMarkdown("![Login](/x.png)", { fullSizeLabel: (alt) => `Open full size: ${alt}` });
    expect(html).toContain('aria-label="Open full size: Login"');
  });
  test("empty alt: no caption, alt=\"\" kept", () => {
    const html = renderWikiMarkdown("![](/x.png)");
    expect(html).not.toContain("<figcaption>");
    expect(html).toContain('alt=""');
    expect(html).toContain("<figure");
  });
  test("inline image inside a sentence keeps the paragraph (link-wrapped, no figure)", () => {
    const html = renderWikiMarkdown("앞 ![아이콘](/i.png) 뒤");
    expect(html).not.toContain("<figure");
    expect(html).toContain("<p>앞 ");
    expect(html).toContain('target="_blank"');
  });
  test("alt text is attribute-escaped", () => {
    const html = renderWikiMarkdown('![a "b" <c>](/x.png)');
    expect(html).toContain('alt="a &quot;b&quot; &lt;c&gt;"');
  });
});
