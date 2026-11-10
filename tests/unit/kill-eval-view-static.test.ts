// @version 1.0.0
/**
 * D6 (B-3) — kill-evaluation chip honesty pins on the gate-aging board
 * (design 2026-11-11-admin-security-and-board-fixes §8 + §11).
 *
 * The chip state must be TEXT-CARRIED (color never the sole carrier) and
 * HONEST (DEC-20261111-02): `unassessed` is amber + explicit text — never a
 * green/pass class — and `null` renders "—", a non-claim. The aggregate
 * state machine itself is covered by kill-eval-aggregate.test.ts; this file
 * pins the rendering contract statically (deal-overview-ui house pattern),
 * including the pipeline route's project-only mapping and the bilingual
 * catalog (all three keys in ko AND en).
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(`./app/web-next/${p}`, "utf8");

const koCatalog = await import("../../app/web-next/locales/ko.json");
const enCatalog = await import("../../app/web-next/locales/en.json");
const catalogOf = (catalog: Record<string, unknown>, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      catalog,
    );

describe("kill-evaluation chip class + label mapping (deals board)", () => {
  const page = read("app/deals/page.tsx");

  test("the three states map to red / gray / amber chips with locale-label keys — text carries the state", () => {
    expect(page).toContain('triggered: "status-red"');
    expect(page).toContain('false: "status-not-started"');
    expect(page).toContain('unassessed: "status-amber"');
    expect(page).toContain('triggered: "pages.deals.killEval.triggered"');
    expect(page).toContain('false: "pages.deals.killEval.evaluatedFalse"');
    expect(page).toContain('unassessed: "pages.deals.killEval.unassessed"');
    expect(page).toContain("KILL_EVAL_CHIP_CLASS[r.killEval]");
    expect(page).toContain("t(KILL_EVAL_LABEL_KEY[r.killEval])");
  });

  test("honesty rule: no green/pass class in the kill-chip vocabulary, and unassessed is never silence", () => {
    // Scope to the two mapping blocks — the page legitimately uses
    // status-green for card tones and track chips elsewhere.
    const chipBlock = page.match(/const KILL_EVAL_CHIP_CLASS[\s\S]*?};/)?.[0] ?? "";
    const labelBlock = page.match(/const KILL_EVAL_LABEL_KEY[\s\S]*?};/)?.[0] ?? "";
    expect(chipBlock).not.toContain("status-green");
    expect(labelBlock).not.toContain("green");
    // Amber is the unassessed tone: attention without a pass verdict.
    expect(chipBlock).toContain('unassessed: "status-amber"');
  });

  test("null renders an explicit dash — a non-claim, not an empty cell", () => {
    // Whitespace-tolerant (the formatter owns indentation): the killEval
    // ternary's false branch must be the dash itself, nothing else.
    expect(page).toMatch(/\) : \(\s*"—"\s*\)/);
  });

  test("the column header carries scope=col and the dedicated locale key", () => {
    expect(page).toContain('<th scope="col">{t("pages.deals.colKillEval")}</th>');
    // Column sits between Decision and Decided-at (design §8).
    expect(page.indexOf('t("pages.deals.colDecision")')).toBeLessThan(page.indexOf('t("pages.deals.colKillEval")'));
    expect(page.indexOf('t("pages.deals.colKillEval")')).toBeLessThan(page.indexOf('t("pages.deals.colDecidedAt")'));
  });
});

describe("pipeline route — killEval is project-scoped", () => {
  test("opportunity-type rows are always null; project rows take the aggregate (MNPI-suppressed → absent → null)", () => {
    const route = read("app/api/portfolio/pipeline/route.ts");
    expect(route).toContain('killEval: r.entityType === "project" ? (killEval.get(r.entityId) ?? null) : null');
    expect(route).toContain("killEvalStates");
  });
});

describe("bilingual catalog — all three keys in ko AND en, plus the extended caption/note", () => {
  const catalogs = [koCatalog, enCatalog];
  const keys = [
    "pages.deals.killEval.triggered",
    "pages.deals.killEval.evaluatedFalse",
    "pages.deals.killEval.unassessed",
    "pages.deals.colKillEval",
  ];

  test("every locale carries every key with non-empty text", () => {
    for (const catalog of catalogs) {
      for (const key of keys) {
        const v = catalogOf(catalog, key);
        expect(typeof v).toBe("string");
        expect(v).not.toBe("");
        expect(v).toBeDefined();
      }
    }
  });

  test("canonical English strings (design §8 vocabulary)", () => {
    expect(catalogOf(enCatalog, "pages.deals.killEval.triggered")).toBe("Kill triggered");
    expect(catalogOf(enCatalog, "pages.deals.killEval.evaluatedFalse")).toBe("Evaluated — none triggered");
    expect(catalogOf(enCatalog, "pages.deals.killEval.unassessed")).toBe("Unassessed");
  });

  test("the unassessed-never-a-pass rule is stated in the aging note (header tooltip text) in both locales", () => {
    // English note spells the rule out; Korean note states it natively (미평가 = unassessed).
    expect(String(catalogOf(enCatalog, "pages.deals.agingNote")).toLowerCase()).toContain("unassessed");
    expect(catalogOf(koCatalog, "pages.deals.agingNote")).toContain("미평가는 통과가 아니며");
    for (const catalog of catalogs) {
      const note = String(catalogOf(catalog, "pages.deals.agingNote"));
      expect(note).toContain("KILL");
      expect(note).toContain("—");
    }
  });

  test("table caption/aria mention the kill-evaluation column", () => {
    for (const catalog of catalogs) {
      expect(String(catalogOf(catalog, "pages.deals.agingTableCaption")).toLowerCase()).toContain("kill");
      expect(String(catalogOf(catalog, "pages.deals.agingTableAria")).toLowerCase()).toContain("kill");
    }
  });
});
