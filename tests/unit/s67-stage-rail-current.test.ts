// U3 — design 2026-11-21-s67-completion-visibility § Defect Remediation: on /deals/{id}/s6 the
// stage rail rendered 현재 on BOTH the S6 and the S7 step (the caller passed the combined
// ["S6","S7"] array into StageFrame — a holdover from the pre-Amendment-2 combined screen).
// StageFrame now narrows the rail's input to the viewed stage (pathStageId ?? primary), so
// exactly one step per rail carries the current marker (aria-current="step" + 현재) — in the
// full rail AND the compact disclosure list. StageRail's multi-stage contract is untouched.
// Render pins mount StageFrame with the next/navigation context stubs (Pathname/PathParams);
// renderToStaticMarkup emits class= (not className=), so the region markers below use class=.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
const { AppRouterContext } = (await import(
  `${WEB}/node_modules/next/dist/shared/lib/app-router-context.shared-runtime.js`
)) as { AppRouterContext: { Provider: unknown } };
const { PathnameContext, PathParamsContext } = (await import(
  `${WEB}/node_modules/next/dist/shared/lib/hooks-client-context.shared-runtime.js`
)) as { PathnameContext: { Provider: unknown }; PathParamsContext: { Provider: unknown } };
const { StageFrame } = (await import(`${WEB}/components/StageFrame.tsx`)) as { StageFrame: unknown };

const noop = () => {};
const routerStub = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop };

const renderFrame = (pathname: string) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "ko", messages: ko, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(
        AppRouterContext.Provider,
        { value: routerStub },
        createElement(
          PathnameContext.Provider,
          { value: pathname },
          createElement(
            PathParamsContext.Provider,
            { value: { id: "d1" } },
            createElement(StageFrame, {
              stageId: ["S6", "S7"],
              track: "brownfield",
              subtitle: "s67",
            }),
          ),
        ),
      ),
    ),
  );

/** The compact list and the full rail render one anchor per stage; slice out the given stage's anchor. */
const stepAnchor = (html: string, stage: "s6" | "s7"): string => {
  const href = `href="/deals/d1/${stage}"`;
  const i = html.indexOf(href);
  expect(i).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<", i);
  const end = html.indexOf("</a>", i);
  return html.slice(start, end === -1 ? undefined : end + 4);
};

describe("stage rail current marker on the s67 routes (U3)", () => {
  test("/deals/d1/s6: exactly one aria-current per rail, both on the S6 step", () => {
    const html = renderFrame("/deals/d1/s6");
    // one marker in the compact list + one in the full rail — never more
    expect(html.match(/aria-current="step"/g)?.length).toBe(2);
    for (const region of ['class="stage-stepper-compact-list"', 'class="stage-stepper"']) {
      const slice = html.slice(html.indexOf(region));
      const s6 = stepAnchor(slice, "s6");
      const s7 = stepAnchor(slice, "s7");
      expect(s6).toContain('aria-current="step"');
      expect(s7).not.toContain("aria-current");
      expect(s7).not.toContain("현재");
    }
    // the full rail's 현재 marker renders exactly once and inside the S6 step
    const fullRail = html.slice(html.indexOf('class="stage-stepper"'));
    expect(fullRail.match(/>현재<\/span>/g)?.length).toBe(1);
  });

  test("/deals/d1/s7: the mirror — S7 marked once, S6 unmarked", () => {
    const html = renderFrame("/deals/d1/s7");
    expect(html.match(/aria-current="step"/g)?.length).toBe(2);
    for (const region of ['class="stage-stepper-compact-list"', 'class="stage-stepper"']) {
      const slice = html.slice(html.indexOf(region));
      const s6 = stepAnchor(slice, "s6");
      const s7 = stepAnchor(slice, "s7");
      expect(s7).toContain('aria-current="step"');
      expect(s6).not.toContain("aria-current");
      expect(s6).not.toContain("현재");
    }
    const fullRail = html.slice(html.indexOf('class="stage-stepper"'));
    expect(fullRail.match(/>현재<\/span>/g)?.length).toBe(1);
  });

  test("the rail input is the viewed stage, not the caller's combined array (source pin)", () => {
    // readFileSync is cwd-relative (bun test runs from the repo root), unlike the dynamic
    // imports above which resolve relative to this file.
    const s = readFileSync("./app/web-next/components/StageFrame.tsx", "utf8");
    expect(s).toContain("StageRail current={pathStageId ? [pathStageId] : [primary]}");
    expect(s).not.toContain("StageRail current={ids}");
  });
});
