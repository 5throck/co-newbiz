// @version 1.0.0
/**
 * ADR-0208 slice 4 - CreditSpreadSourceEvidence rendered under NextIntlClientProvider (house pattern:
 * credit-rating-evidence-render.test.ts): the KOFIA grade-yield evidence (only for the kofia_grade basis: grade yield, same-date
 * KTB, date, source link restricted to kofiabond.or.kr) and the FSC bond cross-check block (lookup button, no apply control,
 * nothing fetched on render, the KOGL notice only once evidence exists). ko and en; placeholders must resolve.
 * The bond rows and the lookup states are checked through the pure view helpers the block renders from.
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
const { KofiaYieldEvidence, BondEvidenceBlock } = (await import(
  `${WEB}/components/wacc/CreditSpreadSourceEvidence.tsx`
)) as { KofiaYieldEvidence: unknown; BondEvidenceBlock: unknown };
const items = await import(`${WEB}/lib/wacc-reference-items.ts`);

const render = (component: unknown, props: Record<string, unknown>, locale: "ko" | "en") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(component, props),
    ),
  );

const kofiaSuggestion = (over: Record<string, unknown> = {}) => ({
  key: "credit_spread",
  value: 1.322,
  as_of: "2026-11",
  rating: "A",
  rating_source: "disclosed",
  spread_basis: "kofia_grade",
  kofia: {
    date: "2026-11-26",
    grade: "A",
    tenor: "3y",
    grade_yield_pct: 4.934,
    ktb_pct: 3.612,
    series_id: "kofia:corp-public-unsecured:A:3y",
    ktb_series_id: "kofia:ktb:3y",
    source_url:
      "https://www.kofiabond.or.kr/websquare/websquare.html?w2xPath=/xml/Com/Common_TabMnuDsp.xml&divisionId=MBIS01070010000000",
    source_label: "KOFIA",
  },
  ...over,
});

describe("KofiaYieldEvidence", () => {
  test("ko: grade yield, same-date KTB, date and the KOFIA source link", () => {
    const html = render(KofiaYieldEvidence, { suggestion: kofiaSuggestion() }, "ko");
    expect(html).toContain('data-testid="credit-kofia-evidence"');
    expect(html).toContain("금융투자협회 등급별 수익률");
    expect(html).toContain("A 3년 수익률 4.93% − 국고채 3년 3.61% (2026-11-26, 같은 날짜의 값)");
    expect(html).toContain('href="https://www.kofiabond.or.kr/');
    expect(html).toContain("출처: 금융투자협회 채권정보센터");
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });
  test("en: same block, English text, placeholders resolved", () => {
    const html = render(KofiaYieldEvidence, { suggestion: kofiaSuggestion() }, "en");
    expect(html).toContain("KOFIA grade yield");
    expect(html).toContain("A 3-year yield 4.93% - KTB 3-year 3.61% (value of the same date, 2026-11-26)");
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });
  test("nothing for any other basis; a source URL outside kofiabond.or.kr is shown as text, never a link", () => {
    expect(
      render(KofiaYieldEvidence, { suggestion: kofiaSuggestion({ spread_basis: "ecos_interpolated" }) }, "ko"),
    ).toBe("");
    expect(render(KofiaYieldEvidence, { suggestion: kofiaSuggestion({ kofia: null }) }, "ko")).toBe("");
    const evil = kofiaSuggestion();
    (evil.kofia as { source_url: string }).source_url = "https://evil.example/x";
    const html = render(KofiaYieldEvidence, { suggestion: evil }, "ko");
    expect(html).toContain("credit-kofia-evidence");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("<a ");
  });
});

describe("BondEvidenceBlock (initial render)", () => {
  test("ko: a lookup button and the reference-only hint; no apply control, no notice before a lookup, nothing fetched", () => {
    const html = render(BondEvidenceBlock, { projectId: "p1", targetId: null }, "ko");
    expect(html).toContain('data-testid="bond-evidence-block"');
    expect(html).toContain("발행사 유통 채권 (참고)");
    expect(html).toContain("참고 증거일 뿐 적용값이 아니며 일괄 적용에 들어가지 않습니다");
    expect(html).toContain('data-testid="bond-evidence-lookup"');
    expect(html).toContain("유통 채권 조회");
    expect(html).not.toContain("bond-evidence-notice");
    expect((html.match(/<button/g) ?? []).length).toBe(1); // the lookup button only: nothing here can apply a value
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });
  test("en", () => {
    const html = render(BondEvidenceBlock, { projectId: "p1", targetId: "t1" }, "en");
    expect(html).toContain("Issuer&#x27;s outstanding bonds (reference)");
    expect(html).toContain("Look up outstanding bonds");
    expect(html).toContain("not an applied value, and not part of apply-all");
  });
});

describe("bond evidence view helpers", () => {
  const payload = (status: string) => ({
    project_id: "p1",
    company: { id: "c1", name_ko: "한화솔루션" },
    evidence: {
      cross_check_only: true,
      status,
      reason_code: null,
      reason: null,
      issuer: { query_name: "한화솔루션", matched_name: "한화솔루션", crno: "1101110360935", match_basis: "name" },
      bonds: [
        {
          isin: "KR6009832C14",
          name: "한화솔루션279-2",
          issued_on: "2022-01-24",
          matures_on: "2027-01-22",
          coupon_pct: 3.029,
          balance_krw_million: 105000,
          seniority: null,
          guarantee: null,
          offering: null,
          last_price: { as_of: "2022-04-14", yield_pct: 3.997, close_price: 9648 },
          price_status: "traded",
        },
        {
          isin: "KR6009832F29",
          name: "한화솔루션292-1",
          issued_on: null,
          matures_on: "2027-02-19",
          coupon_pct: 3.361,
          balance_krw_million: 150000,
          seniority: null,
          guarantee: null,
          offering: null,
          last_price: null,
          price_status: "not_traded_in_window",
        },
      ],
      basis_date: "2026-11-26",
      truncated: false,
      price_window_months: 12,
      fetched_at: "2026-11-27T00:00:00Z",
      attribution: {
        basic: { dataset: "a", license: "b", provider: "c", url: "https://www.data.go.kr/data/15059592/openapi.do" },
        price: { dataset: "a", license: "b", provider: "c", url: "https://www.data.go.kr/data/15094784/openapi.do" },
      },
    },
  });
  test("rows only for status ok; yield and its trading day are carried as published", () => {
    const rows = items.bondEvidenceRows(payload("ok"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "KR6009832C14", couponPct: 3.029, yieldPct: 3.997, yieldAsOf: "2022-04-14" });
    expect(rows[1]).toMatchObject({ yieldPct: null, priceStatus: "not_traded_in_window" });
    for (const s of ["unavailable", "ambiguous_issuer", "no_bonds"])
      expect(items.bondEvidenceRows(payload(s))).toEqual([]);
    expect(items.bondEvidenceRows(null)).toEqual([]);
  });
  test("endpoint urls", () => {
    expect(items.bondEvidenceUrl("p 1")).toBe("/api/projects/p%201/wacc/bond-evidence");
    expect(items.bondEvidenceUrl("p1", "t&1")).toBe("/api/projects/p1/wacc/bond-evidence?target_id=t%261");
    expect(items.kofiaCollectUrl("p1")).toBe("/api/projects/p1/wacc/kofia/collect");
  });
});
