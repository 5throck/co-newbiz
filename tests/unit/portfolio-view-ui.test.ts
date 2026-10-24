/**
 * Source-reading tests for the /portfolio-view rebuild (design
 * 2026-10-11-portfolio-view-overlap §5, Row 2). Pattern of
 * ui-label-sweep.test.ts: assert the page stays wired to the server-side
 * overlap API and keeps the tier/N-A/empty-state contract.
 *
 * i18n (design 2026-10-23-i18n-ui-adoption): the page resolves its wording
 * through pages.portfolioView.* keys at render time, so the source side pins
 * the key call sites and the human-visible Korean wording is pinned against
 * the ko master catalog (same pattern as table-sizing MIGRATED_TABLE_LABELS).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "app", "web-next");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "app/portfolio-view/page.tsx";

const koCatalog = await import("../../app/web-next/locales/ko.json");

function koOf(key: string): string {
  const v = key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog);
  if (typeof v !== "string") throw new Error(`ko catalog key not found: ${key}`);
  return v;
}

describe("portfolio-view overlap UI (design 2026-10-11)", () => {
  const src = read(PAGE);

  test("group header dedups equal industry names via dedupTermNames", () => {
    expect(src).toMatch(/import \{[^}]*dedupTermNames[^}]*\} from "\.\.\/\.\.\/lib\/labels/);
    expect(src).toMatch(/dedupTermNames\(g\.industry\.name_ko, g\.industry\.name_en\)/);
    expect(src).not.toMatch(/\{g\.industry\.name_(en|ko)\}/);
  });

  test("page consumes GET /api/portfolio/overlap", () => {
    expect(src).toMatch(/api\.get<[^>]*>\("\/api\/portfolio\/overlap"\)/);
  });

  test("no client-side market_scope dedup remains", () => {
    expect(src).not.toMatch(/market_scope/);
    expect(src).not.toMatch(/useMemo/);
    expect(src).not.toMatch(/\/api\/opportunities|\/api\/projects(?!\S)/);
  });

  test("tier chips are text-conveying and tier-separated", () => {
    // Key call sites in source (TIER_LABEL_KEY resolves per tier at render).
    expect(src).toMatch(/t\(TIER_LABEL_KEY\[tier\]\)/);
    expect(src).toMatch(/t\("tierNamePrefixNote"\)/);
    expect(src).toMatch(/status-chip status-amber/);
    expect(src).toMatch(/status-chip status-unknown/);
    // Human-visible wording pinned to the ko catalog.
    expect(koOf("pages.portfolioView.tierExact")).toBe("산업 일치");
    expect(koOf("pages.portfolioView.tierNamePrefix")).toBe("근사 매칭");
    expect(koOf("pages.portfolioView.tierNamePrefixNote")).toContain("문자열이 같은 경우의 근사 매칭");
  });

  test("proposal-only Group IC framing line per group", () => {
    expect(src).toMatch(/t\("groupFootnoteLead"\)/);
    expect(src).toMatch(/<strong>\{t\("groupFootnoteBold"\)\}<\/strong>/);
    expect(src).toMatch(/t\("groupFootnoteTail"\)/);
    expect(koOf("pages.portfolioView.groupFootnoteBold")).toBe("제안");
    expect(koOf("pages.portfolioView.groupFootnoteTail")).toContain("판단은 그룹 투자심의위원회가 합니다");
  });

  test("empty state and N/A explainer present", () => {
    expect(src).toMatch(/t\("empty"\)/);
    expect(src).toMatch(/t\("naHeading"\)/);
    expect(src).toMatch(/t\("naExplainer"\)/);
    expect(koOf("pages.portfolioView.empty")).toBe("중복 노출 후보가 없습니다.");
    expect(koOf("pages.portfolioView.naHeading")).toContain("산업 미지정");
    const explainer = koOf("pages.portfolioView.naExplainer");
    expect(explainer).toContain("임의로 그룹화하지 않습니다");
    expect(explainer).toContain("S1 산업 지정");
    expect(explainer).toContain("S8+ 산업 바인딩");
  });

  test("hidden-promoted notice, empty-state branches, limits note, new reasons", () => {
    expect(src).toMatch(/hidden_promoted/);
    expect(src).toMatch(/t\("hiddenNote"/);
    expect(src).toMatch(/naTotal > 0 \|\| hiddenCount > 0/);
    expect(src).toMatch(/t\("emptyPartialNote"\)/);
    expect(src).toMatch(/overlap-limits-note/);
    expect(src).toMatch(/t\("limitsNote"\)/);
    // N/A reason key map resolves at render; the unresolved fallback is pinned.
    expect(src).toMatch(/industry_unresolved: "naReasonUnresolved"/);
    const hiddenNote = koOf("pages.portfolioView.hiddenNote");
    expect(hiddenNote).toContain("권한이 없어 제외되었습니다");
    expect(hiddenNote).toContain("실제보다 작을 수 있습니다");
    const emptyPartialNote = koOf("pages.portfolioView.emptyPartialNote");
    expect(emptyPartialNote).toContain("중복 여부를 판단할 수 없었습니다");
    expect(emptyPartialNote).toContain("중복 후보가 없다는 뜻이 아닙니다");
    expect(koOf("pages.portfolioView.limitsNote")).toContain("산업 바인딩이 있고 기회에 산업이 지정");
    expect(koOf("pages.portfolioView.naReasonUnresolved")).toBe("산업 정보를 확인하지 못함");
    expect(src).not.toMatch(/tabIndex/);
  });

  test("member links reuse the deals-board targets via the payload href", () => {
    expect(src).toMatch(/href=\{m\.href\}/);
    expect(src).toMatch(/dealStageHref/);
    expect(src).not.toMatch(/\/opportunities\?opportunity=/);
    expect(src).toMatch(/\/projects\/\$\{p\.id\}\/process/);
  });

  test("accessibility: heading hierarchy and region labeling", () => {
    expect(src).toMatch(/<h1>/);
    expect(src).toMatch(/<h2 /);
    expect(src).toMatch(/<h3 /);
    expect(src).toMatch(/aria-label=\{t\("sectionAria"\)\}/);
    expect(src).toMatch(/aria-label=\{t\("precisionAria",/);
    expect(koOf("pages.portfolioView.sectionAria")).toBe("중복 감지");
    expect(koOf("pages.portfolioView.precisionAria")).toBe("정밀도: {label}");
  });

  test("tokens only — no hardcoded colors", () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rgb\(/);
  });
});
