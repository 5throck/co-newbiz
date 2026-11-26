// @version 1.0.0
/**
 * ADR-0208 slice 3 - CreditRatingEvidence rendered under NextIntlClientProvider (house pattern:
 * discovery-panels-render.test.ts): the synthetic estimate block (coverage, period, interest source, estimate caveat,
 * superseded stale rating), the cross-check line with its warning chip (status by TEXT), recent bond coupons, and the
 * unreliable and unavailable cases, in ko and en. Placeholders must resolve (no raw `{name}` reaches the page).
 */
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
const { CreditRatingEvidence } = (await import(`${WEB}/components/wacc/CreditRatingEvidence.tsx`)) as {
  CreditRatingEvidence: unknown;
};

const render = (suggestion: Record<string, unknown>, locale: "ko" | "en") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(CreditRatingEvidence, { suggestion }),
    ),
  );

const synthetic = {
  available: true,
  used: true,
  rating: "A",
  coverage_x: 4.5,
  interest_source: "finance_costs",
  interest_is_proxy: true,
  fiscal_year: 2025,
  table_id: "damodaran-large-non-financial-2026-01",
  table_as_of: "2026-01-01",
  published_label: "A2/A",
  band_lower_x: 4.25,
  band_upper_x: 5.5,
  operating_income_krw_million: 450000,
  interest_expense_krw_million: 100000,
  loss_making: false,
  note: "n",
};
const crosscheck = {
  status: "warn",
  reason_code: null,
  reason: null,
  implied_cost_pct: 10,
  market_kd_pct: 5.315,
  gap_pp: -4.685,
  direction: "market_below_actual",
  interest_source: "interest_expense",
  fiscal_year: 2025,
  interest_expense_krw_million: 100000,
  avg_debt_krw_million: 1000000,
  debt_basis: "two_year_average",
  warn_gap_pp: 2,
};
const base = (over: Record<string, unknown> = {}) => ({
  key: "credit_spread",
  value: 1.454,
  as_of: "2026-10",
  rating: "A",
  rating_source: "synthetic",
  spread_basis: "ecos_interpolated",
  synthetic,
  crosscheck,
  issuance_status: "available",
  issuance_evidence: [
    {
      issued_on: "2026-03-10",
      amount_krw_million: 200000,
      coupon_pct: 4.35,
      rating_raw: "A+(KIS)",
      maturity_on: "2029-03-10",
      outstanding: true,
      source_rcept_no: "20260310000001",
    },
  ],
  rating_superseded: { basis: "disclosed", rating: "AA-", rated_on: "2024-05-01", source_rcept_no: "20250310000001" },
  ...over,
});

describe("CreditRatingEvidence - synthetic estimate", () => {
  test("ko: coverage line with period, interest source, estimate caveat, superseded rating, cross-check warning, coupons", () => {
    const html = render(base(), "ko");
    expect(html).toContain('data-testid="credit-synthetic-evidence"');
    expect(html).toContain("이자보상배율 추정 근거");
    expect(html).toContain("이자보상배율 4.50배 = 2025년 영업이익 450000백만원 ÷ 금융비용 100000백만원");
    expect(html).toContain("공표 등급표 구간 A2/A · 표 기준 2026-01-01");
    expect(html).toContain("이자 대신 쓴 항목: 금융비용");
    expect(html).toContain("추정치입니다");
    expect(html).toContain('data-testid="credit-synthetic-superseded"');
    expect(html).toContain("오래된 공시 등급 AA-(2024-05-01)");
    expect(html).toContain("rcpNo=20250310000001");
    // cross-check: text, with the warning as a chip that says what it is
    expect(html).toContain('data-testid="credit-crosscheck"');
    expect(html).toContain(
      "추정 실효이자율 10.00% (이자 100000백만원 ÷ 2개년 평균 차입금 1000000백만원) · 시장 Kd 5.32% · 차이 4.68%p",
    );
    expect(html).toContain("시장 Kd가 실제 차입비용보다 낮습니다");
    expect(html).toContain('data-testid="credit-crosscheck-warning"');
    expect(html).toContain("차이가 2.0%p를 넘습니다");
    expect(html).toContain("값은 바뀌지 않으며");
    // coupons as filed
    expect(html).toContain("2026-03-10 · 이표율 4.35% · 발행 시 등급 A+(KIS) · 만기 2029-03-10");
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test("en: the same blocks, glossary-clean English, no unresolved placeholder", () => {
    const html = render(base(), "en");
    expect(html).toContain("Interest-coverage estimate basis");
    expect(html).toContain(
      "Interest coverage 4.50x = FY2025 operating income 450000 million KRW ÷ finance costs 100000 million KRW",
    );
    expect(html).toContain("finance costs stands in for interest");
    expect(html).toContain("A stale disclosed rating AA- (2024-05-01) is on file");
    expect(html).toContain("The gap exceeds 2.0 pp");
    expect(html).toContain("two-year average");
    expect(html).toContain("coupon 4.35%");
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test("loss-making adds its line; an income-statement interest source shows no proxy note", () => {
    const html = render(
      base({
        synthetic: { ...synthetic, loss_making: true, interest_is_proxy: false, interest_source: "interest_expense" },
        crosscheck: { ...crosscheck, status: "ok", gap_pp: 1, market_kd_pct: 9 },
        rating_superseded: null,
      }),
      "ko",
    );
    expect(html).toContain("영업이익이 0 이하라");
    expect(html).not.toContain("이자 대신 쓴 항목");
    expect(html).not.toContain('data-testid="credit-synthetic-superseded"');
    expect(html).not.toContain('data-testid="credit-crosscheck-warning"');
    expect(html).toContain("차이가 2.0%p 이내입니다");
  });
});

describe("CreditRatingEvidence - the far-below-market warning", () => {
  const far = {
    ...crosscheck,
    status: "warn",
    reason_code: "crosscheck_implied_far_below_market",
    implied_cost_pct: 3.64,
    market_kd_pct: 10.358,
    gap_pp: 6.718,
    direction: "market_above_actual",
  };
  test("ko: the message with both figures plus the warning chip", () => {
    const html = render(base({ crosscheck: far }), "ko");
    expect(html).toContain('data-testid="credit-crosscheck-far-below"');
    expect(html).toContain(
      "실제 차입비용 3.64%가 시장 기준 10.36%보다 크게 낮습니다 — 정책금융·저리 차입 여부를 확인하세요",
    );
    expect(html).toContain('data-testid="credit-crosscheck-warning"');
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });
  test("en: the same, glossary-safe English", () => {
    const html = render(base({ crosscheck: far }), "en");
    expect(html).toContain("The actual borrowing cost 3.64% is far below the market-based Kd 10.36%");
    expect(html).toContain("policy finance or low-rate borrowing");
  });
  test("a warning in the other direction has no far-below message", () => {
    const html = render(base({ crosscheck: { ...crosscheck, reason_code: null } }), "ko");
    expect(html).toContain('data-testid="credit-crosscheck-warning"');
    expect(html).not.toContain("credit-crosscheck-far-below");
  });
});

describe("CreditRatingEvidence - cost-of-debt evidence without the synthetic block", () => {
  test("a disclosed rating still shows the cross-check and the coupons", () => {
    const html = render(
      base({
        rating_source: "disclosed",
        rating: "A+",
        synthetic: null,
        rating_agencies: [{ agency: "kis", grade: "A+", rated_on: "2026-01-02", outlook: null }],
        rating_rated_on: "2026-01-02",
        source_rcept_no: "20260310000001",
        rating_superseded: null,
      }),
      "en",
    );
    expect(html).toContain('data-testid="credit-disclosed-evidence"');
    expect(html).toContain('data-testid="credit-crosscheck"');
    expect(html).toContain('data-testid="credit-issuance"');
    expect(html).not.toContain('data-testid="credit-synthetic-evidence"');
  });

  test("unreliable cross-check is a plain note; unavailable or empty evidence renders nothing", () => {
    const unreliable = render(
      base({
        rating_source: "default",
        synthetic: null,
        rating_superseded: null,
        issuance_status: "issues_unavailable",
        issuance_evidence: [],
        crosscheck: { ...crosscheck, status: "unreliable", gap_pp: null, direction: null },
      }),
      "en",
    );
    expect(unreliable).toContain('data-testid="credit-crosscheck-unreliable"');
    expect(unreliable).toContain("zero or negative");
    expect(unreliable).not.toContain("credit-crosscheck-warning");
    expect(unreliable).not.toContain('data-testid="credit-issuance"');
    const nothing = render(
      base({
        rating_source: "default",
        synthetic: {
          available: false,
          used: false,
          reason_code: "synthetic_no_financials",
          reason: "x",
          resync_hint: false,
        },
        rating_superseded: null,
        issuance_status: "none_in_window",
        issuance_evidence: [],
        crosscheck: { ...crosscheck, status: "unavailable", implied_cost_pct: null, gap_pp: null, direction: null },
      }),
      "en",
    );
    expect(nothing).toBe("");
  });
});
