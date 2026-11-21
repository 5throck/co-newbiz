// design 2026-11-21-s67-completion-visibility Fix ① — the S6 완료기준 strip
// (S6CriteriaPanel) render pins: three criteria rows keyed off the stage's
// `missing` keys with the index-aligned engine prose, the coverage fraction,
// the all-met collapse, the fail-quiet hides, and the Long List chip text
// mapping (s6GapChipKey). ko/en parity follows the i18n table of the design.
import { describe, expect, test } from "bun:test";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as {
  createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as {
  NextIntlClientProvider: unknown;
};
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const M = (await import(`${WEB}/components/stages/brownfield/S6CriteriaPanel.tsx`)) as {
  S6CriteriaPanel: unknown;
  s6Coverage: (
    targets: Array<{ gaps?: string[] }>,
    min: number,
  ) => {
    covered: number;
    min: number;
    registered: number;
    qualified: number;
  };
  s6GapChipKey: (gaps: string[]) => string;
  EMPTY_S6_GATE: unknown;
};

const render = (props: Record<string, unknown>, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(M.S6CriteriaPanel, props),
    ),
  );

const gate = (over: Record<string, unknown> = {}) => ({
  ready: true,
  terminated: false,
  s6Status: "current",
  s6Missing: [],
  s6Blockers: [],
  s7Blocked: true,
  ...over,
});
const target = (id: string, gaps: string[] = []) => ({ id, gaps });

describe("s6Coverage", () => {
  test("coverage counts gap-free candidates; grandfathered [] rows degrade to the registered count", () => {
    expect(M.s6Coverage([target("a"), target("b", ["source"]), target("c", ["attributes", "source"])], 3)).toEqual({
      covered: 1,
      min: 3,
      registered: 3,
      qualified: 1,
    });
    expect(M.s6Coverage([target("a"), target("b")], 3).covered).toBe(2);
  });
});

describe("s6GapChipKey (chip text by gap composition)", () => {
  test("attributes only / source only / both", () => {
    expect(M.s6GapChipKey(["attributes"])).toBe("gapAttributes");
    expect(M.s6GapChipKey(["source"])).toBe("gapSource");
    expect(M.s6GapChipKey(["attributes", "source"])).toBe("gapAttributesSource");
    expect(M.s6GapChipKey([])).toBe("gapSource"); // never rendered (caller guards on length), but defined
  });
});

describe("S6CriteriaPanel", () => {
  const blockedGate = gate({
    s6Missing: ["s6.longlist_attributes", "s6.longlist_coverage"],
    s6Blockers: [
      "필수 속성·출처가 없는 Long List 후보 1건 — 태웅 (식별자·Universe 적합 메모·발굴 출처 기록 필요)",
      "Long List 커버리지 부족 (1/3 — 필수 속성·출처를 갖춘 후보만 산입)",
    ],
  });

  test("open criteria: amber rows for the missing keys, met rows green; prose pairs by index", () => {
    const html = render({
      gate: blockedGate,
      targets: [target("a"), target("b", ["attributes", "source"])],
      minLongList: 3,
    });
    expect(html).toContain('id="s6-criteria"');
    expect(html).toContain('data-testid="s6-criteria-panel"');
    expect(html).toContain("S6 완료기준");
    // two open (amber ✕), one met (green ✓)
    expect(html.match(/status-amber/g)?.length).toBe(2);
    expect(html.match(/status-green/g)?.length).toBe(1);
    expect(html).toContain("Long List 후보 필수 속성·출처");
    expect(html).toContain("Long List 최소 커버리지");
    expect(html).toContain("평가 대상 방향성(Target Universe)");
    // engine prose kept verbatim (paired by index — attributes prose on the attributes row)
    expect(html).toContain("필수 속성·출처가 없는 Long List 후보 1건 — 태웅");
    expect(html).toContain("Long List 커버리지 부족 (1/3");
    // sr-only state words (never colour-only)
    expect(html).toContain("충족됨");
    // coverage fraction + qualified note + cure hint
    expect(html).toContain("커버리지 1/3");
    expect(html).toContain("필수 속성·출처를 갖춘 후보 1/2건");
    expect(html).toContain("미충족 후보는 후보 상세에서 Universe 적합 메모·발굴 출처를 보완하세요");
  });

  test("qualified == registered: the qualified note is omitted", () => {
    const html = render({
      gate: gate({ s6Missing: ["s6.target_universe"], s6Blockers: ["Target Universe 정의가 필요합니다"] }),
      targets: [target("a"), target("b")],
      minLongList: 3,
    });
    expect(html).not.toContain("필수 속성·출처를 갖춘 후보");
    expect(html).toContain("커버리지 2/3");
  });

  test("all met: the strip collapses to one green line and keeps the anchor", () => {
    const html = render({ gate: gate({ s6Status: "complete" }), targets: [target("a"), target("b")], minLongList: 3 });
    expect(html).toContain('data-all-met="true"');
    expect(html).toContain("3가지 완료기준을 모두 충족했습니다");
    expect(html).not.toContain("s67-criteria-list");
    expect(html).toContain('id="s6-criteria"');
  });

  test("fail-quiet: no engine read, a terminated process, or an unevaluated (locked) stage renders nothing", () => {
    expect(render({ gate: M.EMPTY_S6_GATE, targets: [], minLongList: 3 })).toBe("");
    expect(render({ gate: gate({ terminated: true, s6Status: "terminated" }), targets: [], minLongList: 3 })).toBe("");
    // locked stages carry missing: [] BY CONTRACT — absence of evaluation, not completion
    expect(render({ gate: gate({ s6Status: "locked", s7Blocked: true }), targets: [], minLongList: 3 })).toBe("");
  });

  test("en locale carries the same structure with the en copy", () => {
    const html = render(
      { gate: blockedGate, targets: [target("a"), target("b", ["attributes", "source"])], minLongList: 3 },
      "en",
    );
    expect(html).toContain("S6 completion criteria");
    expect(html).toContain("Coverage 1/3");
    expect(html).toContain("1/2 candidates carry the required attributes and source");
    expect(html).toContain("Open candidates can be cured on their detail screen");
    expect(html).toContain("Long List candidate required attributes and sources");
  });
});
