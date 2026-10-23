#!/usr/bin/env bun
/**
 * @version 1.0.0
 */
// sync-wiki-projection.ts — 전면 재생성 생성기: docs/wiki/ko/ 의 사용자 안내서
// 위키를 app/web-next/lib/wiki.generated.ts 로 투영한다(2026-10-23 위키 인앱
// 뷰어 설계 D2/§5). 라이브러리 생성기(sync-library-projection.ts)와 달리
// 기존 항목 갱신이 아니라 파일 집합 전체를 다시 만든다 — 페이지 추가/삭제가
// 기계적으로 반영된다. SSOT는 원본 마크다운이며 이 스크립트는 docs/wiki/ko/에
// 아무것도 쓰지 않는다(읽기만).
//
// 내장 검증(설계 §5): (a) 폴더 안 .md 링크가 투영 페이지를 가리키는지,
// (b) images/ 참조가 이미지 파일 목록에 있는지, (c) 페이지 내 앵커 링크가
// 렌더러가 만들 헤딩 슬러그(lib/wiki-heading-slug.ts — 렌더러와 공유)와
// 일치하는지. 어기면 파일·줄을 밝히고 실패한다 — 렌더러를 원본에 맞추는 게
// 아니라 원본 링크를 고치는 것이 SSOT 규율이다.
//
// 폴더 밖 링크(../../manuals/*.md)는 app/web-next/lib/library.generated.ts의
// LIBRARY_DOCS file 경로로 매칭해 /library?doc=<id> 매핑을 투영에 기록한다
// (설계 D5 규칙 4 — 렌더 시 추측 없음). 매칭 실패는 null로 기록되고 렌더에서
// 평문으로 강등된다.
//
// Usage:
//   bun scripts/co-newbiz/sync-wiki-projection.ts           # regenerate the projection
//   bun scripts/co-newbiz/sync-wiki-projection.ts --check   # exit 1 if it is stale
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { wikiHeadingSlugs } from "../../app/web-next/lib/wiki-heading-slug.ts";
import type { WikiPageContent, WikiPageSummary, WikiSidebarGroup } from "../../app/web-next/lib/wiki.ts";

const ROOT = join(import.meta.dir, "..", "..");
const WIKI_DIR = join(ROOT, "docs", "wiki", "ko");
const IMAGES_DIR = join(WIKI_DIR, "images");
const OUT = join(ROOT, "app", "web-next", "lib", "wiki.generated.ts");
const CHECK = process.argv.includes("--check");

// ── 순수 헬퍼(단위 테스트 대상 — tests/unit/wiki-projection-sync.test.ts) ──

export interface WikiFrontmatter {
  attrs: Record<string, unknown>;
  body: string;
}

/** 문서 앞부분의 `--- ... ---` frontmatter를 js-yaml(JSON_SCHEMA — 날짜를 문자열로 유지)로 벗긴다. */
export function parseFrontmatter(raw: string): WikiFrontmatter {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { attrs: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { attrs: {}, body: normalized };
  const head = normalized.slice(4, end);
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
  const attrs = (yaml.load(head, { schema: yaml.JSON_SCHEMA }) ?? {}) as Record<string, unknown>;
  return { attrs, body };
}

/** 숫자 접두 slug(예: `31-공통-S9-실사`) → order. Home은 인덱스로 0. */
export function pageOrder(slug: string): number {
  if (slug === "Home") return 0;
  const m = slug.match(/^(\d+)/);
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export interface SidebarParseResult {
  groups: WikiSidebarGroup[];
  /** 사이드바 어느 그룹에도 없는 투영 페이지(slug) — 생성기가 말미 `기타` 그룹으로 붙인다. */
  orphans: string[];
  /** 사이드바가 존재하지 않는 페이지를 가리키는 등의 위반 메시지(비어 있으면 통과). */
  errors: string[];
}

/**
 * _Sidebar.md 파싱: 굵은 줄(`**1. 공통 단계 (S1~S4)**`)이 그룹, 리스트 항목
 * `- [라벨](대상.md)`이 페이지. 첫 줄의 `**[홈](Home.md)**`처럼 굵은 줄 통째가
 * 단일 링크면 그룹이 아니라 홈 링크 크롬으로 보고 건너뛴다.
 */
export function parseSidebarGroups(sidebar: string, pageSlugs: ReadonlySet<string>): SidebarParseResult {
  const groups: WikiSidebarGroup[] = [];
  const referenced = new Set<string>();
  const errors: string[] = [];
  let current: WikiSidebarGroup | null = null;

  for (const [idx, line0] of sidebar.replace(/\r\n/g, "\n").split("\n").entries()) {
    const line = line0.trim();
    if (line === "") continue;
    const bold = line.match(/^\*\*(.+)\*\*$/);
    if (bold) {
      // 굵은 줄이 단일 링크면(홈 링크) 그룹으로 세지 않는다.
      if (/^\[[^\]]*\]\([^)]+\)$/.test(bold[1])) continue;
      current = { group: bold[1], items: [] };
      groups.push(current);
      continue;
    }
    const item = line.match(/^-\s+\[([^\]]*)\]\(([^)]+)\)$/);
    if (item) {
      const slug = item[2].replace(/\.md$/, "");
      if (!pageSlugs.has(slug)) {
        errors.push(`_Sidebar.md:${idx + 1} — 사이드바 링크가 투영 페이지가 아닙니다: ${item[2]}`);
        continue;
      }
      referenced.add(slug);
      current?.items.push({ slug, title: item[1] });
    }
  }
  // Home은 인덱스(/wiki)로 특수 취급(설계 D1) — 목록 그룹에 속하지 않아도 고아가 아니다.
  const orphans = [...pageSlugs].filter((s) => s !== "Home" && !referenced.has(s)).sort();
  return { groups, orphans, errors };
}

/**
 * 본문 헤딩 텍스트(마크다운 인라인 포함)를 위에서 아래 순으로 모은다.
 * 펜스(``` 또는 ~~~) 안의 `#` 줄은 코드 블록이지 헤딩이 아니므로 건너뛴다 —
 * marked도 CommonMark 펜스 규칙으로 코드 블록을 먼저 인식하므로, 생성기의
 * 앵커 검증 대상을 렌더러와 맞추려면 펜스를 추적해야 한다(2차 검토).
 */
export function extractHeadings(body: string): string[] {
  const out: string[] = [];
  // 열린 펜스의 문자(` 또는 ~)와 최소 길이 — 닫는 펜스는 같은 문자로 더 길거나 같아야 한다(CommonMark).
  let fence: { char: string; len: number } | null = null;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const fenceMark = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMark) {
      const char = fenceMark[1][0];
      if (fence === null) fence = { char, len: fenceMark[1].length };
      else if (fence.char === char && fenceMark[1].length >= fence.len) fence = null;
      continue;
    }
    if (fence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push(m[2]);
  }
  return out;
}

const LINK_RE = /(!?)\[([^\]\n]*)\]\(([^()\s]*)(?:\s+"[^"]*")?\)/g;

export interface PageLinkReport {
  /** 폴더 안 .md 대상(해시 제거, `./` 정규화) — 투영 페이지 집합에 있어야 한다. */
  internalMd: string[];
  /** 폴더 밖 대상(`../` 시작, 해시 제거) — 투영의 library 링크 매핑 대상. */
  outsideMd: string[];
  /** images/ 대상의 파일명 — 이미지 허용목록에 있어야 한다. */
  images: string[];
  /** 페이지 내 순수 앵커(`#...`). */
  anchors: Array<{ anchor: string; line: number }>;
  /** `X.md#anchor` 형태의 교차 페이지 앵커. */
  crossAnchors: Array<{ target: string; anchor: string; line: number }>;
}

/** 본문의 모든 인라인 링크/이미지 대상을 분류한다. */
export function classifyPageLinks(body: string): PageLinkReport {
  const report: PageLinkReport = { internalMd: [], outsideMd: [], images: [], anchors: [], crossAnchors: [] };
  for (const [idx, line] of body.replace(/\r\n/g, "\n").split("\n").entries()) {
    for (const m of line.matchAll(LINK_RE)) {
      const target = m[3];
      if (target === "") continue;
      if (target.startsWith("#")) {
        report.anchors.push({ anchor: target.slice(1), line: idx + 1 });
        continue;
      }
      const hash = target.indexOf("#");
      const path = hash >= 0 ? target.slice(0, hash) : target;
      const anchor = hash >= 0 ? target.slice(hash + 1) : null;
      if (path.startsWith("../")) {
        if (anchor) report.crossAnchors.push({ target: path, anchor, line: idx + 1 });
        else if (!report.outsideMd.includes(path)) report.outsideMd.push(path);
        continue;
      }
      if (path.startsWith("images/")) {
        report.images.push(path.slice("images/".length));
        continue;
      }
      const normalized = path.replace(/^\.\//, "").replace(/\.md$/, "");
      if (anchor) report.crossAnchors.push({ target: normalized, anchor, line: idx + 1 });
      else report.internalMd.push(normalized);
    }
  }
  return report;
}

export interface VerifyContext {
  slugs: ReadonlySet<string>;
  imageFiles: ReadonlySet<string>;
  /** slug → 그 문서의 헤딩 슬러그 목록(렌더러 규칙, 중복 접미사 포함). */
  headingSlugs: ReadonlyMap<string, string[]>;
}

/** 설계 §5의 생성기 내장 검증 — 위반 메시지 배열(비어 있으면 통과). */
export function verifyPageBody(slug: string, body: string, ctx: VerifyContext): string[] {
  const errors: string[] = [];
  const report = classifyPageLinks(body);
  for (const target of report.internalMd) {
    if (!ctx.slugs.has(target)) errors.push(`docs/wiki/ko/${slug}.md — 폴더 안 링크가 투영 페이지가 아닙니다: ${target}.md`);
  }
  for (const file of report.images) {
    if (!ctx.imageFiles.has(file)) errors.push(`docs/wiki/ko/${slug}.md — 이미지 참조가 파일 목록에 없습니다: images/${file}`);
  }
  const own = ctx.headingSlugs.get(slug) ?? [];
  for (const { anchor, line } of report.anchors) {
    if (!own.includes(anchor)) {
      errors.push(
        `docs/wiki/ko/${slug}.md:${line} — 페이지 내 앵커 #${anchor} 이(가) 이 문서의 헤딩 슬러그가 아닙니다. 렌더러가 아니라 원본 링크를 고치세요 (헤딩 슬러그: ${own.join(", ") || "없음"})`,
      );
    }
  }
  for (const { target, anchor, line } of report.crossAnchors) {
    const targetSlugs = ctx.headingSlugs.get(target) ?? [];
    if (targetSlugs.length > 0 && !targetSlugs.includes(anchor)) {
      errors.push(`docs/wiki/ko/${slug}.md:${line} — 교차 페이지 앵커 ${target}.md#${anchor} 이(가) 대상 문서의 헤딩 슬러그가 아닙니다`);
    }
  }
  return errors;
}

/** 폴더 밖 링크 대상 → library.generated.ts의 LIBRARY_DOCS file 경로 매칭(id, 없으면 null). */
export function buildLibraryLinks(outsideTargets: string[], libraryDocs: ReadonlyArray<{ id: string; file: string }>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const target of [...outsideTargets].sort()) {
    // 대상은 docs/wiki/ko/ 기준 상대경로(../../manuals/…) — 세그먼트 순회로 실제 파일 경로로 환산한다.
    const segs = (`docs/wiki/ko/${target}`).split("/");
    const stack: string[] = [];
    for (const seg of segs) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") stack.pop();
      else stack.push(seg);
    }
    const resolved = stack.join("/");
    const doc = libraryDocs.find((d) => d.file === resolved);
    out[target] = doc ? doc.id : null;
  }
  return out;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

function head(field: string | undefined): string | undefined {
  const v = typeof field === "string" ? field.trim() : undefined;
  return v === "" ? undefined : v;
}

async function buildProjection(): Promise<string> {
  const mod = await import(join(ROOT, "app", "web-next", "lib", "library.generated.ts"));
  const LIBRARY_DOCS: Array<{ id: string; file: string }> = mod.LIBRARY_DOCS;

  const allFiles = readdirSync(WIKI_DIR).filter((f) => f.endsWith(".md")).sort();
  const pageFiles = allFiles.filter((f) => !f.startsWith("_"));
  const imageFiles = readdirSync(IMAGES_DIR).sort();

  interface Page {
    summary: WikiPageSummary;
    body: string;
  }
  const pages: Page[] = [];
  const headings = new Map<string, string[]>();

  for (const file of pageFiles) {
    const slug = file.replace(/\.md$/, "");
    const { attrs, body } = parseFrontmatter(readFileSync(join(WIKI_DIR, file), "utf-8"));
    const titleMatch = body.match(/^#\s+(.+?)\s*$/m);
    if (!titleMatch) throw new Error(`docs/wiki/ko/${file} — 첫 줄 수준의 # 헤딩이 없습니다(페이지 제목 계약 위반)`);
    const tracks = Array.isArray(attrs.tracks) ? (attrs.tracks as string[]) : undefined;
    const personas = Array.isArray(attrs.personas) ? (attrs.personas as string[]) : undefined;
    const summary: WikiPageSummary = {
      slug,
      title: titleMatch[1],
      order: pageOrder(slug),
      doc_type: head(attrs.doc_type as string | undefined) ?? "explanation",
      ...(head(attrs.stage as string | undefined) !== undefined ? { stage: head(attrs.stage as string | undefined) } : {}),
      ...(tracks !== undefined ? { tracks } : {}),
      ...(personas !== undefined ? { personas } : {}),
      verified_on: head(attrs.verified_on as string | undefined) ?? "",
    };
    pages.push({ summary, body });
    headings.set(slug, wikiHeadingSlugs(extractHeadings(body)));
  }

  pages.sort((a, b) => a.summary.order - b.summary.order || a.summary.slug.localeCompare(b.summary.slug));
  const slugs = new Set(pages.map((p) => p.summary.slug));
  const imageSet = new Set(imageFiles);
  const ctx: VerifyContext = { slugs, imageFiles: imageSet, headingSlugs: headings };

  // 생성기 내장 검증 — 하나라도 어기면 생성 중단(설계 §5).
  const errors: string[] = [];
  const outsideTargets: string[] = [];
  for (const page of pages) {
    errors.push(...verifyPageBody(page.summary.slug, page.body, ctx));
    outsideTargets.push(...classifyPageLinks(page.body).outsideMd);
  }

  const sidebarRaw = readFileSync(join(WIKI_DIR, "_Sidebar.md"), "utf-8");
  const sidebar = parseSidebarGroups(sidebarRaw, slugs);
  errors.push(...sidebar.errors);
  if (sidebar.orphans.length > 0) {
    sidebar.groups.push({ group: "기타", items: sidebar.orphans.map((slug) => ({ slug, title: pages.find((p) => p.summary.slug === slug)?.summary.title ?? slug })) });
  }

  const footerRaw = parseFrontmatter(readFileSync(join(WIKI_DIR, "_Footer.md"), "utf-8")).body;
  const libraryLinks = buildLibraryLinks(outsideTargets, LIBRARY_DOCS);

  if (errors.length > 0) {
    console.error(`[sync-wiki-projection] 위키 원본 링크 검증 실패 ${errors.length}건 — 원본(docs/wiki/ko/)을 고친 뒤 다시 실행하세요:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const content: Record<string, WikiPageContent> = {};
  for (const p of pages) content[p.summary.slug] = { ...p.summary, body: p.body };

  return (
    `// Generated from docs/wiki/ko/ by scripts/co-newbiz/sync-wiki-projection.ts (full regeneration).\n` +
    `// Do not edit by hand; fix the wiki source and re-run the generator (--check guards drift).\n` +
    `import type { WikiPageContent, WikiPageSummary, WikiSidebarGroup } from "./wiki.ts";\n\n` +
    `export const WIKI_PAGES: WikiPageSummary[] = ${JSON.stringify(pages.map((p) => p.summary), null, 2)};\n\n` +
    `export const WIKI_CONTENT: Record<string, WikiPageContent> = ${JSON.stringify(content, null, 2)};\n\n` +
    `export const WIKI_SIDEBAR_GROUPS: WikiSidebarGroup[] = ${JSON.stringify(sidebar.groups, null, 2)};\n\n` +
    `export const WIKI_FOOTER: string = ${JSON.stringify(footerRaw)};\n\n` +
    `export const WIKI_IMAGE_FILES: string[] = ${JSON.stringify(imageFiles, null, 2)};\n\n` +
    `// 폴더 밖 링크(../../manuals/*.md) → /library?doc=<id> 매핑(설계 D5 규칙 4). null = 매칭 실패(렌더에서 평문 강등).\n` +
    `export const WIKI_LIBRARY_LINKS: Record<string, string | null> = ${JSON.stringify(libraryLinks, null, 2)};\n`
  );
}

async function main() {
  const next = await buildProjection();
  let src: string | null = null;
  try {
    src = readFileSync(OUT, "utf-8");
  } catch {
    src = null;
  }
  if (src === next) {
    console.log("wiki.generated.ts is up to date.");
  } else if (CHECK) {
    console.error("wiki.generated.ts is stale — run: bun scripts/co-newbiz/sync-wiki-projection.ts");
    process.exit(1);
  } else {
    writeFileSync(OUT, next);
    console.log(`wiki.generated.ts refreshed (${next.length} bytes).`);
  }
}

if (import.meta.main) {
  await main();
}
