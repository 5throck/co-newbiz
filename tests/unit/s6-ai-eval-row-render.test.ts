// @version 1.0.0
/** Per-candidate AI evaluation row action (ADR-0199 follow-up): button, scoped dialog text, request body, disabled
 * states, ko/en key parity. Same render pattern as s6-ai-eval-render.test.ts. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// biome-ignore lint/suspicious/noExplicitAny: test reads untyped module namespaces and JSON catalogs
type Loose = any;
const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as Loose;
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as Loose;
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as Loose;
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, Loose>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, Loose>;
const row = (await import(`${WEB}/components/stages/brownfield/AiEvalRowButton.tsx`)) as Loose;
const dialogs = (await import(`${WEB}/components/stages/brownfield/AiEvalDialogs.tsx`)) as Loose;
const hook = (await import(`${WEB}/components/stages/brownfield/useAiEval.ts`)) as Loose;

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, timeZone: "Asia/Seoul" }, el),
  );
const btn = (over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
  render(
    createElement(row.AiEvalRowButton, {
      companyName: "Acme",
      targetId: "t1",
      excluded: false,
      hasDart: true,
      block: null,
      busy: false,
      onStart: async () => true,
      ...over,
    }),
    locale,
  );

describe("row button", () => {
  test("enabled with an aria-label naming the candidate", () => {
    const html = btn();
    expect(html).toContain('aria-label="Acme AI 평가 실행"');
    expect(html).not.toContain("disabled");
    expect(btn({}, "en")).toContain('aria-label="Run AI evaluation for Acme"');
  });
  test("disabled with a visible reason: running, excluded, non-DART", () => {
    const a = ko.stages.s67.aiEval;
    expect(btn({ block: "bulk" })).toContain(`disabled="" aria-label`);
    expect(btn({ block: "bulk" })).toContain(a.rowRunning);
    expect(btn({ block: "target" })).toContain(a.rowTargetRunning);
    expect(btn({ block: "cap" })).toContain("동시에 실행할 수 있는 AI 평가 3건에 도달");
    expect(btn({ excluded: true })).toContain(a.rowExcluded);
    expect(btn({ hasDart: false })).toContain(a.rowNoDart);
  });
});

describe("scoped dialog + body", () => {
  test("summary names the candidate and replaces the bulk line; web evidence stays off", () => {
    const html = render(
      createElement(dialogs.AiEvalStartForm, {
        value: { categories: "both", web_evidence: false, force_refresh: false },
        onChange: () => {},
        stats: { candidates: 1, dartEligible: 1, estimatedCalls: 14 },
        summary: ko.stages.s67.aiEval.rowSummary.replace("{company}", "Acme").replace("{calls}", "14"),
        busy: false,
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain("Acme 한 곳을 평가합니다");
    expect(html).not.toContain("후보 1곳 중");
    expect(html.match(/<input type="checkbox"[^>]*>/g)).toEqual([
      '<input type="checkbox"/>',
      '<input type="checkbox"/>',
    ]);
  });
  test("start body carries target_ids only for a scoped run; web_evidence defaults false", () => {
    const o = { categories: "both", web_evidence: false, force_refresh: false };
    expect(hook.buildStartBody(o, ["t1"])).toEqual({ ...o, target_ids: ["t1"] });
    expect(hook.buildStartBody(o)).toEqual(o);
    expect(hook.buildStartBody(o, ["t1"]).web_evidence).toBe(false);
  });
});

describe("longlist table fits the pane (no horizontal scroll at about 730px)", () => {
  const src = readFileSync(
    `${import.meta.dir}/../../app/web-next/components/stages/brownfield/LonglistSection.tsx`,
    "utf8",
  );
  test("six column shares sum to 100, small min width, exclusion reason moved into the name cell", () => {
    const shares = /LONG_LIST_COL_PCT = \[([\d, ]+)\]/.exec(src)?.[1].split(",").map(Number) ?? [];
    expect(shares.length).toBe(6);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(src).toContain("tmin-32 longlist-table");
    expect(src).not.toContain("tmin-56");
    expect(src).not.toContain('<th scope="col">{t("exclusionReason")}</th>');
    expect(src).toContain("colSpan={6}");
    expect(src).toContain("<AiEvalRowButton");
  });
});

test("ko/en parity for row keys", () => {
  const keys = Object.keys(ko.stages.s67.aiEval).filter((k) => k.startsWith("row"));
  expect(keys.length).toBe(13); // row button + reasons + rowSeg phrases (the row confirm keys are gone, ADR-0200)
  for (const k of keys) expect(en.stages.s67.aiEval[k]).toBeTruthy();
});

describe("row actions (ADR-0200): [AI 평가][항목 검토][버전 비교], no confirm", () => {
  const src = readFileSync(
    `${import.meta.dir}/../../app/web-next/components/stages/brownfield/LonglistSection.tsx`,
    "utf8",
  );
  test("order in the longlist: AI 평가, 항목 검토 (link to the detail evaluation tab), 버전 비교 on one nowrap group", () => {
    const a = src.indexOf("<AiEvalRowButton");
    const b = src.indexOf("reviewItemsHref(tgt.id)");
    const c = src.indexOf('ta("compare")');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(src).not.toContain("AiEvalRowConfirm");
    expect(src).toContain('className="ai-row-actions"');
    const css = readFileSync(`${import.meta.dir}/../../app/web-next/app/styles.css`, "utf8");
    expect(css).toMatch(/\.ai-row-actions \{[^}]*flex-wrap: nowrap/);
  });
  test("항목 검토 goes to the candidate detail page with ?tab=eval, which the detail page reads", () => {
    const promote = readFileSync(
      `${import.meta.dir}/../../app/web-next/components/stages/brownfield/AiEvalPromote.tsx`,
      "utf8",
    );
    expect(promote).toContain("/brownfield/targets/$" + "{encodeURIComponent(targetId)}?tab=eval");
    const detail = readFileSync(
      `${import.meta.dir}/../../app/web-next/components/brownfield-target/useTargetDetail.ts`,
      "utf8",
    );
    expect(detail).toContain('get("tab") === "eval"');
    expect(ko.stages.s67.aiEval.reviewItems).toBe("항목 검토");
  });
  test("the row link is emphasized only while unreviewed verdicts exist", () => {
    expect(src).toContain('(es?.unreviewed_total ?? 0) > 0 ? " font-semibold" : ""');
  });
});
