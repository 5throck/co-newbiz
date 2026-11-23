// Amendment 4 — design 2026-11-21-s67-completion-visibility § Amendment 4: the target-detail
// back link is stage-aware. /brownfield/targets/{targetId} serves both the S6 long-list and the
// S7 short-list contexts, but its single return link hard-coded the carrier route
// (/brownfield?opportunity=…) whose rule-1 redirect always resolved to S6 — and the ko label
// doubled its word (후보 전체 목록 목록으로). The link now derives from the target's own
// status (shortlisted → /deals/{id}/s7 with 최종 후보 목록으로; pending/excluded →
// /deals/{id}/s6 with 후보 전체 목록으로), and the detail page's rail narrows to the same
// derived stage so exactly one step carries 현재 (U3's singular-현재 rule on this surface).
//
// Render pattern: s67-stage-rail-current.test.ts — next/navigation mocked at its resolved file
// path with a mutable route binding, and the page's two data hooks (useTargetDetail /
// useTargetActions) mocked the same way so the render is independent of sibling single-process
// mocks. renderToStaticMarkup emits class= (not className=) and inserts <!-- --> between
// adjacent text expressions, so arrow+label assertions use a tolerant pattern.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const WEB = join(PROJECT_ROOT, "app/web-next");

// ── mocks (resolved file paths — intercept every importer) ──────────────────
let route: { path: string; params: Record<string, string> } = { path: "/", params: {} };
mock.module(join(WEB, "node_modules/next/navigation.js"), () => ({
  useParams: () => route.params,
  usePathname: () => route.path,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, back() {}, prefetch() {} }),
}));

type TargetStatus = "pending" | "shortlisted" | "excluded";
// Mutable hook bindings — each render installs the state under test before mounting.
// The base state mirrors the full hook returns (useTargetDetail + useTargetActions) so the
// rendered tab bodies see the same idle shape the real hooks give before their effects run.
let detailState: Record<string, unknown> | null = null;
const noop = () => {};
const actionsState: Record<string, unknown> = {
  oppId: "o1",
  targetId: "t1",
  loadDetail: noop,
  setError: noop,
  setEvalBusy: noop,
  setBusy: noop,
  setRubricBusy: noop,
  setNewCriterionLabel: noop,
  setExcludeReason: noop,
  setEditing: noop,
  setEditDraft: noop,
  setDiscoveryTouched: noop,
  setDiscoveryError: noop,
  setDiscoverySaved: noop,
  setDiscPreset: noop,
  setRubricOpen: noop,
  setEvalWeight: noop,
  setEvalVerdict: noop,
  removeEvalCriterion: noop,
  saveRubric: noop,
  addEvalCriterion: noop,
  saveEdit: noop,
  acceptRuleVerdicts: noop,
  runCompanyAnalysis: noop,
  retrySync: noop,
  shortlist: noop,
  exclude: noop,
  deleteTarget: noop,
  confirm: noop,
  error: null,
  canAct: false,
  busy: false,
  excludeReason: "",
  profileTab: "overview",
  setProfileTab: noop,
  analyzing: false,
  companyProfile: undefined,
  companyId: null,
  confirmDialog: null,
  editing: false,
  editDraft: {
    company_name: "",
    dart_corp_code: "",
    universe_note: "",
    discovery_source: "manual",
    discovery_source_url: "",
    discovery_note: "",
  },
  discoveryTouched: false,
  discoveryError: null,
  discoverySaved: false,
  ct: { muted: "#666", split: "#ddd", color: ["#333"] },
  dartCode: "00123456",
  discPreset: "business",
  disclosures: undefined,
  rubricOpen: false,
  evalBusy: null,
  rubricBusy: null,
  syncError: null,
  syncWarnings: [],
  newCriterionLabel: {},
};
mock.module(join(WEB, "components/brownfield-target/useTargetDetail.ts"), () => ({
  useTargetDetail: () => ({ ...actionsState, detail: detailState }),
}));
mock.module(join(WEB, "components/brownfield-target/useTargetActions.ts"), () => ({
  useTargetActions: () => ({ ...actionsState }),
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
const ko = (await import(join(WEB, "locales/ko.json"))).default as Record<
  string,
  Record<string, Record<string, string>>
>;
const en = (await import(join(WEB, "locales/en.json"))).default as Record<
  string,
  Record<string, Record<string, string>>
>;
const { TargetDetailView } = (await import(join(WEB, "app/brownfield/targets/[targetId]/page.tsx"))) as {
  TargetDetailView: unknown;
};

/** Minimal DetailResponse: empty eval state — the header card and the rail render regardless. */
const detailOf = (status: TargetStatus) => ({
  target: {
    id: "t1",
    opportunity_id: "o1",
    company_name: "가시화회사",
    dart_corp_code: "00123456",
    universe_note: null,
    status,
    rank: status === "shortlisted" ? 2 : null,
    exclusion_reason: status === "excluded" ? "시장 적합성 부족" : null,
    screening_json: null,
    screening_evidence_json: null,
    company_id: null,
  },
  opportunity: { id: "o1", name: "백과기회", market_scope: "전력기기" },
  evalItems: [],
  scores: {
    financial: { score: null, scoredWeight: 0, totalWeight: 0, excludedWeight: 0 },
    technical: { score: null, scoredWeight: 0, totalWeight: 0, excludedWeight: 0 },
    combined: null,
  },
  checklist: [],
  screening_summary: { assessed: 0, total: 4, knockOutsPassed: true, anyKnockOutFail: false, mandatoryOpen: [] },
  evidence: [],
});

const renderDetail = (status: TargetStatus, locale: "ko" | "en" = "ko") => {
  detailState = detailOf(status);
  route = { path: "/brownfield/targets/t1", params: { id: "d1" } };
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(AuthProvider, null, createElement(TargetDetailView)),
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

describe("Amendment 4 — the target-detail back link is stage-aware", () => {
  test("a shortlisted target links the S7 short list and the rail marks S7 as the single 현재", () => {
    const html = renderDetail("shortlisted");
    expect(html).toContain('href="/deals/o1/s7"');
    expect(html).not.toContain("/brownfield?opportunity=");
    // the arrow prefix rides the component; the label comes from the new key
    expect(html.match(/← (?:<!-- -->)?최종 후보 목록으로/)?.length).toBe(1);
    expect(html).not.toContain("목록 목록");
    // rail: exactly one 현재, and it is the stage the back link targets
    expect(html.match(/aria-current="step"/g)?.length).toBe(2);
    const fullRail = html.slice(html.indexOf('class="stage-stepper"'));
    expect(fullRail.match(/>현재<\/span>/g)?.length).toBe(1);
    expect(stepAnchor(fullRail, "s7")).toContain('aria-current="step"');
    expect(stepAnchor(fullRail, "s6")).not.toContain("aria-current");
    // the h1 narrows to the derived stage (single-stage label, not the S6 · S7 composite)
    expect(html).toContain(">S7 대상 선정</h1>");
    expect(html).not.toContain("S6 대상 후보 발굴 · S7 대상 선정");
  });

  test("a pending target links the S6 full list and the rail marks S6 as the single 현재", () => {
    const html = renderDetail("pending");
    expect(html).toContain('href="/deals/o1/s6"');
    expect(html).not.toContain("/brownfield?opportunity=");
    expect(html.match(/← (?:<!-- -->)?후보 전체 목록으로/)?.length).toBe(1);
    // acceptance criterion 3 — the doubled word never renders, in any status
    expect(html).not.toContain("목록 목록");
    expect(html.match(/aria-current="step"/g)?.length).toBe(2);
    const fullRail = html.slice(html.indexOf('class="stage-stepper"'));
    expect(fullRail.match(/>현재<\/span>/g)?.length).toBe(1);
    expect(stepAnchor(fullRail, "s6")).toContain('aria-current="step"');
    expect(stepAnchor(fullRail, "s7")).not.toContain("aria-current");
    expect(html).toContain(">S6 대상 후보 발굴</h1>");
  });

  test("an excluded target keeps the S6 full-list link (the Long List is where its record is read)", () => {
    const html = renderDetail("excluded");
    expect(html).toContain('href="/deals/o1/s6"');
    expect(html.match(/← (?:<!-- -->)?후보 전체 목록으로/)?.length).toBe(1);
  });

  test("en parity: short list / full list labels, both locales carry the new key", () => {
    const enShort = renderDetail("shortlisted", "en");
    expect(enShort).toContain('href="/deals/o1/s7"');
    expect(enShort.match(/← (?:<!-- -->)?Back to the short list/)?.length).toBe(1);
    const enFull = renderDetail("pending", "en");
    expect(enFull.match(/← (?:<!-- -->)?Back to the full target list/)?.length).toBe(1);
    // ko/en key parity under pages.brownfieldTargetDetail
    for (const key of ["backToListLabel", "backToShortlistLabel"]) {
      expect(typeof ko.pages.brownfieldTargetDetail[key]).toBe("string");
      expect(typeof en.pages.brownfieldTargetDetail[key]).toBe("string");
    }
    expect(ko.pages.brownfieldTargetDetail.backToListLabel).toBe("후보 전체 목록으로");
    expect(ko.pages.brownfieldTargetDetail.backToShortlistLabel).toBe("최종 후보 목록으로");
    expect(en.pages.brownfieldTargetDetail.backToListLabel).toBe("Back to the full target list");
    expect(en.pages.brownfieldTargetDetail.backToShortlistLabel).toBe("Back to the short list");
  });

  test("the derivation reads target state only — same link from any entry path (source pin)", () => {
    const s = readFileSync("./app/web-next/app/brownfield/targets/[targetId]/page.tsx", "utf8");
    // escaped template literal so noTemplateCurlyInString stays silent
    expect(s).toContain(`href={\`/deals/\${encodeURIComponent(opportunity.id)}/\${shortlisted ? "s7" : "s6"}\`}`);
    expect(s).toContain('label={shortlisted ? tr("backToShortlistLabel") : tr("backToListLabel")}');
    expect(s).toContain("stageId={railStageId}");
    // no referrer/search-param input: the derivation is a pure function of t.status
    expect(s).not.toContain("searchParams");
    expect(s).not.toContain("referrer");
    expect(s).not.toContain("href={`/brownfield");
  });
});
