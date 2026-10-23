#!/usr/bin/env bun
/**
 * @version 1.0.1
 */
// check-wiki-nav.ts — 위키 내비 사슬·문장 규범 기계 검사기(2026-10-23 위키
// handbook 표준 재작성 설계 docs/designs/2026-10-23-wiki-handbook-standard-rebuild-design.md
// §3.3 검증 계획 ③ "내비 검사기"). handbook validate-nav의 마크다운 환산:
//   (a) 전 쪽 내비 행 존재 — 마지막 빈 아닌 줄이어야 한다(설계 §2.2 "마지막 줄").
//   (b) 사슬 일치 + R5 상호성 — 예상 사슬을 _Sidebar.md 그룹/항목 순서에서
//       유도한다(R1~R5). 페이지 표를 이 스크립트에 박아 넣지 않는다 —
//       사이드바가 읽기 순서의 SSOT이므로 쪽을 추가/삭제하면 사슬이 자동 유도된다.
//   (c) 내비 링크 문구(label) = 대상 파일명에서 .md를 뺀 슬러그(설계 §2.4).
//   (d) 끝 쪽의 `## 마무리` — 연습 유형 필수 절 검사로 커버된다(§2.1).
//   (e) 부가 게이트 — backtick을 벗긴 본문의 줄표(—) 0(E1~E3), 본문 달력
//       날짜 0(예외 3종, D1), 유형별 필수 H2 절 존재와 고정 순서(§2.1~2.2).
//
// 사슬 유도 방식(deriveChainFromSidebar): R1은 "Home → 사이드바 그룹 순서대로"
// 직선 사슬이다. R2(갈림길)·R3(합류)는 "두 평행 길 그룹"이라는 구조적 사실인데
// 사이드바 텍스트 자체에는 길 여부가 새겨 있지 않으므로, 그룹 제목 두 개만
// 앵커로 고정한다(LANE_GROUP_TITLES — 설계 §2.4가 이름으로 지정하는 유일한
// 정보). 갈림길=앞 그룹의 마지막 쪽, 분기 목표=두 길의 첫 쪽, 길 끝=두 길의
// 마지막 쪽, 합류점=뒤 그룹의 첫 쪽은 전부 사이드바 위치에서 계산한다.
// R4(끝)는 유도 순서의 마지막 쪽에 자동 적용된다.
//
// Usage:
//   bun scripts/co-newbiz/check-wiki-nav.ts                     # 기본 docs/wiki/ko
//   bun scripts/co-newbiz/check-wiki-nav.ts --dir=docs/wiki/ko  # 다른 위키 폴더
//
// 위반이 하나라도 있으면 file:line을 밝히고 exit 1. 원본(docs/wiki/ko/)을
// 고치는 것이 답이지 검사기를 느슨하게 하는 것이 아니다(§3.3 실행 순서).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { die } from "../lib/error-handling.ts";
import { parseFrontmatter, parseSidebarGroups } from "./sync-wiki-projection.ts";

const ROOT = resolve(import.meta.dir, "..", "..");

// ── 순수 헬퍼(단위 테스트 대상 — tests/unit/check-wiki-nav.test.ts) ──

/** 설계 §2.1 쪽 유형 표 — 숫자 접prefix 범위로 인코딩한다(파일 목록을 박지 않는다). */
export type PageType = "전형" | "서사" | "연습" | "참조";

export function pageType(slug: string): PageType | null {
  if (slug === "Home") return "서사";
  const m = slug.match(/^(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if ((n >= 20 && n <= 23) || (n >= 30 && n <= 34) || (n >= 40 && n <= 45) || (n >= 50 && n <= 56)) return "전형";
  if (n === 10 || n === 11) return "서사";
  if (n === 1 || n === 90 || n === 91) return "연습";
  if (n === 2 || n === 3 || n === 4 || n === 12 || n === 60 || n === 70 || n === 80 || n === 81 || n === 82) return "참조";
  return null;
}

// ── 사슬 유도(R1~R5) ──

export interface NavExpectation {
  /** `이전:` 링크 대상 슬러그들(사이드바 순서). */
  prev: string[];
  /** `다음:` 링크 대상 슬러그들(사이드바 순서). */
  next: string[];
  /** R4 끝 쪽만: `처음:` 링크의 대상(Home). 끝 쪽이 아니면 null. */
  first: string | null;
}

export interface DerivedChain {
  /** 읽기 순서(Home 먼저, 이후 사이드바 그룹/항목 순서). */
  order: string[];
  /** 쪽 → 기대 내비(유도 결과). */
  expect: Map<string, NavExpectation>;
  /** 사이드바 자체의 결함(없는 페이지 링크, 앵커 그룹 부재 등) — 비어 있으면 통과. */
  errors: string[];
}

// R2·R3의 두 평행 길 그룹 — 설계 §2.4가 "두 길"로 지정하는 앵커. 그룹 제목
// (숫자 접두 제거 후) 일치로 찾는다. 쪽 목록은 앵커링하지 않는다: 쪽이
// 추가/삭제되면 갈림길·입구·끝·합류점이 사이드바 위치에서 다시 계산된다.
const LANE_GROUP_TITLES = ["그린필드 길", "브라운필드 길"] as const;

const stripGroupNumber = (title: string): string => title.replace(/^\d+\.\s*/, "").trim();

/**
 * _Sidebar.md에서 읽기 사슬을 유도한다(R1~R5, 설계 §2.4).
 * R1: Home 먼저, 그룹은 사이드바 순서, 그룹 안 항목은 나열 순서의 직선 사슬.
 * R2: 갈림길(공통 단계 그룹 끝)의 다음 = 두 길 입구 모두.
 * R3: 두 길 끝의 다음 = 합류점(공통 후반 그룹 첫 쪽) 하나.
 * R4: 사슬의 마지막 쪽은 다음이 없고 `처음: Home`.
 * R5 상호성은 유도 구조상 성립하지만, 실제 쪽 대상 검사는 runChecks가 한다.
 */
export function deriveChainFromSidebar(sidebarRaw: string, existingSlugs: ReadonlySet<string>): DerivedChain {
  const errors: string[] = [];
  const sidebar = parseSidebarGroups(sidebarRaw, existingSlugs);
  errors.push(...sidebar.errors);

  const flat = sidebar.groups.flatMap((g) => g.items.map((i) => i.slug));
  const order = ["Home", ...flat];

  // R1 직선 사슬을 간선 집합으로 깐 뒤 R2·R3 보정을 얹는다 — 다중 목표(갈림길·
  // 합류)는 간선 집합에서 자연스럽게 나온다.
  const edges = new Set<string>();
  const addEdge = (a: string, b: string) => edges.add(`${a}→${b}`);
  const dropEdge = (a: string, b: string) => edges.delete(`${a}→${b}`);
  for (let i = 0; i < order.length - 1; i++) addEdge(order[i], order[i + 1]);

  const laneIdx = LANE_GROUP_TITLES.map((t) => sidebar.groups.findIndex((g) => stripGroupNumber(g.group) === t));
  laneIdx.forEach((idx, i) => {
    if (idx < 0) {
      errors.push(
        `_Sidebar.md — 갈림길 앵커 그룹을 못 찾았다: "${LANE_GROUP_TITLES[i]}" (R${i + 2} 유도 불가 — 그룹 제목이 바뀌었다면 check-wiki-nav.ts의 LANE_GROUP_TITLES를 함께 고친다)`,
      );
    }
  });
  if (laneIdx[0] >= 0 && laneIdx[1] >= 0 && laneIdx[1] !== laneIdx[0] + 1) {
    errors.push(`_Sidebar.md — 두 길 그룹(${LANE_GROUP_TITLES.join(", ")})이 사이드바에서 연속하지 않다(R2·R3의 평행 구조 전제)`);
  }

  if (laneIdx[0] >= 0 && laneIdx[1] === laneIdx[0] + 1) {
    const laneGroups = [sidebar.groups[laneIdx[0]], sidebar.groups[laneIdx[1]]];
    const entrances = laneGroups.map((g) => g.items[0]?.slug);
    // `.at(-1)`의 반환 타입은 T | undefined라 배열 요소 접근(exits[0])으로는 좁혀지지 않는다 —
    // 이름 있는 스칼라로 꺼내야 아래 가드가 string으로 좁힌다.
    const exit1 = laneGroups[0].items.at(-1)?.slug;
    const exit2 = laneGroups[1].items.at(-1)?.slug;
    const fork = laneIdx[0] > 0 ? sidebar.groups[laneIdx[0] - 1].items.at(-1)?.slug : undefined;
    const join = sidebar.groups[laneIdx[1] + 1]?.items[0]?.slug;
    if (!fork || !join || entrances.some((e) => !e) || !exit1 || !exit2) {
      errors.push("_Sidebar.md — 갈림길 구조(R2·R3)를 유도하기에 그룹 항목이 비어 있다");
    } else if (new Set([fork, ...entrances, exit1, exit2, join]).size !== 6) {
      errors.push(`_Sidebar.md — 갈림길 구조 앵커가 서로 겹친다(R2·R3 유도 불가): 갈림길=${fork} 입구=${entrances.join("/")} 끝=${exit1}/${exit2} 합류=${join}`);
    } else {
      // R2: 직선 유도에 생긴 "길1 끝 → 길2 입구" 간선을 끊고, 갈림길 → 길2 입구를 얹는다
      // (갈림길 → 길1 입구는 직선 유도에 이미 있다).
      dropEdge(exit1, entrances[1]);
      addEdge(fork, entrances[1]);
      // R3: 길1 끝 → 합류점(길2 끝 → 합류점은 직선 유도에 이미 있다).
      addEdge(exit1, join);
    }
  }

  // 간선 집합 → 쪽별 이전/다음 목록. 목록 순서는 사이드바 순서(order 인덱스)로
  // 정렬해 유도 결과를 결정적으로 만든다(23의 다음=[10,11], 30의 이전=[45,56]).
  const idxOf = new Map(order.map((s, i) => [s, i] as const));
  const nextMap = new Map<string, string[]>();
  const prevMap = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const edge of edges) {
    const [from, to] = edge.split("→");
    if (!idxOf.has(from) || !idxOf.has(to)) continue;
    push(nextMap, from, to);
    push(prevMap, to, from);
  }
  const byOrder = (a: string, b: string) => idxOf.get(a)! - idxOf.get(b)!;
  for (const list of nextMap.values()) list.sort(byOrder);
  for (const list of prevMap.values()) list.sort(byOrder);

  const expect = new Map<string, NavExpectation>();
  for (const slug of order) {
    expect.set(slug, { prev: prevMap.get(slug) ?? [], next: nextMap.get(slug) ?? [], first: null });
  }
  // R4 끝 규칙: 사슬의 마지막 쪽은 다음이 없고(간선이 없다) `처음: Home`을 둔다.
  const last = order.at(-1);
  if (last) expect.get(last)!.first = "Home";

  return { order, expect, errors };
}

// ── 내비 행 해석 ──

export interface NavLink {
  label: string;
  target: string;
}
export interface NavSegment {
  kind: "이전" | "다음" | "처음";
  links: NavLink[];
}
export interface NavRow {
  segments: NavSegment[];
}

const NAV_SEGMENT_RE = /^(이전|다음|처음):\s*(.+)$/;
const NAV_LINK_RE = /^\[([^\]]+)\]\(([^)]+\.md)\)$/;
const KIND_RANK: Record<NavSegment["kind"], number> = { "이전": 0, "다음": 1, "처음": 2 };

/** 내비 행 한 줄을 설계 §2.4 문법(`이전: [s](s.md) | 다음: [s](s.md) · [s](s.md)`)대로 해석. 아니면 null. */
export function parseNavRow(line: string): NavRow | null {
  const segments: NavSegment[] = [];
  for (const piece0 of line.split("|")) {
    const m = piece0.trim().match(NAV_SEGMENT_RE);
    if (!m) return null;
    const links: NavLink[] = [];
    for (const link0 of m[2].split("·")) {
      const lm = link0.trim().match(NAV_LINK_RE);
      if (!lm) return null;
      links.push({ label: lm[1], target: lm[2] });
    }
    segments.push({ kind: m[1] as NavSegment["kind"], links });
  }
  return segments.length > 0 ? { segments } : null;
}

/** 내비 행 후보 줄인지(탐지용) — 이전:/다음:/처음:으로 시작하고 .md 링크를 담는다. */
export function looksLikeNavRow(line: string): boolean {
  const t = line.trim();
  return /^(이전|다음|처음):/.test(t) && /\]\([^)\s]+\.md\)/.test(t);
}

const segmentTargets = (row: NavRow, kind: NavSegment["kind"]): string[] =>
  row.segments.filter((s) => s.kind === kind).flatMap((s) => s.links.map((l) => l.target.replace(/\.md$/, "")));

// ── 본문 훑기(펜스 추적)와 문장 규범 게이트 ──

export interface BodyLine {
  line: string;
  lineNo: number;
  inFence: boolean;
}

/** 펜스(```/~~~) 안 여부를 표시해 본문 줄을 훑는다 — sync-wiki-projection.extractHeadings의 CommonMark 펜스 규칙과 같다. */
export function bodyLines(body: string): BodyLine[] {
  const out: BodyLine[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const [i, line] of body.replace(/\r\n/g, "\n").split("\n").entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (mark) {
      const char = mark[1][0];
      if (fence === null) fence = { char, len: mark[1].length };
      else if (fence.char === char && mark[1].length >= fence.len) fence = null;
      out.push({ line, lineNo: i + 1, inFence: true });
      continue;
    }
    out.push({ line, lineNo: i + 1, inFence: fence !== null });
  }
  return out;
}

export interface H2Section {
  text: string;
  lineNo: number;
}

/** 본문의 H2(`##`) 절을 위에서 아래 순으로 (텍스트, 줄번호)로 모은다. 펜스 안은 제외. */
export function h2Sections(body: string): H2Section[] {
  const out: H2Section[] = [];
  for (const { line, lineNo, inFence } of bodyLines(body)) {
    if (inFence) continue;
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) out.push({ text: m[1], lineNo });
  }
  return out;
}

/**
 * stripCodeForLanguageScan(scripts/validate-md-language.ts)과 같은 3단 코드
 * 벗기기(펜스 → 이중 backtick → 단일 backtick)를 줄바꿈·칸 위치를 보존하는
 * 공백 치환으로 수행한다 — 위반 보고를 file:line 정밀도로 내기 위함이다.
 * 같은 함수의 4단(링크 벗기기)은 언어 검사 전용이라 쓰지 않는다: 내비 행과
 * 제목 안의 [..](..) 링크를 살려 둬야 이 검사기의 다른 단계가 읽을 수 있다.
 */
export function stripCodePreservingLines(content: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return content
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/``[\s\S]*?``/g, blank)
    .replace(/`[^`]+`/g, blank);
}

export interface TextViolation {
  lineNo: number;
  snippet: string;
  rule: string;
}

const EM_DASH_RE = /[—―]/;

/** E1~E3: backtick(펜스·인라인)을 벗긴 본문에 줄표가 남으면 위반. backtick 안 화면 표기(`… — …`)는 E3 보존 대상이다. */
export function findEmDashViolations(body: string): TextViolation[] {
  const out: TextViolation[] = [];
  for (const [i, line] of stripCodePreservingLines(body).split("\n").entries()) {
    const col = line.search(EM_DASH_RE);
    if (col >= 0) out.push({ lineNo: i + 1, snippet: line.slice(Math.max(0, col - 12), col + 13).trim(), rule: "E1" });
  }
  return out;
}

/** D1 달력 날짜 패턴: YYYY-MM-DD / YYYY-MM / 2026년 꼴. backtick 안 화면 값은 벗기기로 면제된다. */
const DATE_RES = [/\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{4}-\d{2}\b/g, /\d{4}년/g];

/** D1: 본문(frontmatter 제외, backtick 제외)의 달력 날짜. 82-변경-이력.md 표와 _Footer.md 검증 기준일은 호출부에서 면제한다. */
export function findDateViolations(body: string): TextViolation[] {
  const out: TextViolation[] = [];
  for (const [i, line] of stripCodePreservingLines(body).split("\n").entries()) {
    const hits = new Set<string>();
    for (const re of DATE_RES) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) hits.add(m[0]);
    }
    if (hits.size > 0) out.push({ lineNo: i + 1, snippet: [...hits].join(", "), rule: "D1" });
  }
  return out;
}

// ── 유형별 필수 H2(설계 §2.1 표 + §2.2 절 순서 고정) ──

interface H2Spec {
  /** 필수 절 — 이 순서대로 위에서 아래로 나와야 한다(다른 절 사이에 끼어 있는 것은 무관). */
  required: string[];
  /** 슬롯이 정해진 선택 절(전형의 `알려진 불일치` — 이미 있는 쪽만 유지). */
  slotted?: string;
  slotBetween?: [string, string];
}

const TYPE_H2: Record<PageType, H2Spec> = {
  전형: {
    required: ["왜 이 단계인가", "단계", "결과 확인", "자주 하는 실수", "스스로 확인하기", "핵심 요약"],
    slotted: "알려진 불일치",
    slotBetween: ["자주 하는 실수", "스스로 확인하기"],
  },
  // 서사: 해설 절들은 기존 절명 유지가 허용되고(§2.3), 고정 어휘는 핵심 요약뿐이다.
  서사: { required: ["핵심 요약"] },
  // 연습: 목적 머리 → 체크리스트 절 → 마무리. 고정 어휘는 마무리(끝 쪽 91의 마무리 행동 목록 포함).
  연습: { required: ["마무리"] },
  // 참조: 개념 블록·핵심 요약 강제 없음(§2.1).
  참조: { required: [] },
};

/** 유형별 필수 H2 존재·고정 순서·선택 절 슬롯을 검사한다(at = 본문 줄번호 → 보고용 위치). */
export function checkH2Vocabulary(slug: string, type: PageType, sections: H2Section[], at: (bodyLine: number) => string): string[] {
  const findings: string[] = [];
  const spec = TYPE_H2[type];

  const lineOf = (text: string): number | null => {
    const hits = sections.filter((s) => s.text === text);
    if (hits.length > 1) {
      findings.push(`${at(hits[1].lineNo)} — H2 "${text}" 절이 여러 개다(절 어휘는 쪽마다 하나, 변형 금지 — 설계 §2.2)`);
    }
    return hits.length > 0 ? hits[0].lineNo : null;
  };

  const anchors = new Map<string, number>();
  let lastFound: number | null = null;
  for (const text of spec.required) {
    const ln = lineOf(text);
    if (ln === null) {
      findings.push(`docs/wiki/ko/${slug}.md — ${type} 쪽 필수 절 H2 "${text}"가 없다(설계 §2.1)`);
      continue;
    }
    anchors.set(text, ln);
    if (lastFound !== null && ln <= lastFound) {
      findings.push(`${at(ln)} — H2 "${text}" 절의 순서가 어긋났다(고정 순서: ${spec.required.join(" → ")} — 설계 §2.2)`);
    }
    lastFound = ln;
  }

  if (spec.slotted && spec.slotBetween) {
    const [lo, hi] = spec.slotBetween;
    const slotHits = sections.filter((s) => s.text === spec.slotted);
    if (slotHits.length > 1) {
      findings.push(`${at(slotHits[1].lineNo)} — H2 "${spec.slotted}" 절이 여러 개다(설계 §2.2)`);
    }
    if (slotHits.length >= 1) {
      const loLine = anchors.get(lo);
      const hiLine = anchors.get(hi);
      if (loLine !== undefined && hiLine !== undefined) {
        const ln = slotHits[0].lineNo;
        if (!(ln > loLine && ln < hiLine)) {
          findings.push(`${at(ln)} — H2 "${spec.slotted}" 절은 "${lo}"와 "${hi}" 사이에 와야 한다(절 순서 고정 — 설계 §2.2)`);
        }
      }
    }
  }
  return findings;
}

// ── 전체 검사 ──

/**
 * 위키 폴더 전체를 검사하고 위반 메시지(파일:줄 정밀도)를 모아 돌려준다.
 * 비어 있으면 통과. main이 출력과 exit 코드를 담당한다.
 */
export function runChecks(dirAbs: string, displayDir: string): string[] {
  const findings: string[] = [];
  const files = readdirSync(dirAbs)
    .filter((f) => f.endsWith(".md") && f !== "_Sidebar.md" && f !== "_Footer.md")
    .sort();
  const slugs = new Set(files.map((f) => f.replace(/\.md$/, "")));

  const sidebarRaw = readFileSync(resolve(dirAbs, "_Sidebar.md"), "utf-8");
  const chain = deriveChainFromSidebar(sidebarRaw, slugs);
  findings.push(...chain.errors);

  // 사이드바 밖 쪽 — 사이드바가 읽기 순서 SSOT이므로 사슬 위치를 유도할 수 없다.
  for (const slug of slugs) {
    if (!chain.expect.has(slug)) {
      findings.push(`${displayDir}/${slug}.md — 사이드바에 없는 쪽이다(읽기 사슬을 유도할 수 없다 — 설계 §2.4 R1)`);
    }
  }

  // R5 상호성 실측 그래프 — 파싱에 성공한 내비 행에서만 쌓인다.
  const actualNext = new Map<string, Set<string>>();
  const actualPrev = new Map<string, Set<string>>();

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const raw = readFileSync(resolve(dirAbs, file), "utf-8");
    const offset = frontmatterLineOffset(raw);
    const atLine = (bodyLine: number) => `${displayDir}/${file}:${bodyLine + offset}`;
    const { body } = parseFrontmatter(raw);

    // (a) 내비 행 존재 + 위치(마지막 빈 아닌 줄 — 설계 §2.2)
    const lines = bodyLines(body);
    const navLineNos = lines.filter((l) => !l.inFence && looksLikeNavRow(l.line)).map((l) => l.lineNo);
    if (navLineNos.length === 0) {
      findings.push(`${displayDir}/${file} — 내비 행(이전:/다음:/처음:)이 없다(설계 §2.4)`);
      continue;
    }
    if (navLineNos.length > 1) {
      findings.push(`${atLine(navLineNos[1])} — 내비 행이 여러 개다(쪽마다 하나 — 설계 §2.2)`);
    }
    const navLineNo = navLineNos[0];
    const lastNonEmpty = (() => {
      const ls = lines.filter((l) => l.line.trim() !== "");
      return ls.at(-1)?.lineNo ?? 0;
    })();
    if (navLineNo !== lastNonEmpty) {
      findings.push(`${atLine(navLineNo)} — 내비 행은 쪽의 마지막 줄이어야 한다(설계 §2.2 "마지막 줄의 내비 행")`);
    }

    const navText = lines.find((l) => l.lineNo === navLineNo)!.line.trim();
    const row = parseNavRow(navText);
    if (!row) {
      findings.push(
        `${atLine(navLineNo)} — 내비 행 문법이 규격에 맞지 않다(기본형: 이전: [슬러그](슬러그.md) | 다음: [슬러그](슬러그.md), 복수 대표는 · 구분 — 설계 §2.4)`,
      );
      continue;
    }

    // 세그먼트 순서 규격: 이전 → 다음 → 처음(중복 금지).
    let lastRank = -1;
    for (const seg of row.segments) {
      const rank = KIND_RANK[seg.kind];
      if (rank <= lastRank) {
        findings.push(`${atLine(navLineNo)} — 내비 행 세그먼트 순서는 이전 → 다음 → 처음이어야 한다(설계 §2.4)`);
      }
      lastRank = rank;
    }

    // (c) 문구 = 대상 슬러그 + 대상 존재
    for (const seg of row.segments) {
      for (const link of seg.links) {
        const targetSlug = link.target.replace(/\.md$/, "");
        if (link.label !== targetSlug) {
          findings.push(`${atLine(navLineNo)} — 내비 링크 문구가 대상 슬러그와 다르다: "${link.label}" ≠ ${link.target}(설계 §2.4)`);
        }
        if (!slugs.has(targetSlug)) {
          findings.push(`${atLine(navLineNo)} — 내비 링크 대상이 이 위키의 쪽이 아니다: ${link.target}`);
        }
      }
    }

    // 실측 그래프 적립(R5 대조용) — 키는 쪽(slug), 값은 그 쪽 내비 행에 실제로
    // 적힌 대상들. "B의 이전에 A가 있다" = actualPrev(B)에 A가 있다라는 대조
    // 방향과 키·값이 나란히 가야 한다(대상을 키로 쓰면 모든 간선이 위반으로
    // 나오는 거꾸로 그래프가 된다).
    const prevTargets = segmentTargets(row, "이전");
    const nextTargets = segmentTargets(row, "다음");
    if (!actualNext.has(slug)) actualNext.set(slug, new Set());
    if (!actualPrev.has(slug)) actualPrev.set(slug, new Set());
    for (const t of nextTargets) actualNext.get(slug)!.add(t);
    for (const t of prevTargets) actualPrev.get(slug)!.add(t);

    // (b) 사슬 대조(유도 결과와의 일치)
    const exp = chain.expect.get(slug);
    if (exp) {
      if (JSON.stringify(prevTargets) !== JSON.stringify(exp.prev)) {
        findings.push(`${atLine(navLineNo)} — 이전 사슬이 사이드바 유도와 다르다: 기대 [${exp.prev.join(", ")}] 실제 [${prevTargets.join(", ")}](R1~R3 — 설계 §2.4)`);
      }
      if (JSON.stringify(nextTargets) !== JSON.stringify(exp.next)) {
        findings.push(`${atLine(navLineNo)} — 다음 사슬이 사이드바 유도와 다르다: 기대 [${exp.next.join(", ")}] 실제 [${nextTargets.join(", ")}](R1~R3 — 설계 §2.4)`);
      }
      // R4 끝 규칙
      const firstTargets = segmentTargets(row, "처음");
      if (exp.first) {
        if (!(firstTargets.length === 1 && firstTargets[0] === exp.first)) {
          findings.push(`${atLine(navLineNo)} — 끝 쪽은 다음 대신 처음: [${exp.first}](${exp.first}.md) 내비 행을 둬야 한다(R4 — 설계 §2.4)`);
        }
      } else if (firstTargets.length > 0) {
        findings.push(`${atLine(navLineNo)} — "처음:" 세그먼트는 사슬의 끝 쪽에만 둔다(R4 — 설계 §2.4)`);
      }
    }

    // (e) 유형별 필수 H2(§2.1~2.2) — 끝 쪽의 `## 마무리`(검증 계획 (d))도 여기서 커버된다.
    const type = pageType(slug);
    if (!type) {
      findings.push(`${displayDir}/${file} — 설계 §2.1 유형 표에 없는 쪽이다(전형/서사/연습/참조 판정 불가 — 숫자 접두를 확인한다)`);
    } else {
      findings.push(...checkH2Vocabulary(slug, type, h2Sections(body), atLine));
    }

    // (e) E1~E3 줄표 게이트 — backtick 밖 본문 0
    for (const v of findEmDashViolations(body)) {
      findings.push(`${atLine(v.lineNo)} — backtick 밖 본문에 줄표가 남아 있다: …${v.snippet}…(${v.rule}~E3: 문장 분리나 콜론으로 대체, backtick 안 화면 표기는 보존)`);
    }

    // (e) D1 날짜 게이트 — 예외: 82-변경-이력 표(파일 전체), _Footer(애초에 검사 대상 밖)
    if (slug !== "82-변경-이력") {
      for (const v of findDateViolations(body)) {
        findings.push(`${atLine(v.lineNo)} — backtick 밖 본문에 달력 날짜가 있다: ${v.snippet}(D1: 본문 날짜 각인 금지, 예외는 backtick 화면 값·82-변경-이력·_Footer)`);
      }
    }
  }

  // (b) R5 상호성 — 실측 그래프끼리: A의 다음에 B가 있으면 B의 이전에 A가 있다(역도).
  for (const [a, nexts] of actualNext) {
    for (const b of nexts) {
      if (!actualPrev.get(b)?.has(a)) {
        findings.push(`${displayDir}/${a}.md — R5 상호성 위반: 다음에 ${b}가 있지만 ${b}의 이전에 ${a}가 없다(설계 §2.4 R5)`);
      }
    }
  }
  for (const [b, prevs] of actualPrev) {
    for (const a of prevs) {
      if (!actualNext.get(a)?.has(b)) {
        findings.push(`${displayDir}/${b}.md — R5 상호성 위반: 이전에 ${a}가 있지만 ${a}의 다음에 ${b}가 없다(설계 §2.4 R5)`);
      }
    }
  }

  return findings;
}

/**
 * parseFrontmatter가 본문에서 벗겨낸 머리(frontmatter 범위 + 선행 빈 줄)의 줄 수 —
 * 본문 줄번호를 파일 줄번호로 올릴 때 쓴다. sync-wiki-projection.parseFrontmatter의
 * 자르기 규칙(^\n+ 제거 포함)과 정확히 맞춘다.
 */
export function frontmatterLineOffset(raw: string): number {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return 0;
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return 0;
  const afterFence = normalized.indexOf("\n", end + 1) + 1;
  const tail = normalized.slice(afterFence);
  const stripped = tail.replace(/^\n+/, "");
  return afterFence + (tail.length - stripped.length);
}

// ── CLI ──

async function main() {
  const argv = process.argv.slice(2);
  let dirArg = "docs/wiki/ko";
  const eq = argv.find((a) => a.startsWith("--dir="));
  if (eq) {
    dirArg = eq.slice("--dir=".length);
  } else {
    const i = argv.indexOf("--dir");
    if (i >= 0) dirArg = argv[i + 1] ?? die("--dir 값이 없다");
  }
  const dirAbs = resolve(ROOT, dirArg);

  let findings: string[];
  try {
    findings = runChecks(dirAbs, dirArg.replace(/\/$/, ""));
  } catch (e) {
    die(`위키 폴더를 검사할 수 없다: ${dirAbs} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (findings.length > 0) {
    console.error(`[check-wiki-nav] 위키 내비·문장 규범 검증 실패 ${findings.length}건 — 원본(${dirArg}/)을 고친 뒤 다시 실행하세요:`);
    for (const f of findings) console.error(`  - ${f}`);
    die(`검증 실패 ${findings.length}건 — 위의 파일:줄을 고친다(검사기를 느슨하게 하지 않는다)`);
  }
  console.log(`[check-wiki-nav] 통과 — 내비 사슬(R1~R5)·문구=슬러그·마무리·줄표(E1~E3)·날짜(D1)·필수 H2 게이트 전부 통과`);
}

if (import.meta.main) {
  await main();
}
