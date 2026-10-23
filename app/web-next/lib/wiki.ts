// wiki — 사용자 안내서 위키 뷰어의 서버·클라이언트 공용 라이브러리
// (2026-10-23 위키 인앱 뷰어 설계 D2/D3/D5). 데이터는 생성 정적 투영
// wiki.generated.ts(sync-wiki-projection.ts 산출물)에서만 나온다 — 클라이언트가
// 통제하는 slug·파일명은 키 집합 조회로만 해석되고 fs에 닿지 않는다(D3).
// 렌더 직전의 링크 재작성은 순수 함수(D5)이고 원본 마크다운은 절대 변형하지
// 않는다(GitHub 미러·레포 열람이 같은 원본을 본다).
import { Marked, type Tokens } from "marked";
import {
  WIKI_CONTENT,
  WIKI_FOOTER,
  WIKI_IMAGE_FILES,
  WIKI_LIBRARY_LINKS,
  WIKI_PAGES,
  WIKI_SIDEBAR_GROUPS,
} from "./wiki.generated.ts";
import { wikiHeadingSlug } from "./wiki-heading-slug.ts";

export interface WikiPageSummary {
  slug: string;
  title: string;
  /** 숫자 접두 파생 순서. Home은 인덱스로 0. */
  order: number;
  doc_type: string;
  stage?: string;
  tracks?: string[];
  personas?: string[];
  verified_on: string;
}

export interface WikiPageContent extends WikiPageSummary {
  /** frontmatter를 벗긴 본문(생성 때 한 번 벗긴다 — 렌더 시점에 하지 않는다). */
  body: string;
}

export interface WikiSidebarGroup {
  group: string;
  items: Array<{ slug: string; title: string }>;
}

// ── 동적 세그먼트 해제(2026-10-23 결함 수정 — 이중 인코딩 슬러그) ─────────────

/**
 * 라우터·라우트 핸들러가 동적 세그먼트를 인코딩된 채 전달할 수 있다(실측:
 * Next가 %XX를 그대로 param에 싣는다). 한 번만 풀어 원값으로 정규화한다.
 * `%zz` 같은 malformed 시퀀스는 decodeURIComponent가 던지므로 원값을 그대로
 * 돌린다 — 핸들러·화면이 500이 아니라 키 집합 조회 실패(404)로 내려가게.
 */
export function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// ── 키 집합 조회(D3 — never raw paths) ──────────────────────────────────────

export function listWikiPages(): WikiPageSummary[] {
  return WIKI_PAGES;
}

export function getWikiPage(slug: string): WikiPageContent | null {
  // own-property 조회만 한다 — `WIKI_CONTENT[slug] ?? null`은 프로토타입 체인을
  // 참조하므로 `__proto__`·`constructor`·`hasOwnProperty` 같은 슬러그가 truthy
  // (Object.prototype 멤버)를 반환해 D3의 404 계약을 우회한다(2차 검토 지적).
  return Object.hasOwn(WIKI_CONTENT, slug) ? WIKI_CONTENT[slug] : null;
}

export function getWikiSidebarGroups(): WikiSidebarGroup[] {
  return WIKI_SIDEBAR_GROUPS;
}

export function getWikiFooter(): string {
  return WIKI_FOOTER;
}

/** 이미지 허용목록(생성기가 박아 넣은 파일명 목록) 조회. */
export function isWikiImageFile(file: string): boolean {
  return WIKI_IMAGE_FILES.includes(file);
}

/**
 * /api/wiki/images/[file] 용 해석(D4): path.basename 정규화 후 허용목록 조회.
 * 목록에 없는 이름(../ 등 traversal 포함)은 null — 경로 핸들러가 404로 내린다.
 */
export function resolveWikiImageFile(file: string): string | null {
  const base = file.split(/[\\/]/).pop() ?? "";
  return isWikiImageFile(base) ? base : null;
}

/** 폴더 밖 링크 대상(예: ../../manuals/admin-manual_ko.md)의 library 문서 id. null = 평문 강등 대상. */
export function getWikiLibraryLink(target: string): string | null | undefined {
  return WIKI_LIBRARY_LINKS[target];
}

// ── 링크 재작성(D5 — 렌더 직전, 순수 함수) ───────────────────────────────────

export interface WikiRewriteContext {
  slugs: ReadonlySet<string>;
  imageFiles: ReadonlySet<string>;
  libraryLinks: Readonly<Record<string, string | null>>;
}

export function defaultRewriteContext(): WikiRewriteContext {
  return {
    slugs: new Set(WIKI_PAGES.map((p) => p.slug)),
    imageFiles: new Set(WIKI_IMAGE_FILES),
    libraryLinks: WIKI_LIBRARY_LINKS,
  };
}

const LINK_RE = /(!?)\[([^\]\n]*)\]\(([^()\s]*)(?:\s+"[^"]*")?\)/g;

/**
 * 규칙(설계 D5):
 *  1. 폴더 안 `X.md` → `/wiki/X` — 투영 페이지 집합에 없는 대상은 그대로 둔다
 *     (깨진 링크로 보이는 것이 무음 재작성보다 낫다).
 *  2. `Home.md` → `/wiki`.
 *  3. `images/x.png` → `/api/wiki/images/x.png` — 파일명 목록에 없으면 원본 유지.
 *  4. 폴더 밖 `../../manuals/*.md` → `/library?doc=<id>`(생성기가 매핑을 투영에
 *     기록). 매칭 실패(null)면 링크를 평문으로 강등한다.
 *  5. 해시(`#…`)는 재작성 후에도 그대로 붙인다. 페이지 내 순수 앵커와 앱
 *     절대경로·외부 URL은 재작성 대상이 아니다.
 */
export function rewriteWikiLinks(markdown: string, ctx: WikiRewriteContext = defaultRewriteContext()): string {
  return markdown.replace(LINK_RE, (whole, bang: string, text: string, target: string) => {
    if (target === "" || target.startsWith("#") || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
    const hash = target.indexOf("#");
    const path = hash >= 0 ? target.slice(0, hash) : target;
    const suffix = hash >= 0 ? target.slice(hash) : "";
    if (path.startsWith("images/")) {
      const file = path.slice("images/".length);
      return ctx.imageFiles.has(file) ? `${bang}[${text}](/api/wiki/images/${file})` : whole;
    }
    if (path.startsWith("../")) {
      if (!(path in ctx.libraryLinks)) return whole;
      const docId = ctx.libraryLinks[path];
      if (docId === null) return `${bang}${text}`; // 평문 강등
      return `${bang}[${text}](/library?doc=${encodeURIComponent(docId)}${suffix})`;
    }
    const md = path.match(/^(.*)\.md$/);
    const base = (md ? md[1] : path).replace(/^\.\//, "");
    // `.md` 링크가 계약이지만(실측 전부 .md) 해시 부착형(page.md#anchor)도 규칙 5가
    // 커버한다 — slug 집합에 있는 이름이면 .md 생략형도 같은 대상으로 재작성한다.
    if (!md && !ctx.slugs.has(base)) return whole;
    if (base === "Home") return `${bang}[${text}](/wiki${suffix})`;
    if (ctx.slugs.has(base)) return `${bang}[${text}](/wiki/${base}${suffix})`;
    return whole;
  });
}

// ── 렌더(marked 보강 두 가지 — 헤딩 id, GitHub alert 콜아웃) ──────────────────

// GitHub alert 라벨의 한국어 표기(설계 D8 — UI 문구는 한글 평문).
const ALERT_LABELS: Record<string, string> = {
  NOTE: "노트",
  TIP: "팁",
  IMPORTANT: "중요",
  WARNING: "주의",
  CAUTION: "경고",
};

// 전역 marked 싱글턴을 건드리지 않는다 — /library가 같은 프로세스의 전역
// 인스턴스로 렌더하므로 이 오버라이드가 새어 나가면 문서 허브 렌더가 변한다.
function createWikiMarked(): Marked {
  const instance = new Marked();
  // 문서당 중복 슬러그 카운터 — wiki-heading-slug.ts의 생성기 검증과 같은 규칙.
  const seen = new Map<string, number>();
  instance.use({
    gfm: true,
    tokenizer: {
      // GFM 취소선 토크나이저를 끈다 — marked의 del 토크나이저는 단일 `~`도
      // 구분자로 삼아 `S1~S4` 같은 범위 표기가 "S1"+취소선+S12로 깨진다
      // (실측 결함: Home.md 표 셀에서 <del> 발생). 위키 원문에 `~~취소선~~`은
      // 없다(grep 실측 0건) — 토큰을 내지 않는 쪽이 정확하다.
      // 주의: `false`를 돌리면 marked v18의 use() 래퍼가 기본 토크나이저로
      // 폴백시킨다(c === !1 → built-in 재호출). 반드시 undefined를 돌려
      // inlineTokens의 falsy 분기(평문으로 낙하)를 타게 한다.
      del(): undefined {
        return undefined;
      },
    },
    hooks: {
      // 사전 변환(설계 D5): `> [!NOTE]` 마커 줄 바로 뒤를 빈 인용 줄로 끊어
      // 마커가 별도 문단이 되게 한다. 마커와 본문이 한 문단으로 붙으면
      // blockquote 렌더러가 마커를 감지할 수 없다(마커 단독 줄일 때만 콜아웃).
      preprocess(markdown: string): string {
        return markdown.replace(/^(> ?\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\n]*\n)(?=>)/gm, "$1>\n");
      },
    },
    renderer: {
      // marked v18은 headerIds를 지원하지 않는다(v5 제거) — github-slugger 호환
      // 슬러그를 직접 붙인다(설계 D5 렌더러 보강). 슬러그 재료는 raw 인라인
      // 텍스트(토큰.text)로, 링크 문법이 섞인 헤딩도 렌더된 텍스트 기준으로
      // 슬러그가 나오게 한다.
      heading({ tokens, depth, text }: Tokens.Heading): string {
        const base = wikiHeadingSlug(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      // GitHub alert(`> [!NOTE]`) → 콜아웃 div. 원본 문법은 그대로 두고
      // 렌더층에서만 바꾼다(설계 D5). 마커 줄만 떼고 나머지는 마크다운으로
      // 파싱하므로 콜아웃 안의 강조·링크가 산다.
      blockquote({ tokens }: Tokens.Blockquote): string {
        const first = tokens[0];
        const m = first?.type === "paragraph" ? first.raw.trim().match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/) : null;
        if (m) {
          const body = this.parser.parse(tokens.slice(1));
          return `<div class="wiki-callout wiki-callout-${m[1].toLowerCase()}"><p class="wiki-callout-label">${ALERT_LABELS[m[1]]}</p>${body}</div>\n`;
        }
        return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`;
      },
    },
  });
  return instance;
}

/** 위키 본문(링크 재작성 완료)을 HTML로 렌더한다. 신뢰 모델은 /library와 같다. */
export function renderWikiMarkdown(body: string): string {
  return createWikiMarked().parse(body, { async: false }) as string;
}
