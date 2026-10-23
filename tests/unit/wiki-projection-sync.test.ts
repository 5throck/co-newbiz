// @version 1.0.0
/**
 * wiki.generated.ts 드리프트 가드(2026-10-23 위키 인앱 뷰어 설계 §7.1) +
 * 생성기 순수 헬퍼 단위 시험. 라이브러리의 tests/unit/
 * library-projection-sync.test.ts가 배운 교훈대로 known-stale 목록은
 * 처음부터 두지 않는다 — 원본을 고쳤는데 투영을 재생성하지 않으면 여기서
 * 붉어진다(강제 장치는 /sync가 도는 단위 시험 스위트).
 *
 * 드리프트 검출은 생성기 --check의 재균 재생성 비교로 한다: 생성기가 원본을
 * 다시 읽어 같은 바이트가 나오는지 판정하므로 요약·본문·사이드바 그룹·푸터·
 * 이미지 목록 전부가 한 번에 덮인다.
 */

import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLibraryLinks,
  classifyPageLinks,
  extractHeadings,
  pageOrder,
  parseFrontmatter,
  parseSidebarGroups,
  verifyPageBody,
} from "../../scripts/co-newbiz/sync-wiki-projection.ts";
import { wikiHeadingSlugs } from "../../app/web-next/lib/wiki-heading-slug.ts";
import {
  WIKI_CONTENT,
  WIKI_FOOTER,
  WIKI_IMAGE_FILES,
  WIKI_LIBRARY_LINKS,
  WIKI_PAGES,
  WIKI_SIDEBAR_GROUPS,
} from "../../app/web-next/lib/wiki.generated.ts";

const ROOT = join(import.meta.dirname, "../..");

describe("wiki.generated.ts matches docs/wiki/ko/ (drift guard)", () => {
  test("generator --check passes (byte-identical regeneration)", () => {
    const proc = Bun.spawnSync(["bun", join(ROOT, "scripts", "co-newbiz", "sync-wiki-projection.ts"), "--check"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode, `stale projection — run: bun scripts/co-newbiz/sync-wiki-projection.ts\n${proc.stderr.toString()}`).toBe(0);
  });

  test("projection shape: 36 content pages + Home, numeric order, sorted", () => {
    expect(WIKI_PAGES.length).toBe(37);
    expect(WIKI_PAGES[0].slug).toBe("Home");
    const orders = WIKI_PAGES.map((p) => p.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (const page of WIKI_PAGES) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.doc_type.length).toBeGreaterThan(0);
      expect(page.verified_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(WIKI_CONTENT[page.slug]?.body.length).toBeGreaterThan(0);
    }
  });

  test("every projected body equals its source minus frontmatter (spot: Home, 53)", () => {
    for (const slug of ["Home", "53-브라운필드-S9-실사"]) {
      const { body } = parseFrontmatter(readFileSync(join(ROOT, "docs", "wiki", "ko", `${slug}.md`), "utf-8"));
      expect(WIKI_CONTENT[slug].body).toBe(body);
      expect(WIKI_CONTENT[slug].body).not.toMatch(/^---\n/); // frontmatter는 벗겨져 있다
    }
  });

  test("sidebar groups cover every non-Home page exactly once (no orphans)", () => {
    const inGroups = WIKI_SIDEBAR_GROUPS.flatMap((g) => g.items.map((i) => i.slug));
    expect(WIKI_SIDEBAR_GROUPS.some((g) => g.group === "기타")).toBe(false);
    expect(new Set(inGroups).size).toBe(inGroups.length);
    const pages = new Set(WIKI_PAGES.map((p) => p.slug));
    for (const slug of inGroups) expect(pages.has(slug), `${slug} not a projected page`).toBe(true);
    const orphans = [...pages].filter((s) => s !== "Home" && !inGroups.includes(s));
    expect(orphans).toEqual([]);
  });

  test("footer and image allowlist match the source tree", () => {
    const footerRaw = parseFrontmatter(readFileSync(join(ROOT, "docs", "wiki", "ko", "_Footer.md"), "utf-8")).body;
    expect(WIKI_FOOTER).toBe(footerRaw);
    expect(WIKI_IMAGE_FILES).toEqual(readdirSync(join(ROOT, "docs", "wiki", "ko", "images")).sort());
    expect(WIKI_IMAGE_FILES.every((f) => f.endsWith(".png"))).toBe(true);
  });

  test("out-of-folder manual links all resolve to library doc ids (no demotion)", () => {
    const targets = Object.keys(WIKI_LIBRARY_LINKS);
    expect(targets.length).toBeGreaterThan(0);
    for (const [target, id] of Object.entries(WIKI_LIBRARY_LINKS)) {
      expect(id, `${target} should map to a library doc`).toMatch(/^(man|run)-/);
    }
  });
});

describe("sync-wiki-projection.ts generator helpers", () => {
  test("frontmatter parsing strips yaml head and keeps dates as strings", () => {
    const raw = `---
lang: ko
doc_type: how-to
stage: S9
tracks: [brownfield]
verified_on: 2026-10-23
---
# 제목

본문.
`;
    const { attrs, body } = parseFrontmatter(raw);
    expect(body.startsWith("# 제목")).toBe(true);
    expect(attrs.doc_type).toBe("how-to");
    expect(attrs.stage).toBe("S9");
    expect(attrs.verified_on).toBe("2026-10-23"); // Date 객체가 아니라 문자열(JSON_SCHEMA)
    expect(attrs.tracks).toEqual(["brownfield"]);
    // frontmatter 없는 문서는 원문 그대로
    expect(parseFrontmatter("# 바로 본문\n").body).toBe("# 바로 본문\n");
  });

  test("page order derivation: numeric prefix, Home is 0", () => {
    expect(pageOrder("Home")).toBe(0);
    expect(pageOrder("31-공통-S9-실사")).toBe(31);
    expect(pageOrder("03-용어집-링크")).toBe(3);
    expect(pageOrder("91-따라하기-점검표-브라운필드")).toBe(91);
  });

  test("extractHeadings skips # lines inside fenced code blocks (marked parity)", () => {
    // 펜스 안의 `#` 줄은 코드지 헤딩이 아니다 — marked도 CommonMark 펜스 규칙으로
    // 먼저 코드 블록을 인식하므로 생성기 검증도 펜스를 추적해야 한다(2차 검토).
    // 닫는 펜스는 같은 문자로 같거나 더 길어야 한다(``` 펜스를 ~~~ 닫지 못한다).
    const body = [
      "# 진짜 제목",
      "```bash",
      "# 주석이지 헤딩이 아니다",
      "pip install x",
      "```",
      "## 닫힌 뒤의 헤딩",
      "~~~",
      "## 물결 펜스 안이므로 헤딩이 아니다",
      "~~~~",
      "## 마지막 헤딩",
    ].join("\n");
    expect(extractHeadings(body)).toEqual(["진짜 제목", "닫힌 뒤의 헤딩", "마지막 헤딩"]);
    // 닫히지 않은 펜스 뒤는 전부 코드 블록이다(CommonMark).
    expect(extractHeadings("```js\n# 가짜 헤딩\n")).toEqual([]);
  });

  test("anchor verification fails on a broken in-page anchor, naming the fix", () => {
    const body = "# 실사\n\n## M&A 필수 검증 여섯 가지\n\n위 [잘못된 앵커](#틀린-앵커)를 본다.\n";
    const slugs = wikiHeadingSlugs(extractHeadings(body));
    const errors = verifyPageBody("x", body, {
      slugs: new Set(["x"]),
      imageFiles: new Set(),
      headingSlugs: new Map([["x", slugs]]),
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("#틀린-앵커");
    expect(errors[0]).toContain("원본 링크를 고치세요");
    // 실측 앵커(53번 페이지)는 통과해야 한다
    const good = "## M&A 필수 검증 여섯 가지\n\n위 [M&A 필수 검증 여섯 가지](#m-a-필수-검증-여섯-가지) 절을 본다.\n";
    expect(
      verifyPageBody("x", good, {
        slugs: new Set(["x"]),
        imageFiles: new Set(),
        headingSlugs: new Map([["x", wikiHeadingSlugs(extractHeadings(good))]]),
      }),
    ).toEqual([]);
  });

  test("classify + verify catch broken internal links and unknown images", () => {
    const body = "[없는 문서](99-없는-문서.md)와 [없는 그림](images/없는-그림.png), 그리고 [실제](Home.md).";
    const report = classifyPageLinks(body);
    expect(report.internalMd).toEqual(["99-없는-문서", "Home"]);
    expect(report.images).toEqual(["없는-그림.png"]);
    const errors = verifyPageBody("x", body, {
      slugs: new Set(["Home"]),
      imageFiles: new Set(["common-01-login.png"]),
      headingSlugs: new Map(),
    });
    expect(errors.some((e) => e.includes("99-없는-문서.md"))).toBe(true);
    expect(errors.some((e) => e.includes("images/없는-그림.png"))).toBe(true);
    expect(errors.length).toBe(2);
  });

  test("sidebar parsing: bold lines are groups, home link chrome skipped, orphans reported", () => {
    const parsed = parseSidebarGroups(
      "**[홈](Home.md)**\n\n**1. 시작**\n- [시작하기](01-시작하기.md)\n- [없는 페이지](99-없음.md)\n",
      new Set(["Home", "01-시작하기"]),
    );
    expect(parsed.errors.length).toBe(1); // 존재하지 않는 페이지 링크는 생성 중단 사유
    expect(parsed.groups).toEqual([{ group: "1. 시작", items: [{ slug: "01-시작하기", title: "시작하기" }] }]);
    expect(parsed.orphans).toEqual([]); // 01-시작하기는 참조됨 — Home은 고아 계산에서 뺀다
  });

  test("library link mapping resolves repo-relative manuals targets", () => {
    const docs = [
      { id: "man-admin-manual_ko", file: "docs/manuals/admin-manual_ko.md" },
      { id: "man-business-manual_ko", file: "docs/manuals/business-manual_ko.md" },
    ];
    const map = buildLibraryLinks(["../../manuals/admin-manual_ko.md", "../../manuals/없는-매뉴얼_ko.md"], docs);
    expect(map["../../manuals/admin-manual_ko.md"]).toBe("man-admin-manual_ko");
    expect(map["../../manuals/없는-매뉴얼_ko.md"]).toBeNull(); // 매칭 실패 → 렌더에서 평문 강등
  });
});
