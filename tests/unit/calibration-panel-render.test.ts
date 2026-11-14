// @version 1.0.0
/**
 * CalibrationPanel honest-overshoot render (design
 * 2026-11-14-driver-proposal-dedupe-overshoot D-C): rendered under
 * NextIntlClientProvider + AuthProvider via renderToStaticMarkup (patterns:
 * driver-links-panel-render.test.ts, stage-screen-dom-contract.test.ts —
 * useAuth throws outside AuthProvider). Pins: the ONE muted warning line
 * renders only when calibration.overshoot.overshoot is true, carries the
 * sum/needed/cap numbers as text, exists in BOTH locale catalogs, and is
 * absent when the signal is undefined or false; the accepted-driver chips
 * block still renders (regression). No auto-removal affordance is rendered —
 * the line is informational only (boundary #2).
 */
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
const { AuthProvider } = (await import(`${WEB}/lib/auth-client.tsx`)) as { AuthProvider: unknown };
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { CalibrationPanel } = (await import(`${WEB}/components/stages/market/CalibrationPanel.tsx`)) as {
  CalibrationPanel: unknown;
};

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(AuthProvider, null, el),
    ),
  );

const overshoot = (over: Record<string, unknown> = {}) => ({
  acceptedImpactSumPct: 12,
  neededUpliftPct: 3.9,
  plausibleCapPct: 7.8,
  feasibleRatio: 0,
  overshoot: true,
  ...over,
});

const matrixWith = (calibration: Record<string, unknown>) =>
  ({
    anchor: { sources: [], total: 0 },
    regions: [],
    baseline2026: {},
    cagrBase: {},
    chainGrade: { grade: "C", statisticalHops: 0, note: "" },
    chainDirection: { relatedIndustries: [] },
    qualitative: { opportunityFactors: [], riskFactors: [] },
    consistency: { bottomUpCagr: 13, topDownCagr: 16.9, tolerance: "" },
    crossValidation: [],
    limitations: [],
    calibration,
  }) as unknown as object;

// 렌더 문자열은 SSR 이스케이프 그대로(> → &gt;, ' → &#x27;) — 마크업 평문 핀.
const KO_LINE = "수용 드라이버 합 +12.0%p &gt; 필요 상향 3.9%p의 개연성 상한(7.8%p) — 중복 제안 기각을 검토하세요.";
const EN_LINE =
  "Accepted driver sum +12.0%p exceeds the plausibility cap (7.8%p) over the anchor&#x27;s needed uplift (3.9%p) — consider dismissing duplicate proposals.";

describe("CalibrationPanel overshoot line (render seam)", () => {
  test("overshoot true renders the ONE muted warning line with the numbers (ko)", () => {
    const html = render(
      createElement(CalibrationPanel, {
        industryId: "ind-1",
        matrix: matrixWith({
          triggered: true,
          ourCagrPct: 13,
          externalCagrPct: 16.9,
          gapPct: 26.2,
          previousGapPct: 24.8,
          appliedDrivers: ["운항 규제 완화"],
          overshoot: overshoot(),
        }),
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain(KO_LINE);
    // 읽기 전용 한 줄 — 제외(기각) 버튼이 이 선에서 렌더되지 않는다(경계 #2).
    expect((html.match(new RegExp(KO_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length).toBe(1);
  });

  test("en catalog renders the same numbers", () => {
    const html = render(
      createElement(CalibrationPanel, {
        industryId: "ind-1",
        matrix: matrixWith({
          triggered: true,
          ourCagrPct: 13,
          externalCagrPct: 16.9,
          gapPct: 26.2,
          previousGapPct: 24.8,
          appliedDrivers: [],
          overshoot: overshoot(),
        }),
      }),
      "en",
    );
    expect(html).toContain(EN_LINE);
  });

  test("overshoot undefined (legacy payload) → line absent", () => {
    const html = render(
      createElement(CalibrationPanel, {
        industryId: "ind-1",
        matrix: matrixWith({
          triggered: true,
          ourCagrPct: 13,
          externalCagrPct: 16.9,
          gapPct: 26.2,
          previousGapPct: 24.8,
          appliedDrivers: [],
        }),
      }),
    );
    expect(html).not.toContain(KO_LINE);
    expect(html).not.toContain('role="status"');
  });

  test("overshoot false → line absent", () => {
    const html = render(
      createElement(CalibrationPanel, {
        industryId: "ind-1",
        matrix: matrixWith({
          triggered: false,
          ourCagrPct: 13,
          externalCagrPct: 16.9,
          gapPct: 2,
          previousGapPct: 26,
          appliedDrivers: [],
          overshoot: overshoot({ overshoot: false }),
        }),
      }),
    );
    expect(html).not.toContain(KO_LINE);
    expect(html).not.toContain('role="status"');
  });

  test("regression — the unconverged badge still renders beside the line", () => {
    // 참고: 수용 칩 블록은 API 상태(load)에서 채워진다 — 정적 렌더 시에(empty)
    // 매트릭스의 appliedDrivers가 아니므로 이 시점에서는 배지가 맞는 회귀 핀.
    const html = render(
      createElement(CalibrationPanel, {
        industryId: "ind-1",
        matrix: matrixWith({
          triggered: true,
          ourCagrPct: 13,
          externalCagrPct: 16.9,
          gapPct: 26.2,
          previousGapPct: 24.8,
          appliedDrivers: ["운항 규제 완화"],
          overshoot: overshoot(),
        }),
      }),
    );
    expect(html).toContain("미수렴");
    expect(html).toContain("성장율 격차 보정 루프");
    expect(html).toContain(KO_LINE);
  });
});

describe("static contract — overshoot line wiring", () => {
  const panelSrc = normSrc(
    readFileSync(new URL(`${WEB}/components/stages/market/CalibrationPanel.tsx`, import.meta.url), "utf8"),
  );

  test("the line is gated on the signal and muted, and both locales carry the key", () => {
    expect(panelSrc).toContain(normSrc("cal?.overshoot?.overshoot === true"));
    expect(panelSrc).toContain(
      normSrc('<p role="status" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">'),
    );
    expect(panelSrc).toContain("acceptedDriverSumExceedsPlausibilityCap");
    expect(panelSrc).toContain("cal.overshoot.acceptedImpactSumPct.toFixed(1)");
    expect(panelSrc).toContain("cal.overshoot.neededUpliftPct.toFixed(1)");
    expect(panelSrc).toContain("cal.overshoot.plausibleCapPct.toFixed(1)");
    const cpOf = (cat: Record<string, unknown>) =>
      (cat as { stages: { s1: { calibrationPanel: Record<string, string> } } }).stages.s1.calibrationPanel;
    const koCp = cpOf(ko);
    const enCp = cpOf(en);
    for (const [locale, cp] of [
      ["ko", koCp],
      ["en", enCp],
    ] as const) {
      const v = cp.acceptedDriverSumExceedsPlausibilityCap;
      expect(typeof v === "string" && v.length > 0).toBe(true);
      expect(v).toContain("{p1}");
      expect(v).toContain("{p2}");
      expect(v).toContain("{p3}");
      expect(v).toContain(locale === "ko" ? "중복 제안 기각" : "dismissing duplicate proposals");
    }
  });
});
