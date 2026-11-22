// U3 — design 2026-11-21-s67-completion-visibility § Defect Remediation: on /deals/{id}/s6 the
// stage rail rendered 현재 on BOTH the S6 and the S7 step (the caller passed the combined
// ["S6","S7"] array into StageFrame — a holdover from the pre-Amendment-2 combined screen).
// StageFrame now narrows the rail's input to the viewed stage (pathStageId ?? primary), so
// exactly one step per rail carries the current marker (aria-current="step" + 현재) — in the
// full rail AND the compact disclosure list. StageRail's multi-stage contract is untouched.
// Render pins mount StageFrame under AuthProvider + NextIntlClientProvider (patterns:
// calibration-panel-render / stage-screen-dom-contract — useAuth throws outside AuthProvider)
// with next/navigation mocked at its resolved file path: the mock reads a mutable route
// binding set per test, so the render is independent of which process-global navigation
// mock a sibling test file left installed in single-process runs (bun test --coverage).
// renderToStaticMarkup emits class= (not className=), so the region markers use class=.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const WEB = join(PROJECT_ROOT, "app/web-next");

// ── next/navigation mock (resolved file path — intercepts every importer) ───
// Same shape as stage-screen-dom-contract.test.ts's mock; registering it here (before the
// runtime imports) makes this file's render immune to mock/file-ordering in the
// single-process coverage run instead of depending on the real module's contexts.
let route: { path: string; params: Record<string, string> } = { path: "/", params: {} };
mock.module(join(WEB, "node_modules/next/navigation.js"), () => ({
  useParams: () => route.params,
  usePathname: () => route.path,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, back() {}, prefetch() {} }),
}));

const { renderToStaticMarkup } = (await import(join(WEB, "node_modules/react-dom/server.js"))) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(join(WEB, "node_modules/react/index.js"))) as {
  createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(join(WEB, "node_modules/next-intl"))) as {
  NextIntlClientProvider: unknown;
};
const { AuthProvider } = (await import(join(WEB, "lib/auth-client.tsx"))) as { AuthProvider: unknown };
const ko = (await import(join(WEB, "locales/ko.json"))).default as Record<string, unknown>;
const { StageFrame } = (await import(join(WEB, "components/StageFrame.tsx"))) as { StageFrame: unknown };

const renderFrame = (pathname: string) => {
  route = { path: pathname, params: { id: "d1" } };
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "ko", messages: ko, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(
        AuthProvider,
        null,
        createElement(StageFrame, { stageId: ["S6", "S7"], track: "brownfield", subtitle: "s67" }),
      ),
    ),
  );
};

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
