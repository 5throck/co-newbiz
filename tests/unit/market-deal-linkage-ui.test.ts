// @version 1.0.0
/**
 * Deal-context S1 market list navigation fix (2026-10-16 decider-approved).
 *
 * Covers:
 *  - grouping.ts pure helpers: anchor-based value-chain grouping, the
 *    deal-context split (linked first, groups travel with their anchor),
 *    pin-promotion filter.
 *  - MarketAnalysisStage detail view: deal breadcrumb for linked industries,
 *    NEUTRAL "시장 분석 › <산업명>" breadcrumb for unlinked in a deal, no
 *    "다음: S2" for unlinked, "이 안건에 연결" CTA visible only for unlinked
 *    analyst+ users, standalone /market path untouched.
 *  - IndustryListSection: linked-first ordering and the muted
 *    "다른 검토의 산업 분석" header in deal context, single list elsewhere.
 *  - useDealIndustryLink composes opportunity.industry_id + project_industry
 *    bindings through the EXISTING endpoints (no new backend surface).
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildIndustryGroups,
  flattenGroups,
  filterPinned,
  splitGroups,
} from "../../app/web-next/components/stages/market/grouping.ts";
import type { IndustryRow, IndustryLink } from "../../app/web-next/components/stages/market/types.ts";

const MARKET = join(import.meta.dirname, "../../app/web-next/components/stages/market");

function src(rel: string): string {
  return readFileSync(join(MARKET, rel), "utf-8");
}

function row(id: string, opts: Partial<IndustryRow> = {}): IndustryRow {
  return { id, name_ko: `Industry ${id}`, name_en: null, ksic_code: null, driver_count: 0, analysis: null, ...opts };
}

// ── grouping.ts — anchor-based split ────────────────────────────────────────

test("splitGroups: linked anchors first, groups travel with their anchor", () => {
  const groups = [
    {
      ind: row("unlinked-anchor", {
        analysis: {
          id: "a2",
          status: "completed",
          current_step: 8,
          latest_version: 1,
          created_at: "2026-10-01",
          completed_at: "2026-10-02",
        },
      }),
      children: [{ ind: row("child"), relation: "전방" }],
    },
    { ind: row("linked-anchor", { pinned: 1 }), children: [] },
  ];
  const { linked, other } = splitGroups(groups, new Set(["linked-anchor"]));
  expect(linked.map((g) => g.ind.id)).toEqual(["linked-anchor"]);
  expect(other.map((g) => g.ind.id)).toEqual(["unlinked-anchor"]);
  // children travel with the anchor
  expect(other[0]!.children.map((c) => c.ind.id)).toEqual(["child"]);
});

test("splitGroups: null linkedIds (standalone /market) keeps a single list", () => {
  const groups = [
    { ind: row("a"), children: [] },
    { ind: row("b"), children: [] },
  ];
  const s = splitGroups(groups, null);
  expect(s.linked).toHaveLength(2);
  expect(s.other).toHaveLength(0);
});

test("splitGroups: empty linked set puts every group in the other section", () => {
  const groups = [{ ind: row("a"), children: [] }];
  const s = splitGroups(groups, new Set<string>());
  expect(s.linked).toHaveLength(0);
  expect(s.other).toHaveLength(1);
});

test("buildIndustryGroups: queue path (after_analysis_id) and proxy_link path both anchor children", () => {
  const parent = row("p", {
    analysis: {
      id: "a1",
      status: "completed",
      current_step: 8,
      latest_version: 1,
      created_at: "2026-10-01",
      completed_at: "2026-10-02",
    },
  });
  const queued = row("q", {
    analysis: {
      id: "a2",
      status: "pending",
      current_step: 0,
      latest_version: null,
      created_at: "2026-10-03",
      completed_at: null,
      after_analysis_id: "a1",
      linked_relation: "전전방",
    },
  });
  const linked = row("l", {
    analysis: {
      id: "a3",
      status: "completed",
      current_step: 8,
      latest_version: 1,
      created_at: "2026-10-04",
      completed_at: "2026-10-05",
    },
  });
  const links: IndustryLink[] = [{ from_industry_id: "p", to_industry_id: "l", relation: "전방" }];
  const groups = buildIndustryGroups([parent, queued, linked], links);
  const byId = new Map(groups.map((g) => [g.ind.id, g]));
  expect(
    byId
      .get("p")!
      .children.map((c) => c.ind.id)
      .sort(),
  ).toEqual(["l", "q"]);
});

test("buildIndustryGroups: linked_relation without after_analysis_id does not group", () => {
  const parent = row("p", {
    analysis: {
      id: "a1",
      status: "completed",
      current_step: 8,
      latest_version: 1,
      created_at: "2026-10-01",
      completed_at: "2026-10-02",
    },
  });
  const orphan = row("o", {
    analysis: {
      id: "a2",
      status: "pending",
      current_step: 0,
      latest_version: null,
      created_at: "2026-10-03",
      completed_at: null,
      linked_relation: "전방",
    },
  });
  const groups = buildIndustryGroups([parent, orphan], []);
  expect(groups.map((g) => g.ind.id).sort()).toEqual(["o", "p"]);
});

test("flattenGroups + filterPinned: pinned child promotes as a standalone row, single-parent assumption holds", () => {
  const parent = row("p", {
    analysis: {
      id: "a1",
      status: "completed",
      current_step: 8,
      latest_version: 1,
      created_at: "2026-10-01",
      completed_at: "2026-10-02",
    },
  });
  const child = row("c", { pinned: 1 });
  const promoted = filterPinned([{ ind: parent, children: [{ ind: child, relation: "전방" }] }]);
  expect(promoted.map((g) => g.ind.id)).toEqual(["c"]);
  expect(flattenGroups(promoted, new Set(), () => {})).toHaveLength(1);
});

// ── MarketAnalysisStage detail view (static contract) ──────────────────────

test("MarketAnalysisStage: deal breadcrumb for linked, NEUTRAL breadcrumb for unlinked in deal, standalone unchanged", () => {
  const s = src("MarketAnalysisStage.tsx");
  // linked in deal -> DealBreadcrumb with the industry tail (ADR-0197 added an
  // ignore comment above the element, so the two pins are split)
  expect(s).toContain("inDealContext ? (");
  expect(s).toContain('<DealBreadcrumb dealId={dealId!} stageId="S1" tail={[{ label: detail.industry.name_ko }]} />');
  // unlinked in deal -> neutral "시장 분석 › <산업명>" path, no deal tail
  expect(s).toContain('[{ label: t("marketAnalysis"), href: "/market" }, { label: detail.industry.name_ko }]');
  // standalone path (non-deal) keeps the original neutral items
  expect(s).toContain('label: t("reviewDealBoard"), href: "/deals"'); // i18n: standalone breadcrumb resolves through the catalog
});

test("MarketAnalysisStage: '다음: S2' for linked or intake-carried, CTA visible only for unlinked analyst+ (detail view)", () => {
  const s = src("MarketAnalysisStage.tsx");
  // i18n: CTA label resolves through the catalog (stages.s1.marketAnalysisStage.nextS2OpportunityDiscovery).
  // ADR-0197: the board intake carrier (?intake=<id>) also shows the S2
  // hand-off on the standalone market path so the carrier survives S1→S2.
  expect(s).toContain("(inDealContext || (!dealId && intakeId)) && (");
  expect(s).toContain('<PrimaryAction readOnly inline href={nextHref} label={t("nextS2OpportunityDiscovery")} />');
  expect(s).toContain("{!inDealContext && dealId && canCurate && (");
  expect(s).toContain("이 안건에 연결");
});

test("IndustryListSection: linked-first ordering with the muted other-reviews header (deal) and single list (standalone)", () => {
  const s = src("IndustryListSection.tsx");
  // linked section renders BEFORE the other-reviews section
  const linkedIdx = s.indexOf("ctx.linkedFlatRows");
  const otherIdx = s.indexOf('{t("otherDealsIndustryAnalyses")}'); // i18n: header key (IndustryListSection)
  const plainIdx = s.indexOf("<IndustryTable ctx={ctx} />");
  expect(linkedIdx).toBeGreaterThan(-1);
  expect(otherIdx).toBeGreaterThan(linkedIdx);
  expect(plainIdx).toBeGreaterThan(otherIdx);
  // muted header styling uses design tokens only
  expect(s).toContain("text-[color:var(--muted-fg)] uppercase tracking-wide");
});

test("useDealIndustryLink composes opportunity industry_id + project_industry via existing endpoints", () => {
  const s = src("useDealIndustryLink.ts");
  expect(s).toContain("/api/opportunities/${encodeURIComponent(dealId)}");
  expect(s).toContain("/api/projects/${encodeURIComponent(projId)}/industries");
  // degrade-to-empty on fetch failure (honest rendering of unknown linkage)
  expect(s).toContain("setLinkedIds(ids)");
  // linkedIds === null only outside a deal context
  expect(s).toContain("if (!dealId) { setLinkedIds(null)");
});

test("LinkToDealModal writes through the governed binding API with a mandatory rationale", () => {
  const s = src("LinkToDealModal.tsx");
  expect(s).toContain("/industries`");
  expect(s).toContain("industry_id: state.industry.id");
  expect(s).toContain("disabled={busy || !rationale.trim()}");
});
