// @version 1.0.0
/**
 * check-wiki-nav.ts 단위 시험(2026-10-23 위키 handbook 표준 재작성 설계 §3.3 ③).
 *
 * 두 축으로 나눈다.
 *  1. 순수 헬퍼·픽스처 검사 — 사이드바 사슬 유도(R1~R5), R5 상호성 실측,
 *     문구=슬러그, 마지막 줄 규칙, 줄표(E1~E3)·날짜(D1) 게이트의 코드 벗기기,
 *     유형별 필수 H2 존재·고정 순서. 픽스처 위키는 임시 폴더에 세워 runChecks를
 *     통째로 돌린다(검사기가 실제로 읽는 파일 경로와 같은 경로를 지나게).
 *  2. 실측 위키 회귀 잠금 — docs/wiki/ko 전체를 위반 0으로 통과시킨다.
 *     임시 허용 슬롯(KNOWN_OPEN_VIOLATIONS, 현재 비어 있음)은 원본 위반이
 *     실측되는 동안에만 쓰는 자리다 — 영구 예외가 아니므로, 원본을 고치는
 *     순간 두 번째 시험이 목록을 비우게 강제한다.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkH2Vocabulary,
  deriveChainFromSidebar,
  findDateViolations,
  findEmDashViolations,
  h2Sections,
  runChecks,
} from "../../scripts/co-newbiz/check-wiki-nav.ts";

const ROOT = join(import.meta.dirname, "../..");

// ── 픽스처 위키(최소 구성) ──
// 사슬: Home → 01 → (10 → 90 · 11 → 91) → 81. 갈림길(01, 다음 둘)·합류(81,
// 이전 둘)·끝(81, 처음: Home)을 한 사이클에 모두 지나게 짠다. 슬러그는 설계
// §2.1 유형 표의 숫자 범위를 따라야 pageType 판정이 난다(01/90/91=연습,
// 10/11=서사, 81=참조). 각 쪽에 frontmatter를 붙여 줄번호 보정(frontmatter
// 이후 본문 좌표)도 함께 검증한다.

const FIXTURE_SIDEBAR = `**[홈](Home.md)**

**0. 시작**
- [01 시작](01-시작.md)

**1. 그린필드 여정**
- [10 여정](10-여정.md)
- [90 점검표](90-점검표.md)

**2. 브라운필드 여정**
- [11 여정](11-여정.md)
- [91 점검표](91-점검표.md)

**3. 도움**
- [81 문제 해결](81-문제.md)
`;

const fm = (docType: string) => `---
doc_type: ${docType}
verified_on: 2026-01-01
lang: ko
---
`;

const FIXTURE_PAGES: Record<string, string> = {
  "Home.md": `${fm("overview")}# 홈\n\n## 핵심 요약\n\n- 여정의 출발점이다.\n\n다음: [01-시작](01-시작.md)\n`,
  "01-시작.md": `${fm("practice")}# 시작하기\n\n## 마무리\n\n- 여정 지도를 읽었다.\n\n이전: [Home](Home.md) | 다음: [10-여정](10-여정.md) · [11-여정](11-여정.md)\n`,
  "10-여정.md": `${fm("narrative")}# 그린필드 여정\n\n## 핵심 요약\n\n- 길의 지도다.\n\n이전: [01-시작](01-시작.md) | 다음: [90-점검표](90-점검표.md)\n`,
  "90-점검표.md": `${fm("practice")}# 점검표\n\n## 마무리\n\n- 따라 했다.\n\n이전: [10-여정](10-여정.md) | 다음: [81-문제](81-문제.md)\n`,
  "11-여정.md": `${fm("narrative")}# 브라운필드 여정\n\n## 핵심 요약\n\n- 길의 지도다.\n\n이전: [01-시작](01-시작.md) | 다음: [91-점검표](91-점검표.md)\n`,
  "91-점검표.md": `${fm("practice")}# 점검표\n\n## 마무리\n\n- 따라 했다.\n\n이전: [11-여정](11-여정.md) | 다음: [81-문제](81-문제.md)\n`,
  "81-문제.md": `${fm("reference")}# 문제 해결\n\n| 증상 | 조치 |\n|---|---|\n| 오류 | 기록한다 |\n\n이전: [90-점검표](90-점검표.md) · [91-점검표](91-점검표.md) | 처음: [Home](Home.md)\n`,
};

/** 픽스처 위키를 임시 폴더에 세우고 (절대경로, 뒷정리 함수)를 돌려준다. pages로 특정 쪽만 덮어쓸 수 있다. */
function buildFixtureWiki(pages: Record<string, string> = {}): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "wiki-nav-fixture-"));
  writeFileSync(join(dir, "_Sidebar.md"), FIXTURE_SIDEBAR);
  for (const [name, content] of Object.entries({ ...FIXTURE_PAGES, ...pages })) {
    writeFileSync(join(dir, name), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── 1a. 사슬 유도(설계 §2.4 R1~R5) ──

describe("deriveChainFromSidebar — 사이드바에서 사슬을 유도한다", () => {
  test("픽스처 사이드바: 갈림길·합류·끝이 전부 유도된다", () => {
    const slugs = new Set(Object.keys(FIXTURE_PAGES).map((f) => f.replace(/\.md$/, "")));
    const chain = deriveChainFromSidebar(FIXTURE_SIDEBAR, slugs);

    expect(chain.errors).toEqual([]);
    expect(chain.order).toEqual(["Home", "01-시작", "10-여정", "90-점검표", "11-여정", "91-점검표", "81-문제"]);

    // R2 갈림길: 01의 다음은 두 길 입구 모두.
    expect(chain.expect.get("01-시작")).toMatchObject({ prev: ["Home"], next: ["10-여정", "11-여정"] });
    // R1 직선: 각 길 안은 사이드바 나열 순서.
    expect(chain.expect.get("10-여정")).toMatchObject({ prev: ["01-시작"], next: ["90-점검표"], first: null });
    // R3 합류: 길 끝의 다음은 합류점 하나.
    expect(chain.expect.get("90-점검표")).toMatchObject({ prev: ["10-여정"], next: ["81-문제"] });
    expect(chain.expect.get("11-여정")).toMatchObject({ prev: ["01-시작"], next: ["91-점검표"] });
    expect(chain.expect.get("91-점검표")).toMatchObject({ prev: ["11-여정"], next: ["81-문제"] });
    // 합류점의 이전은 두 길 끝 모두, R4 끝: 다음 없음 + 처음: Home.
    expect(chain.expect.get("81-문제")).toMatchObject({ prev: ["90-점검표", "91-점검표"], next: [], first: "Home" });
    expect(chain.expect.get("Home")).toMatchObject({ prev: [], next: ["01-시작"], first: null });
  });

  test("실측 _Sidebar.md: 설계 §2.4 사슬표의 핵심 지점이 재현된다(SSOT 무결성)", () => {
    const wikiDir = join(ROOT, "docs", "wiki", "ko");
    const slugs = new Set(readdirSync(wikiDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));
    const chain = deriveChainFromSidebar(readFileSync(join(wikiDir, "_Sidebar.md"), "utf-8"), slugs);

    expect(chain.errors).toEqual([]);
    // 39개 md 파일 중 _Sidebar·_Footer가 사슬 밖(설계 §2.4 사슬표 머리말)이므로 Home+36쪽.
    expect(chain.order).toHaveLength(37);
    expect(chain.order[0]).toBe("Home");
    expect(chain.order.at(-1)).toBe("91-따라하기-점검표-브라운필드");
    expect(chain.expect.get("23-공통-S4-진출방식-결정")?.next).toEqual(["10-그린필드-여정", "11-브라운필드-여정"]);
    expect(chain.expect.get("30-공통-S8-사업성-분석")?.prev).toEqual(["45-그린필드-S12-사후-관리", "56-브라운필드-S12-통합-PMI"]);
    const last = chain.expect.get("91-따라하기-점검표-브라운필드");
    expect(last?.next).toEqual([]);
    expect(last?.first).toBe("Home");
  });

  test("갈림길 앵커 그룹이 사라지면 유도가 아니라 오류로 막는다", () => {
    const broken = FIXTURE_SIDEBAR.replace("2. 브라운필드 여정", "2. 다른 길");
    const slugs = new Set(Object.keys(FIXTURE_PAGES).map((f) => f.replace(/\.md$/, "")));
    const chain = deriveChainFromSidebar(broken, slugs);
    expect(chain.errors.some((e) => e.includes("갈림길 앵커 그룹"))).toBe(true);
  });
});

// ── 1b. runChecks 통과·위반(픽스처 위키 전체 가동) ──

describe("runChecks — 픽스처 위키", () => {
  test("규범을 지킨 픽스처는 위반 0이다(내비 존재·마지막 줄·사슬·R5·R4·필수 H2·게이트 동시 충족)", () => {
    const { dir, cleanup } = buildFixtureWiki();
    try {
      expect(runChecks(dir, "wiki-fixture")).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("R5 상호성: 한쪽만 적힌 간선은 양방향 모두에서 잡힌다", () => {
    const { dir, cleanup } = buildFixtureWiki({
      // 10의 다음은 90을 가리키는데 90의 이전은 11을 가리킨다 — 간선이 비대칭.
      "90-점검표.md": `${fm("practice")}# 점검표\n\n## 마무리\n\n- 따라 했다.\n\n이전: [11-여정](11-여정.md) | 다음: [81-문제](81-문제.md)\n`,
    });
    try {
      const findings = runChecks(dir, "wiki-fixture");
      const r5 = findings.filter((f) => f.includes("R5 상호성 위반"));
      expect(r5.some((f) => f.includes("10-여정") && f.includes("다음에 90-점검표"))).toBe(true);
      expect(r5.some((f) => f.includes("90-점검표") && f.includes("이전에 11-여정"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("내비 링크 문구가 대상 슬러그와 다르면 잡힌다", () => {
    const { dir, cleanup } = buildFixtureWiki({
      "01-시작.md": `${fm("practice")}# 시작하기\n\n## 마무리\n\n- 여정 지도를 읽었다.\n\n이전: [홈으로](Home.md) | 다음: [10-여정](10-여정.md) · [11-여정](11-여정.md)\n`,
    });
    try {
      const findings = runChecks(dir, "wiki-fixture");
      expect(findings.some((f) => f.includes("내비 링크 문구가 대상 슬러그와 다르다") && f.includes('"홈으로"'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("내비 행이 마지막 줄이 아니면 잡힌다", () => {
    const { dir, cleanup } = buildFixtureWiki({
      "81-문제.md": `${fm("reference")}# 문제 해결\n\n이전: [90-점검표](90-점검표.md) · [91-점검표](91-점검표.md) | 처음: [Home](Home.md)\n\n그 아래에 덧붙인 문단이다.\n`,
    });
    try {
      const findings = runChecks(dir, "wiki-fixture");
      expect(findings.some((f) => f.includes("내비 행은 쪽의 마지막 줄이어야 한다"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("내비 행이 아예 없으면 잡힌다", () => {
    const { dir, cleanup } = buildFixtureWiki({
      "81-문제.md": `${fm("reference")}# 문제 해결\n\n내비 행 없이 끝난다.\n`,
    });
    try {
      const findings = runChecks(dir, "wiki-fixture");
      expect(findings.some((f) => f.includes("내비 행(이전:/다음:/처음:)이 없다"))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ── 1c. 줄표(E1~E3)·날짜(D1) 게이트 — 코드 벗기기 동작 ──

describe("findEmDashViolations — backtick 밖 본문 줄표만 잡는다", () => {
  test("본문 줄표는 위반, backtick 안 화면 표기와 펜스 안은 면제(E3 보존)", () => {
    const body = [
      "첫 문장은 깨끗한다.",
      "본문 — 줄표가 문장 가운데 있다.", // E1 위반
      "`Greenfield — 자체 역량으로 진출`", // E3 보존
      "```text",
      "설립 실행 — 5단계",
      "```",
      "또 — 하나 더.", // 두 번째 위반
    ].join("\n");
    const vs = findEmDashViolations(body);
    expect(vs).toHaveLength(2);
    expect(vs[0]).toMatchObject({ lineNo: 2, rule: "E1" });
    expect(vs[1]).toMatchObject({ lineNo: 7 });
  });

  test("줄표 게이트는 줄과 칸 위치를 보존하므로 file:line 보고가 정확하다", () => {
    const stripped = ["앞", "본문 — 대시", "`코드 — 대시`"].join("\n");
    // 노출 함수 대신 규격 확인: 벗긴 결과에서 코드 줄의 대시는 사라지고 본문 줄은 남는다.
    const vs = findEmDashViolations(stripped);
    expect(vs.map((v) => v.lineNo)).toEqual([2]);
    expect(vs[0].snippet.length).toBeGreaterThan(0);
  });
});

describe("findDateViolations — 본문 달력 날짜만 잡는다(D1)", () => {
  test("YYYY-MM-DD·YYYY-MM·YYYY년은 위반, backtick 안 화면 값은 면제", () => {
    const body = [
      "기준일 2026-10-23 문장.",
      "2026-10 언급.",
      "2026년에 출시.",
      "예시 입력 `2026-Q4`와 화면 값 `기준 시장규모 (2026)`.",
    ].join("\n");
    const vs = findDateViolations(body);
    expect(vs).toHaveLength(3);
    expect(vs[0]).toMatchObject({ lineNo: 1, rule: "D1" });
    expect(vs.map((v) => v.lineNo)).toEqual([1, 2, 3]);
  });
});

// ── 1d. 유형별 필수 H2 존재·고정 순서(설계 §2.1~2.2) ──

describe("checkH2Vocabulary — 전형 쪽 골격", () => {
  const at = (bodyLine: number) => `body:${bodyLine}`;

  const fullBody = (slot: "정위치" | "뒤" | "없음") => {
    const 알려진불일치 = slot === "없음" ? "" : slot === "정위치" ? "\n## 알려진 불일치\n\n- D-01 기록.\n" : "";
    return [
      "# 제목",
      "**목적:** 한 문장.",
      "",
      "## 왜 이 단계인가",
      "여정에서의 질문이다.",
      "",
      "## 단계",
      "1. (읽기) 카드를 읽는다.",
      "",
      "## 결과 확인",
      "- 목록에 남는다.",
      "",
      "## 자주 하는 실수",
      "- 추천을 결정으로 착각하는 것.",
      slot === "뒤" ? "" : 알려진불일치,
      "## 스스로 확인하기",
      "읽기 전용으로 확인한다.",
      slot === "뒤" ? "\n## 알려진 불일치\n\n- D-01 기록.\n" : "",
      "## 핵심 요약",
      "- 세 줄 요약.",
    ].join("\n");
  };

  test("고정 순서를 지킨 전형 쪽은 위반이 없다(알려진 불일치 슬롯 포함)", () => {
    expect(checkH2Vocabulary("20-시험", "전형", h2Sections(fullBody("정위치")), at)).toEqual([]);
  });

  test("알려진 불일치가 스스로 확인하기 뒤에 있으면 슬롯 위반이다(45번 실측 위반의 원형)", () => {
    const findings = checkH2Vocabulary("20-시험", "전형", h2Sections(fullBody("뒤")), at);
    expect(findings.some((f) => f.includes("알려진 불일치") && f.includes("사이에 와야 한다"))).toBe(true);
  });

  test("필수 절이 빠지면 절 이름을 밝혀 잡는다", () => {
    const body = ["## 왜 이 단계인가", "## 단계", "## 결과 확인", "## 자주 하는 실수", "## 핵심 요약"].join("\n");
    const findings = checkH2Vocabulary("20-시험", "전형", h2Sections(body), at);
    expect(findings.some((f) => f.includes('필수 절 H2 "스스로 확인하기"가 없다'))).toBe(true);
  });

  test("절 순서가 어긋나면 고정 순서 위반으로 잡는다", () => {
    const body = ["## 단계", "## 왜 이 단계인가", "## 결과 확인", "## 자주 하는 실수", "## 스스로 확인하기", "## 핵심 요약"].join("\n");
    const findings = checkH2Vocabulary("20-시험", "전형", h2Sections(body), at);
    expect(findings.some((f) => f.includes("순서가 어긋났다"))).toBe(true);
  });

  test("참조 쪽은 개념 블록·핵심 요약 강제가 없다", () => {
    expect(checkH2Vocabulary("81-시험", "참조", h2Sections("## 증상 사전\n"), at)).toEqual([]);
  });
});

// ── 2. 실측 위키 회귀 잠금 ──

/**
 * 실측 원본 위반 임시 허용 목록 — 반드시 비워 둔다.
 * 2026-10-23 검사기 첫 가동 때 45-그린필드의 알려진 불일치 슬롯 위반이
 * 실측됐고, docs-writer가 원본을 고쳐 같은 날 잠금을 0위반으로 되돌렸다.
 * 다시 실측 위반이 잡히면 검사기(exit 1)와 아래 잠금 시험이 붉어진다 —
 * 그때도 이 목록에 새 항목을 영구 등록하는 것이 아니라 원본을 고친다.
 * (여기 넣는 순간 두 번째 잠금 시험이 "원본이 고쳐졌으면 비워라" 신호로 작동한다.)
 */
const KNOWN_OPEN_VIOLATIONS: { prefix: string; why: string }[] = [];

describe("실측 위키 docs/wiki/ko 회귀 잠금", () => {
  test("위반 0 — 내비 사슬(R1~R5)·상호성·문구=슬러그·마지막 줄·마무리·줄표·날짜·필수 H2 전부 통과", () => {
    const findings = runChecks(join(ROOT, "docs", "wiki", "ko"), "docs/wiki/ko");
    expect(findings, `실측 위키 위반 ${findings.length}건 — 원본(docs/wiki/ko/)을 고친다:\n${findings.join("\n")}`).toEqual([]);
  });

  test("임시 허용 목록이 비어 있지 않으면, 그 항목이 실측에도 잡히는지 확인한다(원본이 고쳐졌으면 목록을 비운다)", () => {
    if (KNOWN_OPEN_VIOLATIONS.length === 0) return;
    const findings = runChecks(join(ROOT, "docs", "wiki", "ko"), "docs/wiki/ko");
    for (const k of KNOWN_OPEN_VIOLATIONS) {
      expect(
        findings.some((f) => f.startsWith(k.prefix)),
        `${k.prefix}(${k.why})가 더 이상 잡히지 않는다 — 원본이 고쳐졌으니 KNOWN_OPEN_VIOLATIONS를 비우고 잠금을 0위반으로 되돌린다`,
      ).toBe(true);
    }
  });
});
