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
      running: false,
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
    expect(btn({ running: true })).toContain(`disabled="" aria-label`);
    expect(btn({ running: true })).toContain(a.rowRunning);
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
  expect(keys.length).toBe(17);
  for (const k of keys) expect(en.stages.s67.aiEval[k]).toBeTruthy();
});

describe("row confirm button (ADR-0199)", () => {
  const rc = Promise.resolve(import(`${WEB}/components/stages/brownfield/AiEvalRowConfirm.tsx`));
  const chipOf = (over: Record<string, unknown> = {}) => ({
    version_no: 1,
    created_at: "2026-11-16T01:00:00Z",
    checked_at: "2026-11-16T01:00:00Z",
    provisional_score: 50,
    proposed_count: 3,
    unverified_count: 1,
    stale: false,
    evidence_grade: "A",
    ...over,
  });
  const base = { excluded: false, hasDart: true, running: false, draft: { financial: chipOf() } };
  test("disabled reasons: excluded, no DART, running, no draft, nothing writable; enabled otherwise", async () => {
    const m = (await rc) as Loose;
    expect(m.confirmDisabledReason(base)).toBeNull();
    expect(m.confirmDisabledReason({ ...base, excluded: true })).toBe("excluded");
    expect(m.confirmDisabledReason({ ...base, hasDart: false })).toBe("noDart");
    expect(m.confirmDisabledReason({ ...base, running: true })).toBe("running");
    expect(m.confirmDisabledReason({ ...base, draft: undefined })).toBe("noDraft");
    expect(m.confirmDisabledReason({ ...base, draft: { financial: chipOf({ proposed_count: 0 }) } })).toBe(
      "nothingWritable",
    );
  });
  test("button renders its reason as title + described-by text; enabled has none", async () => {
    const m = (await rc) as Loose;
    const mk = (over: Record<string, unknown>, locale: "ko" | "en" = "ko") =>
      render(
        createElement(m.AiEvalRowConfirm, {
          oppId: "o",
          targetId: "t",
          companyName: "Acme",
          onConfirmed: () => {},
          ...base,
          ...over,
        }),
        locale,
      );
    const off = mk({ running: true });
    expect(off).toContain("disabled");
    expect(off).toContain("aria-describedby");
    expect(off).toContain(ko.stages.s67.aiEval.rowConfirmDisabled.running);
    expect(mk({}, "en")).toContain('aria-label="Set Confirmed Status for Acme"');
    expect(mk({})).not.toContain("aria-describedby");
  });
  test("dialog: per-category checkbox sections with write/skip lists; no confirm-all", async () => {
    const m = (await rc) as Loose;
    const plan = (write: number) => ({
      write: Array.from({ length: write }, (_, i) => ({ criterion_id: `c${i}`, label: `기준${i}`, status: "pass" })),
      skippedHuman: [{ criterion_id: "h", label: "사람판정" }],
      skippedUnverified: [{ criterion_id: "u", label: "미확인" }],
    });
    const html = render(
      createElement(m.AiEvalRowConfirmBody, {
        sections: [
          { category: "financial", versionNo: 2, plan: plan(2) },
          { category: "technical", versionNo: 1, plan: plan(0) },
        ],
        selected: ["financial"],
        onToggle: () => {},
        busy: false,
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain("재무 v2 확정");
    expect(html).toContain("기술 v1 확정");
    expect(html).toContain("기준0");
    expect(html).toContain("사람판정");
    expect(html).toContain("미확인");
    expect(html.match(/type="checkbox"/g)?.length).toBe(2);
    expect(html).toContain("2건 확정"); // only the selected category counts
    expect(html).toContain(ko.stages.s67.aiEval.rowConfirmNothing); // technical has nothing writable
    expect(html).not.toMatch(/전체 확정|confirm all/i);
  });
  test("row action order in the longlist: evaluate, confirm, compare on one nowrap group", () => {
    const src = readFileSync(
      `${import.meta.dir}/../../app/web-next/components/stages/brownfield/LonglistSection.tsx`,
      "utf8",
    );
    const a = src.indexOf("<AiEvalRowButton");
    const b = src.indexOf("<AiEvalRowConfirm");
    const c = src.indexOf('ta("compare")');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(src).toContain('className="ai-row-actions"');
    const css = readFileSync(`${import.meta.dir}/../../app/web-next/app/styles.css`, "utf8");
    expect(css).toMatch(/\.ai-row-actions \{[^}]*flex-wrap: nowrap/);
  });
});
