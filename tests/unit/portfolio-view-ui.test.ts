/**
 * Source-reading tests for the /portfolio-view rebuild (design
 * 2026-10-11-portfolio-view-overlap §5, Row 2). Pattern of
 * ui-label-sweep.test.ts: assert the page stays wired to the server-side
 * overlap API and keeps the tier/N-A/empty-state contract.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "app", "web-next");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "app/portfolio-view/page.tsx";

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
    expect(src).toMatch(/산업 일치/);
    expect(src).toMatch(/근사 매칭/);
    expect(src).toMatch(/status-chip status-amber/);
    expect(src).toMatch(/status-chip status-unknown/);
    expect(src).toMatch(/문자열이 같은 경우의 근사 매칭/);
  });

  test("proposal-only Group IC framing line per group", () => {
    expect(src).toMatch(/판단은 그룹 투자심의위원회가 합니다/);
    expect(src).toMatch(/제안/);
  });

  test("empty state and N/A explainer present", () => {
    expect(src).toMatch(/중복 노출 후보가 없습니다\./);
    expect(src).toMatch(/산업 미지정/);
    expect(src).toMatch(/임의로 그룹화하지 않습니다/);
    expect(src).toMatch(/S1 산업 지정/);
    expect(src).toMatch(/S8\+ 산업 바인딩/);
  });

  test("hidden-promoted notice, empty-state branches, limits note, new reasons", () => {
    expect(src).toMatch(/hidden_promoted/);
    expect(src).toMatch(/권한이 없어 제외되었습니다/);
    expect(src).toMatch(/실제보다 작을 수 있습니다/);
    expect(src).toMatch(/naTotal > 0 \|\| hiddenCount > 0/);
    expect(src).toMatch(/중복 여부를 판단할 수 없었습니다/);
    expect(src).toMatch(/중복 후보가 없다는 뜻이 아닙니다/);
    expect(src).toMatch(/overlap-limits-note/);
    expect(src).toMatch(/산업 바인딩이 있고 기회에 산업이 지정/);
    expect(src).toMatch(/industry_unresolved: "산업 정보를 확인하지 못함"/);
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
    expect(src).toMatch(/aria-label="중복 감지"/);
    expect(src).toMatch(/aria-label=\{`정밀도: /);
  });

  test("tokens only — no hardcoded colors", () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rgb\(/);
  });
});
