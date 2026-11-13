// @version 1.0.0
/**
 * DriverLinksPanel pure-view render (spec 2026-11-13-s2-driver-linkage D-D,
 * accessibility section): rendered under NextIntlClientProvider via
 * renderToStaticMarkup (pattern: market-growth-banner-render.test.ts).
 * Pins: the C-grade / LLM-estimated label text on EVERY rendered link,
 * direction as text (never color alone), aria-labels on the attach select and
 * remove buttons, and the disabled reason line when the opportunity has no
 * linked S1 industry (the EntryMarketFlow gating precedent: disabled with a
 * reason, never silently hidden).
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
const { DriverLinksPanel } = (await import(`${WEB}/components/DriverLinksPanel.tsx`)) as {
  DriverLinksPanel: unknown;
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
const link = (over: Record<string, unknown> = {}) => ({
  driver_row_id: "idc-1",
  industry_id: "ind-1",
  industry_name: "산업",
  driver: "물류 수요 확대",
  direction: "upside" as const,
  impact_pct: 1.8,
  rationale: "외부 참조 대비 격차의 근거",
  decided_by: "analyst",
  decided_at: "2026-11-13T00:00:00.000Z",
  version_no: 3,
  confidence: "C" as const,
  attached_by: "analyst",
  attached_at: "2026-11-14T00:00:00.000Z",
  ...over,
});
const option = (over: Record<string, unknown> = {}) => ({
  id: "idc-2",
  driver: "내수 회복",
  direction: "downside" as const,
  impact_pct: 2.1,
  rationale: "r",
  decided_by: "analyst",
  decided_at: "2026-11-13T00:00:00.000Z",
  version_no: 3,
  ...over,
});
const panel = (over: Record<string, unknown> = {}) => ({
  opportunityName: "기회 A",
  industryId: "ind-1",
  acceptedDrivers: [option()],
  links: [link()],
  canAct: true,
  busy: false,
  onAttach: noop,
  onRemove: noop,
  ...over,
});

const PROVENANCE = "S1 수용 · LLM 추정 · 신뢰도 C";

describe("DriverLinksPanel — provenance rendering (D-D)", () => {
  test("every rendered link carries the C-grade / LLM-estimated label text", () => {
    const html = render(
      createElement(
        DriverLinksPanel,
        panel({ links: [link(), link({ driver_row_id: "idc-9", driver: "다른 드라이버" })] }),
      ),
    );
    expect(html).toContain('data-testid="driver-links-panel"');
    expect(html.match(new RegExp(PROVENANCE, "g"))?.length).toBe(2);
    expect(html).toContain("물류 수요 확대");
  });

  test("direction is conveyed by text plus glyph, impact as ±N%p — never color alone", () => {
    const html = render(
      createElement(
        DriverLinksPanel,
        panel({ links: [link(), link({ driver_row_id: "idc-9", direction: "downside", impact_pct: 2.1 })] }),
      ),
    );
    expect(html).toContain("상승");
    expect(html).toContain("하강");
    expect(html).toContain("+1.8%p");
    expect(html).toContain("-2.1%p");
    expect(html).toContain("▲");
    expect(html).toContain("▼");
  });

  test("the rationale is expandable via details/summary; note and decided date render", () => {
    const html = render(createElement(DriverLinksPanel, panel()));
    expect(html).toContain("<details");
    expect(html).toContain("근거 보기");
    expect(html).toContain("외부 참조 대비 격차의 근거");
    expect(html).toContain("2026-11-13");
  });

  test("the server-stamped C is rendered verbatim — no grade uplift in the view", () => {
    const html = render(createElement(DriverLinksPanel, panel()));
    expect(html).toContain("신뢰도 C");
    expect(html).not.toContain("신뢰도 B");
    expect(html).not.toContain("신뢰도 A");
  });

  test("ko and en locales both render the label", () => {
    const enHtml = render(createElement(DriverLinksPanel, panel()), "en");
    expect(enHtml).toContain("S1-accepted · LLM-estimated · confidence C");
    expect(enHtml).toContain("upside");
  });
});

describe("DriverLinksPanel — attach control and accessibility", () => {
  test("attach select carries an aria-label naming the opportunity; remove buttons are named", () => {
    const html = render(createElement(DriverLinksPanel, panel()));
    expect(html).toContain('aria-label="기회 기회 A에 연결할 S1 드라이버 선택"');
    expect(html).toContain('aria-label="드라이버 연결 해제 — 물류 수요 확대"');
    // The already-linked row is not offered again (dedupe in the select).
    expect(html).not.toContain('value="idc-1"');
    expect(html).toContain('value="idc-2"');
  });

  test("viewer (canAct: false) gets no attach control and no remove buttons, but sees the list", () => {
    const html = render(
      createElement(DriverLinksPanel, panel({ canAct: false, onAttach: undefined, onRemove: undefined })),
    );
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
    expect(html).toContain("물류 수요 확대");
    expect(html).toContain(PROVENANCE);
  });

  test("no linked industry renders the disabled reason line — never silently hidden", () => {
    const html = render(createElement(DriverLinksPanel, panel({ industryId: null })));
    expect(html).toContain("연결된 S1 산업이 없습니다");
    expect(html).toContain('role="note"');
    // The select and the attach button are disabled, not removed.
    expect(html).toContain("<select");
    expect(html).toContain("disabled");
  });

  test("no accepted drivers for the industry renders the no-drivers reason line", () => {
    const html = render(createElement(DriverLinksPanel, panel({ acceptedDrivers: [] })));
    expect(html).toContain("이 산업에 수용된 S1 드라이버가 없습니다");
  });

  test("empty link list renders the muted empty line, not a broken section", () => {
    const html = render(createElement(DriverLinksPanel, panel({ links: [] })));
    expect(html).toContain("연결된 드라이버가 없습니다.");
    expect(html).toContain('data-testid="driver-links-panel"');
  });
});
