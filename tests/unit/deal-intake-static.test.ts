// @version 1.0.0
/**
 * Deal-intake static wiring pins (ADR-0197; design
 * 2026-11-11-owner-decisions-intake-batch §3.5–§3.8 test 3 + 4).
 *
 * Both board CTAs must route through DealIntakeModal (no bare exemption-path
 * href on the board), the modal must reuse the house focus-trap pattern
 * (useModalFocus — ClosureModal precedent), the origin line must render on
 * the deal overview under data-testid="deal-intake-origin", the intake
 * carrier must survive both stage hops (market nextHref append; funnel
 * register POST attach), and every new visible string must exist in ko AND
 * en (the catalogs land together — ui-label-sweep rule).
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "../../app/web-next");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

const koCatalog = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const enCatalog = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const catalogOf = (catalog: Record<string, unknown>, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      catalog,
    );

describe("board CTA wiring (app/deals/page.tsx)", () => {
  const page = read("app/deals/page.tsx");

  test("no bare exemption-path href — both CTAs open the intake modal", () => {
    // The old direct links are gone; the destinations live only in the
    // modal's DESTINATION_BY_SOURCE map now.
    expect(page).not.toContain('href="/market?new=1"');
    expect(page).not.toContain('href="/opportunities?known_target=1"');
    expect(page).toContain('onClick={() => setIntakeSource("board_new_deal")}');
    expect(page).toContain('onClick={() => setIntakeSource("board_known_target")}');
    expect(page).toContain("<DealIntakeModal");
  });

  test("the modal component is imported from components/DealIntakeModal", () => {
    expect(page).toMatch(
      /import \{ DealIntakeModal, type DealIntakeSource \} from "[./]+\/components\/DealIntakeModal(\.tsx?)?"/,
    );
  });
});

describe("DealIntakeModal accessibility (ClosureModal house pattern)", () => {
  const modal = read("components/DealIntakeModal.tsx");

  test("focus trap + Escape come from useModalFocus", () => {
    expect(modal).toMatch(/import \{ useModalFocus \} from "[./]+\/lib\/use-modal-focus(\.ts)?"/);
    expect(modal).toContain("useModalFocus(onClose)");
    expect(modal).toContain('role="presentation"');
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("aria-labelledby={titleId}");
    expect(modal).toContain('role="alert"');
  });

  test("inputs carry label associations and the source is never asked", () => {
    expect(modal).toMatch(/htmlFor=/);
    // The source derives from the CTA — asking the user to re-state it is
    // friction with zero information gain (design §3.5).
    expect(modal).not.toMatch(/name="source"|등록 경로|entry select/i);
  });

  test("submit rides the original destination plus the intake carrier", () => {
    expect(modal).toContain('"/market?new=1"');
    expect(modal).toContain('"/opportunities?known_target=1"');
    expect(modal).toMatch(/window\.location\.assign\(`\$\{DESTINATION_BY_SOURCE\[source\]\}&intake=/);
    expect(modal).toContain('api.post<{ id: string }>("/api/deal-intake"');
  });
});

describe("carrier ride-through (stages read the intake themselves)", () => {
  test("OpportunityFunnelStage parses ?intake and attaches intake_id to the register POST", () => {
    const stage = read("components/stages/OpportunityFunnelStage.tsx");
    expect(stage).toContain('params.get("intake")');
    expect(stage).toContain("intake_id: intakeId ?? undefined");
  });

  test("MarketAnalysisStage appends the intake carrier to the S1→S2 nextHref", () => {
    const stage = read("components/stages/market/MarketAnalysisStage.tsx");
    expect(stage).toContain('new URLSearchParams(window.location.search).get("intake")');
    expect(stage).toMatch(/intakeId\s*\?\s*`\/opportunities\?intake=/);
  });
});

describe("origin line (app/opportunities/[id]/page.tsx)", () => {
  const page = read("app/opportunities/[id]/page.tsx");

  test("renders deal-intake-origin only from the linked intake row", () => {
    expect(page).toContain('data-testid="deal-intake-origin"');
    expect(page).toContain("opp.intake && (");
    // Source labels resolve through the catalog — no raw literals (i18n sweep rule).
    expect(page).toContain("INTAKE_SOURCE_KEY[opp.intake.source]");
  });

  test("visible strings are catalog keys in ko AND en (catalogs land together)", () => {
    const keys = [
      "pages.deals.intakeModal.title",
      "pages.deals.intakeModal.requester",
      "pages.deals.intakeModal.note",
      "pages.deals.intakeModal.submit",
      "pages.deals.intakeModal.cancel",
      "pages.opportunityDetail.intakeOrigin.caption",
      "pages.opportunityDetail.intakeOrigin.sourceBoardNewDeal",
      "pages.opportunityDetail.intakeOrigin.sourceBoardKnownTarget",
      "pages.connectedApps.noIssueAdmin",
      "admin.users.noIssueAdmin",
    ];
    for (const key of keys) {
      expect(catalogOf(koCatalog, key), `ko missing ${key}`).toBeTruthy();
      expect(catalogOf(enCatalog, key), `en missing ${key}`).toBeTruthy();
    }
    // The ko origin caption is the design's exact shape (검토 기원: … — 요청자 …).
    expect(catalogOf(koCatalog, "pages.opportunityDetail.intakeOrigin.caption")).toContain("검토 기원");
    expect(catalogOf(koCatalog, "pages.opportunityDetail.intakeOrigin.sourceBoardNewDeal")).toBe("딜 보드 — 새 검토");
    expect(catalogOf(koCatalog, "pages.opportunityDetail.intakeOrigin.sourceBoardKnownTarget")).toBe(
      "딜 보드 — 알려진 대상",
    );
  });
});
