// S1 growth banner follow-ups A1-A3 (design 2026-09-18-s1-growth-gap-calibration,
// addendum 2026-11-12b): the staleness banner's rendering seam is pinned.
//  - A3 — RerunAction / GrowthStalenessCard (the exported pure views of
//    SizingGrowthTabs.tsx) render the banner text, the rerun CTA tri-state, and
//    the gap-gate suppression, ko and en.
//  - A2 — the qualified wording is pinned at the render seam and in the locale
//    catalog ("재분석 시 이 참조가 반영됩니다" / "it will be applied on
//    re-analysis"); the old "컨센서스로 반영" promise is gone.
//  - A1 — the same-mount refresh is pinned by source assertion: CalibrationPanel
//    calls onReferenceSaved only after a successful save PUT, SizingGrowthTab
//    bumps referenceRefresh into the live-GET deps, and the comparator call is
//    unchanged (a refresh re-runs the same GET, so the banner cannot
//    false-positive).
// Rendering seam note: the two pure views are rendered here with
// renderToStaticMarkup; the full SizingGrowthTab mount (api client, charts,
// provider chain) remains unpinned — the mount-level facts are pinned by the
// source assertions below, mirroring the SiteAnnouncementPanel pattern.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { normSrc } from "./helpers/src-normalize.ts";

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
const { RerunAction, GrowthStalenessCard } = (await import(
  `${WEB}/components/stages/market/GrowthBannerViews.tsx`
)) as {
  RerunAction: unknown;
  GrowthStalenessCard: unknown;
};

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );

const noop = () => {};
const action = (over: Record<string, unknown> = {}) => ({
  rerunStarted: false,
  canCurate: true,
  onRerun: noop,
  ...over,
});
const card = (over: Record<string, unknown> = {}) => ({
  showCta: true,
  rerunStarted: false,
  canCurate: true,
  onRerun: noop,
  rerunError: null,
  ...over,
});

describe("GrowthStalenessCard — banner rendering (A3)", () => {
  test("renders the banner text as a status region, ko and en", () => {
    const html = render(createElement(GrowthStalenessCard, card()));
    expect(html).toContain('data-testid="growth-staleness-card"');
    expect(html).toContain('role="status"');
    expect(html).toContain("기록된 외부 참조가 최신 분석보다 최신 — 재분석 시 이 참조가 반영됩니다.");
    const enHtml = render(createElement(GrowthStalenessCard, card()), "en");
    expect(enHtml).toContain(
      "A recorded external reference is newer than the latest analysis — it will be applied on re-analysis.",
    );
  });

  test("A2 — the old consensus-promise wording is gone from both locales", () => {
    expect(render(createElement(GrowthStalenessCard, card()))).not.toContain("컨센서스로 반영");
    expect(render(createElement(GrowthStalenessCard, card()), "en")).not.toContain("top-down consensus");
  });

  test("showCta: the rerun CTA renders inside the card; suppressed when the gap gate owns it", () => {
    const html = render(createElement(GrowthStalenessCard, card()));
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain("지금 재분석");
    const gapOwns = render(createElement(GrowthStalenessCard, card({ showCta: false })));
    expect(gapOwns).not.toContain("<button");
    expect(gapOwns).toContain('data-testid="growth-staleness-card"');
  });

  test("rerunError renders as an alert only together with the CTA", () => {
    expect(render(createElement(GrowthStalenessCard, card({ rerunError: "boom" })))).toContain('role="alert"');
    expect(render(createElement(GrowthStalenessCard, card({ rerunError: "boom", showCta: false })))).not.toContain(
      'role="alert"',
    );
  });

  test("started state replaces the button with the started status", () => {
    const html = render(createElement(GrowthStalenessCard, card({ rerunStarted: true })));
    expect(html).not.toContain("<button");
    expect(html).toContain("재분석이 시작되었습니다 — 완료되면 목록의 분석일이 갱신됩니다.");
  });
});

describe("RerunAction — CTA tri-state (A3)", () => {
  test("curator: the rerun button", () => {
    const html = render(createElement(RerunAction, action()));
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("지금 재분석 (최신 외부 전망·연계 근거 반영)");
  });

  test("viewer: renders nothing", () => {
    expect(render(createElement(RerunAction, action({ canCurate: false })))).toBe("");
  });

  test("started: the status line, no button", () => {
    const html = render(createElement(RerunAction, action({ rerunStarted: true })));
    expect(html).not.toContain("<button");
    expect(html).toContain('role="status"');
  });

  test("en locale carries the CTA label", () => {
    expect(render(createElement(RerunAction, action()), "en")).toContain("Re-analyze now");
  });
});

describe("locale catalog — banner key parity (A2)", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  const nsOf = (c: Record<string, unknown>): Record<string, unknown> =>
    (c.stages as { s1: { sizingGrowthTabs: Record<string, unknown> } }).s1.sizingGrowthTabs;
  test("ko and en carry the same sizingGrowthTabs keys, none empty", () => {
    const k = nsOf(ko);
    const e = nsOf(en);
    expect(keys(k).sort()).toEqual(keys(e).sort());
    for (const o of [k, e]) for (const key of keys(o)) expect(String(o[key]).length).toBeGreaterThan(0);
  });
  test("the banner key states the qualified wording in both locales", () => {
    const banner = (ns: Record<string, unknown>) => ns.recordedExternalReferenceNewerThanTheLatestAnalysis as string;
    expect(banner(nsOf(ko))).toContain("재분석 시 이 참조가 반영됩니다");
    expect(banner(nsOf(en))).toContain("it will be applied on re-analysis");
  });
});

describe("mount seams — same-mount refresh without a false positive (A1)", () => {
  const src = normSrc(
    readFileSync(new URL(`${WEB}/components/stages/market/SizingGrowthTabs.tsx`, import.meta.url), "utf8"),
  );
  const panel = normSrc(
    readFileSync(new URL(`${WEB}/components/stages/market/CalibrationPanel.tsx`, import.meta.url), "utf8"),
  );
  test("the live-GET effect re-runs on referenceRefresh; the industry id stays a dep", () => {
    expect(src).toContain("},[detail.industry.id,referenceRefresh]);");
  });
  test("the banner comparator and its inputs are unchanged (a refresh re-runs the same GET)", () => {
    expect(src).toContain("referenceNewerThanVersion(reference?.created_at,detail.versions[0]?.created_at)");
  });
  test("SizingGrowthTab mounts the pure views and feeds CalibrationPanel the save signal", () => {
    expect(src).toContain("<GrowthStalenessCard");
    expect(src).toContain("<RerunAction");
    expect(src).toContain("onReferenceSaved={()=>setReferenceRefresh((n)=>n + 1)}");
  });
  test("CalibrationPanel fires onReferenceSaved only on the save success path, after load()", () => {
    // normSrc strips the whitespace (and the paren) after "?:", so match the prop
    // type up to the optional marker and the success-path call ordering separately.
    expect(panel).toContain(";onReferenceSaved?:");
    const putAt = panel.indexOf("api.put(`/api/market-overview/industry/");
    const fireAt = panel.indexOf("onReferenceSaved?.()");
    expect(putAt).toBeGreaterThan(-1);
    expect(fireAt).toBeGreaterThan(putAt);
    // unique to saveReference — the other load() callers are followed by catch
    expect(panel).toContain("load();onReferenceSaved?.()");
  });
});
