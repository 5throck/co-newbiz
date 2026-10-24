// BF_SUB module-graph regression (dev-server incident, 2026-10-24) — the S4
// hook (useRouteDecision.ts) imports GF_SUB/BF_SUB from ./constants.ts. During
// the i18n label sweep the constants module re-exported the pair from
// lib/labels.ts (cf2dd343) before labels.ts dropped the maps (9a19536b
// defined them inline instead); in the mid-migration window the re-export had
// no source, Turbopack reported "BF_SUB export missing" at the first consumer
// (useRouteDecision.ts) and the dev server died at import time.
// A bare import of the whole chain is the cheapest guard: it fails on any
// missing export on either side of the graph, before the dev server ever sees it.
import { describe, expect, test } from "bun:test";
import * as constants from "../../app/web-next/components/stages/route-decision/constants.ts";
import * as hook from "../../app/web-next/components/stages/route-decision/useRouteDecision.ts";

describe("route-decision module graph (BF_SUB incident regression)", () => {
  test("constants.ts exports the sub-track whitelists the hook imports", () => {
    expect(Array.isArray(constants.GF_SUB)).toBe(true);
    expect(constants.GF_SUB.length).toBeGreaterThan(0);
    expect(Array.isArray(constants.BF_SUB)).toBe(true);
    expect(constants.BF_SUB.length).toBeGreaterThan(0);
  });

  test("whitelists match the DB CHECK vocabulary (api routes carry a local copy)", () => {
    // app/api/opportunities/[id]/route-decision/route.ts duplicates both lists
    // as local consts — this pin keeps the constant and the routes in lockstep.
    expect([...constants.GF_SUB].sort()).toEqual(["existing_business_rbd", "intra_venture"]);
    expect([...constants.BF_SUB].sort()).toEqual([
      "corporate_venture",
      "jv",
      "m_and_a",
      "minority_investment",
      "partnership",
      "rbd",
      "strategic_investment",
    ]);
  });

  test("decision-support constants stay intact alongside the whitelists", () => {
    expect(constants.CRITERIA).toHaveLength(5);
    expect(constants.OVERRIDDEN_SUBS).toEqual(["partnership", "rbd", "corporate_venture"]);
  });

  test("useRouteDecision.ts and its full import chain (next-intl, auth-client, api) load", () => {
    expect(typeof hook.useRouteDecision).toBe("function");
  });
});
