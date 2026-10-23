// @version 1.0.0
/**
 * 위키 뷰어 순수 함수 시험(2026-10-23 위키 인앱 뷰어 설계 §7.2): 링크 재작성
 * 5규칙(D5), 헤딩 슬러그(한글 포함, 실측 앵커 2건), GitHub alert 콜아웃
 * 변환, slug·이미지 허용목록 해석(D3/D4). 렌더 대상 원본은 전부 저장소
 * 커밋 문서이므로 이 계층의 계약이 곧 보안·정확성 계약이다.
 */

import { test, expect, describe } from "bun:test";
import { defaultRewriteContext, getWikiPage, renderWikiMarkdown, resolveWikiImageFile, rewriteWikiLinks } from "../../app/web-next/lib/wiki.ts";
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
});
