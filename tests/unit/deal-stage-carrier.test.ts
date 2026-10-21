// T-20261022-010 / -018 / -019 wiring contracts — the deal stage page and the
// stage rail resolve the carrier (source opportunity + track) once instead of
// passing raw route ids or hardcoded tracks. Source-reading style, same as the
// deal-carrier wiring test and the ui-label sweep.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(`./app/web-next/${p}`, "utf8");

describe("deal stage carrier wiring (T-20261022-010/-018)", () => {
  const stage = read("app/deals/[id]/[stage]/page.tsx");

  test("S2/S4/S5/S6/S7 bodies receive the resolved source opportunity, not the raw route id", () => {
    expect(stage).toContain("resolveDealCarrier");
    // The per-stage screens must never see a promoted project id.
    expect(stage).not.toContain("OpportunityFunnelStage opportunityId={params.id}");
    expect(stage).not.toContain("RouteDecisionStage opportunityId={params.id}");
    expect(stage).not.toContain("GreenfieldStage opportunityId={params.id}");
    expect(stage).not.toContain("BrownfieldStage opportunityId={params.id}");
    // Every opportunity-scoped branch resolves through the shared body.
    expect(stage.match(/CarrierStageBody routeId=\{params\.id\}/g)?.length).toBe(4);
  });

  test("the track-fixed StageFrame/TrackGate take the carrier's track, not a hardcoded one", () => {
    expect(stage).not.toMatch(/track="greenfield"/);
    expect(stage).not.toMatch(/track="brownfield"/);
    expect(stage).toContain("track={track ?? undefined}");
    expect(stage).toContain("<TrackGate routeId={params.id} track={track}");
  });

  test("S3 and the S8~S12 tab keep their existing resolvers", () => {
    expect(stage).toContain("useDealOpportunityId(routeId)");
    expect(stage).toContain("noSourceOpportunity={st.opportunityId === null}");
  });
});

describe("project rail source-opportunity wiring (T-20261022-019)", () => {
  const frame = read("components/StageFrame.tsx");
  const tabs = read("components/StageTabs.tsx");

  test("StageFrame resolves the source opportunity under /projects for the S1~S7 links", () => {
    expect(frame).toContain("useSourceOpportunity(underProjects ? routeId : undefined)");
    expect(frame).toContain("underProjects ? sourceOppId ?? undefined : routeId");
  });

  test("StageTabs reuses the hoisted hook — one resolution, one cache", () => {
    expect(tabs).toContain("useSourceOpportunity");
    expect(tabs).toMatch(/from "\.\/StageFrame\.tsx"/);
    expect(tabs).not.toContain("sourceOppCache");
  });
});
