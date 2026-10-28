// @version 1.0.0
/**
 * Stage-screen DOM-order contract (T-20261022-049).
 *
 * Locks the 2026-10-22 head/strip consistency fixes mechanically: on every
 * stage screen (S1-S12, both tracks) the StageFrame shell must render
 *
 *   1. div.stage-head whose FIRST child is the h1,
 *   2. the objective <p> directly after the head,
 *   3. the input/output strip (details.handoff-panel) directly after the
 *      objective — i.e. it is the 3rd frame child, which lands as the 4th/5th
 *      element on an assembled screen (after the main/breadcrumb wrapper),
 *   4. the rail slot: project screens carry StageTabs there (its StageRail nav
 *      followed by the stage-tabs-bar), deal screens the frame's own StageRail.
 *
 * The fixture is the both-track S1-S12 demo seed (brownfield seedS1ToS12Demo +
 * greenfield seedGreenfieldS1ToS12Demo) on a scratch SQLite database; every
 * screen is rendered once per track carrier with the ids the seeds return.
 *
 * Where the frame is mounted per screen (the entry points this file renders):
 *   S1        components/stages/market/MarketAnalysisStage.tsx (own StageFrame)
 *   S2-S4     app/deals/[id]/[stage]/page.tsx  (<StageFrame stageId="sN">)
 *   S5        the same page (track prop = the seeded carrier's track)
 *   S6·S7     the same page (composite stageId, track prop)
 *   S8-S12    components/stages/{BusinessCase,Dd,DealStructure,IcReview,Portfolio}Stage.tsx
 *
 * Rendering pattern (established by capability-cost-lines.test.ts): bun
 * resolves the .tsx modules at runtime, so every web-next module is imported
 * through a computed specifier; tsc runs without --jsx and never pulls them
 * into the program. next/navigation is mocked at its resolved file path so
 * the frame renders outside the Next runtime.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const WEB = join(PROJECT_ROOT, "app/web-next");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-stage-dom-contract.sqlite");
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import(join(PROJECT_ROOT, "db/client.ts"));
resetDb();
getDb(TEST_DB_PATH);

// ── next/navigation mock (resolved file path — intercepts every importer) ───
// The mock reads a mutable route binding set per rendered screen below.
let route: { path: string; params: Record<string, string> } = { path: "/", params: {} };
mock.module(join(WEB, "node_modules/next/navigation.js"), () => ({
  useParams: () => route.params,
  usePathname: () => route.path,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, back() {}, prefetch() {} }),
}));

// ── runtime-resolved render stack (imported only AFTER the navigation mock) ─
const reactPath = join(WEB, "node_modules/react/index.js");
const { renderToStaticMarkup } = (await import(join(WEB, "node_modules/react-dom/server.js"))) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(reactPath)) as {
  createElement: (type: unknown, props: unknown, ...kids: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(join(WEB, "node_modules/next-intl"))) as {
  NextIntlClientProvider: unknown;
};
const { AuthProvider } = await import(join(WEB, "lib/auth-client.tsx"));
const { StageFrame } = await import(join(WEB, "components/StageFrame.tsx"));
const { MarketAnalysisStage } = await import(join(WEB, "components/stages/market/MarketAnalysisStage.tsx"));
const { BusinessCaseStage } = await import(join(WEB, "components/stages/BusinessCaseStage.tsx"));
const { DdStage } = await import(join(WEB, "components/stages/DdStage.tsx"));
const { DealStructureStage } = await import(join(WEB, "components/stages/DealStructureStage.tsx"));
const { IcReviewStage } = await import(join(WEB, "components/stages/IcReviewStage.tsx"));
const { PortfolioStage } = await import(join(WEB, "components/stages/PortfolioStage.tsx"));
const koCatalog = (await import(join(WEB, "locales/ko.json"))).default as Record<string, unknown>;
const koOf = (key: string): string =>
  key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      koCatalog,
    ) as string;

const noop = () => {};
const withProviders = (el: unknown): unknown =>
  createElement(
    AuthProvider,
    null,
    createElement(
      NextIntlClientProvider,
      {
        locale: "ko",
        messages: koCatalog,
        now: new Date(),
        onError: noop,
        getMessageFallback: (info: { namespace?: string; key?: string }) => `${info.namespace ?? ""}.${info.key ?? ""}`,
      },
      el,
    ),
  );

// ── both-track seeded fixture ───────────────────────────────────────────────
interface SeedIds {
  opportunityId: string;
  projectId: string;
}
let bf: SeedIds;
let gf: SeedIds;

beforeAll(async () => {
  const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import(
    join(PROJECT_ROOT, "scripts/co-newbiz/seed-s1-s12-demo.ts")
  );
  bf = seedS1ToS12Demo(TEST_DB_PATH);
  gf = await seedGreenfieldS1ToS12Demo(TEST_DB_PATH);
}, 180_000);

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// ── rendered-markup contract helpers ────────────────────────────────────────
const HEAD = '<div class="stage-head">';
// react-dom/server (React 19) emits the strip details with an extra open=""
// attribute — match the class prefix only so the test survives that quirk.
const STRIP = '<details class="handoff-panel"';
const RAIL = '<nav aria-label="Stages"';
const TABS_BAR = '<div class="stage-tabs-bar">';

interface FrameParts {
  html: string;
  headIdx: number;
  h1Idx: number;
  objIdx: number;
  stripIdx: number;
  railIdx: number;
  /** End of the head block: the head div, or the subtitle paragraph that may follow it. */
  afterHead: number;
  subtitle: string | null;
}

/** Render one screen and locate the frame segments. Throws with the head of
 *  the markup when the frame is missing, so the screen name is in the message. */
function renderScreen(name: string, el: unknown): FrameParts {
  const html = renderToStaticMarkup(withProviders(el));
  const headIdx = html.indexOf(HEAD);
  if (headIdx < 0) throw new Error(`${name}: no stage-head rendered — ${html.slice(0, 200)}`);
  const h1Idx = html.indexOf("<h1", headIdx);
  const h1Close = html.indexOf("</h1>", h1Idx);
  const headClose = html.indexOf("</div>", h1Close);
  // An optional screen-title subtitle paragraph sits directly under the head (never a second h1).
  let afterHead = headClose + "</div>".length;
  let subtitle: string | null = null;
  const subIdx = html.indexOf("<p", headClose);
  if (subIdx >= 0 && html.slice(subIdx, html.indexOf(">", subIdx)).includes('data-testid="stage-subtitle"')) {
    const subClose = html.indexOf("</p>", subIdx);
    subtitle = html.slice(html.indexOf(">", subIdx) + 1, subClose);
    afterHead = subClose + "</p>".length;
  }
  const objIdx = html.indexOf("<p", afterHead);
  const objClose = html.indexOf("</p>", objIdx);
  const stripIdx = html.indexOf(STRIP, objClose);
  const stripClose = html.indexOf("</details>", stripIdx);
  const railIdx = html.indexOf(RAIL, stripClose);
  return { html, headIdx, h1Idx, objIdx, stripIdx, railIdx, afterHead, subtitle };
}

function h1Text(p: FrameParts): string {
  return p.html.slice(p.h1Idx, p.html.indexOf("</h1>", p.h1Idx));
}

/** The full head order contract for one rendered screen. */
function expectHeadOrder(label: string, p: FrameParts, expectTabs: boolean): void {
  const { html, headIdx, h1Idx, objIdx, stripIdx, railIdx, afterHead } = p;
  const objClose = html.indexOf("</p>", objIdx);
  const stripClose = html.indexOf("</details>", stripIdx);
  const breaks: string[] = [];
  // The FIRST h1 of the whole document is the frame's h1, and it is the
  // stage-head's first child (nothing but whitespace before it).
  if (html.indexOf("<h1") !== h1Idx) breaks.push("the frame h1 is not the document's first h1");
  if (html.slice(headIdx + HEAD.length, h1Idx).trim() !== "") breaks.push("h1 is not the stage-head's first child");
  // Objective paragraph directly after the head…
  if (html.slice(afterHead, objIdx).trim() !== "")
    breaks.push("objective is not directly after the head");
  // …strip directly after the objective…
  if (html.slice(objClose + "</p>".length, stripIdx).trim() !== "")
    breaks.push("strip is not directly after the objective");
  // …rail directly after the strip.
  if (html.slice(stripClose + "</details>".length, railIdx).trim() !== "")
    breaks.push("rail is not directly after the strip");
  if (expectTabs) {
    // StageTabs in the rail slot: its own StageRail nav is followed by the
    // stage-tabs bar (StageTabs renders rail + bar adjacent).
    const navClose = html.indexOf("</nav>", railIdx);
    if (html.slice(navClose + "</nav>".length, navClose + "</nav>".length + TABS_BAR.length) !== TABS_BAR) {
      breaks.push("StageTabs bar is not adjacent to the rail nav in the rail slot");
    }
  } else if (html.includes("stage-tabs-bar")) {
    breaks.push("deal screen renders a StageTabs bar");
  }
  if (breaks.length > 0) throw new Error(`${label}: ${breaks.join("; ")}`);
}

// ── S1-S7: deal stage screens (frame order on the seeded carriers) ─────────
describe("deal stage screens S1-S7 — head order on both seeded carriers", () => {
  type DealScreen = { name: string; h1Expect: string; path: string; el: unknown };

  const dealScreens = (opp: string, carrierTrack: "greenfield" | "brownfield"): DealScreen[] => [
    // S1: MarketAnalysisStage mounts its own StageFrame (documented exception).
    {
      name: "S1",
      h1Expect: "S1",
      path: `/deals/${opp}/s1`,
      el: createElement(MarketAnalysisStage, { embedded: true, dealId: opp }),
    },
    // S2-S4: the deal page mounts <StageFrame stageId="sN"> with guidance children.
    {
      name: "S2",
      h1Expect: "S2",
      path: `/deals/${opp}/s2`,
      el: createElement(StageFrame, { stageId: "S2", children: koOf("pages.dealStage.s2Guidance") }),
    },
    {
      name: "S3",
      h1Expect: "S3",
      path: `/deals/${opp}/s3`,
      el: createElement(StageFrame, { stageId: "S3", children: koOf("pages.dealStage.s3SynergyGuidance") }),
    },
    {
      name: "S3 회사",
      h1Expect: "S3",
      path: `/deals/${opp}/s3`,
      el: createElement(StageFrame, {
        stageId: "S3",
        subtitle: koOf("pages.dealStage.s3CompanyHeading"),
        children: koOf("pages.dealStage.s3CompanyGuidance"),
      }),
    },
    {
      name: "S4",
      h1Expect: "S4",
      path: `/deals/${opp}/s4`,
      el: createElement(StageFrame, { stageId: "S4", children: koOf("pages.dealStage.s4Guidance") }),
    },
    // S5 / S6·S7: track-fixed frames — the page passes the carrier's track.
    {
      name: "S5",
      h1Expect: "S5",
      path: `/deals/${opp}/s5`,
      el: createElement(StageFrame, {
        stageId: "S5",
        track: carrierTrack,
        children: koOf("pages.dealStage.s5Guidance"),
      }),
    },
    {
      name: "S6·S7",
      h1Expect: "S6",
      path: `/deals/${opp}/s6`,
      el: createElement(StageFrame, {
        stageId: ["S6", "S7"],
        track: carrierTrack,
        subtitle: koOf("pages.dealStage.s67Heading"),
        children: koOf("pages.dealStage.s67GuidancePre"),
      }),
    },
  ];

  for (const [trackName, seed] of [
    ["brownfield", () => bf],
    ["greenfield", () => gf],
  ] as const) {
    test(`track=${trackName}: every deal screen keeps h1 → objective → strip → rail`, () => {
      const { opportunityId: opp } = seed();
      for (const s of dealScreens(opp, trackName)) {
        route = { path: s.path, params: { id: opp } };
        const label = `${s.name} (${trackName})`;
        const p = renderScreen(label, s.el);
        expectHeadOrder(label, p, false);
        // The strip really is the handoff strip: inputs and the note role.
        expect(p.html.slice(p.stripIdx, p.railIdx)).toContain("입력 ←");
        expect(p.html.slice(p.stripIdx, p.railIdx)).toContain('role="note"');
        expect(h1Text(p)).toContain(s.h1Expect);
      }
    }, 120_000);
  }

  test("composite S6·S7 heading names both stages", () => {
    route = { path: `/deals/${bf.opportunityId}/s6`, params: { id: bf.opportunityId } };
    const p = renderScreen(
      "S6·S7",
      createElement(StageFrame, { stageId: ["S6", "S7"], subtitle: koOf("pages.dealStage.s67Heading") }),
    );
    // The current path (/s6) singles out S6: the h1 is that stage's canonical label, never the subtitle.
    expect(h1Text(p)).toContain("S6 대상 후보 발굴");
    expect(p.subtitle).toBe(koOf("pages.dealStage.s67Heading"));
  }, 60_000);

  test("h1 is the canonical stage label; the screen title renders as a subtitle, not an h1", () => {
    route = { path: `/deals/${bf.opportunityId}/s3`, params: { id: bf.opportunityId } };
    const p = renderScreen(
      "S3 company",
      createElement(StageFrame, { stageId: "S3", subtitle: koOf("pages.dealStage.s3CompanyHeading") }),
    );
    expect(h1Text(p).endsWith(">S3 시너지·전략적 적합성")).toBe(true);
    expect(p.subtitle).toBe(koOf("pages.dealStage.s3CompanyHeading"));
    expect(p.html.match(/<h1/g)?.length).toBe(1);
    expect(p.subtitle ?? "").not.toMatch(/^S\d/);
    // Composite frame with no single-stage path shows both canonical labels.
    route = { path: `/brownfield/targets/x`, params: { id: "x" } };
    const c = renderScreen("composite", createElement(StageFrame, { stageId: ["S6", "S7"], subtitle: "후보 상세" }));
    expect(h1Text(c)).toContain("S6 대상 후보 발굴 · S7 대상 선정");
  }, 60_000);
});

// ── S8-S12: project stage screens (real entry components, StageTabs rail) ──
describe("project stage screens S8-S12 — head order + StageTabs in the rail slot", () => {
  const entryByStage: Record<string, { seg: string; Entry: (props: Record<string, unknown>) => unknown }> = {
    S8: { seg: "business-case", Entry: BusinessCaseStage as (props: Record<string, unknown>) => unknown },
    S9: { seg: "dd", Entry: DdStage as (props: Record<string, unknown>) => unknown },
    S10: { seg: "deal-structure", Entry: DealStructureStage as (props: Record<string, unknown>) => unknown },
    S11: { seg: "ic-review", Entry: IcReviewStage as (props: Record<string, unknown>) => unknown },
    S12: { seg: "portfolio", Entry: PortfolioStage as (props: Record<string, unknown>) => unknown },
  };

  for (const [trackName, seed] of [
    ["brownfield", () => bf],
    ["greenfield", () => gf],
  ] as const) {
    test(`track=${trackName}: S8-S12 keep h1 → objective → strip → StageTabs(rail)`, () => {
      const pid = seed().projectId;
      for (const [stage, { seg, Entry }] of Object.entries(entryByStage)) {
        route = { path: `/projects/${pid}/${seg}`, params: { id: pid } };
        const label = `${stage} (${trackName})`;
        const p = renderScreen(label, createElement(Entry, { projectId: pid }));
        expectHeadOrder(label, p, true);
        // The rail slot really is StageTabs: a stage-tabs nav sits right after
        // the frame's rail nav, and the strip precedes both.
        expect(p.html.slice(p.stripIdx, p.railIdx)).toContain("입력 ←");
      }
    }, 180_000);
  }

  test("S8 heading is track-data-driven: SSR renders the default dual view for both seeds, the GF branch stays wired in source", () => {
    // The greenfield/brownfield heading switch reads the fetched business-case
    // payload (client effect), not the seed at render time — static markup
    // therefore shows the same default heading for both seeded carriers. The
    // per-track wording itself is locked by the source branch below.
    const h1Of = (pid: string): string => {
      route = { path: `/projects/${pid}/business-case`, params: { id: pid } };
      const { Entry } = entryByStage.S8;
      return h1Text(renderScreen("S8 heading", createElement(Entry, { projectId: pid })));
    };
    const gfH1 = h1Of(gf.projectId);
    const bfH1 = h1Of(bf.projectId);
    expect(gfH1).toContain("S8");
    expect(bfH1).toContain("S8");
    expect(gfH1).toBe(bfH1);
    const src = readFileSync(join(WEB, "components/stages/BusinessCaseStage.tsx"), "utf8");
    expect(src).toContain("subtitle={greenfield ? t(");
  }, 120_000);
});

// ── wiring lock (static): who mounts the frame, and StageTabs only via railSlot ──
describe("stage-screen wiring lock (static source)", () => {
  const WEB_DIR = join(PROJECT_ROOT, "app/web-next");
  const read = (rel: string): string => readFileSync(join(WEB_DIR, rel), "utf8");

  test("S8-S12 entry components pass StageTabs ONLY through the railSlot", () => {
    const files = [
      "components/stages/BusinessCaseStage.tsx",
      "components/stages/DdStage.tsx",
      "components/stages/DealStructureStage.tsx",
      "components/stages/IcReviewStage.tsx",
      "components/stages/PortfolioStage.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      const railSlots = src.match(/railSlot=\{<StageTabs projectId=\{projectId\} \/>\}/g) ?? [];
      expect(`${file}: exactly one railSlot StageTabs (got ${railSlots.length})`).toBe(
        `${file}: exactly one railSlot StageTabs (got 1)`,
      );
      expect(src.match(/<StageTabs/g)?.length).toBe(1);
    }
  });

  test("the deal stage page mounts DealBreadcrumb before StageFrame in every frame branch and never uses StageTabs", () => {
    const src = read("app/deals/[id]/[stage]/page.tsx");
    expect(src).not.toContain("<StageTabs");
    // Branch-scoped: each `if (stageId === ...)` segment that mounts a frame
    // must place the breadcrumb before it.
    const segments = src.split("if (stageId ===").slice(1);
    expect(segments.length).toBeGreaterThanOrEqual(6);
    for (const seg of segments) {
      const frameIdx = seg.indexOf("<StageFrame");
      if (frameIdx < 0) continue; // S1 delegates to MarketAnalysisStage; S8-S12 to the entry components
      const crumbIdx = seg.indexOf("<DealBreadcrumb");
      expect(crumbIdx).toBeGreaterThanOrEqual(0);
      expect(crumbIdx).toBeLessThan(frameIdx);
    }
  });

  test("S1 mounts its own frame (documented exception); the flat /market route stays a frame-free stub", () => {
    expect(read("components/stages/market/MarketAnalysisStage.tsx")).toContain('<StageFrame stageId="S1">');
    const market = read("app/market/page.tsx");
    expect(market).toContain("CarrierGate");
    expect(market).not.toContain("StageFrame");
  });
});
