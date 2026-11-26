// Pure view helpers for the S8 background-generation progress block.
import { describe, expect, test } from "bun:test";
import {
  elapsedText,
  isRunInProgress,
  parseActivityId,
  parseGenerationRun,
} from "../../app/web-next/lib/business-case-generation-view.ts";

describe("parseGenerationRun", () => {
  test("null for a missing run and for malformed payloads", () => {
    expect(parseGenerationRun(null)).toBeNull();
    expect(parseGenerationRun({})).toBeNull();
    expect(parseGenerationRun({ runId: "r1" })).toBeNull();
  });

  test("counts activities itself and tolerates unknown statuses", () => {
    const run = parseGenerationRun({
      runId: "r1",
      status: "running",
      started_at: "2026-11-26T00:00:00.000Z",
      finished_at: null,
      activities: [
        { activityId: "base:market_forward:growth_projection", agentKey: "a", status: "done" },
        { activityId: "base:market_forward:valuation_model", agentKey: "b", status: "running", started_at: "x" },
        { activityId: "base:market_forward:distributional_valuation", agentKey: "c", status: "weird" },
        { agentKey: "no-id" },
      ],
    });
    expect(run?.progress).toEqual({ total: 3, done: 1, running: 1, failed: 0 });
    expect(run?.activities[2]?.status).toBe("waiting");
    expect(isRunInProgress(run)).toBe(true);
  });
});

describe("parseActivityId", () => {
  test("greenfield and per-target ids", () => {
    expect(parseActivityId("base:market_forward:growth_projection")).toEqual({
      targetId: null,
      scenario: "base",
      variant: "market_forward",
      step: "growth_projection",
    });
    expect(parseActivityId("01TARGET/downside:historical:scenario_risk_assessment")).toEqual({
      targetId: "01TARGET",
      scenario: "downside",
      variant: "historical",
      step: "scenario_risk_assessment",
    });
    expect(parseActivityId("not-an-activity")).toBeNull();
  });
});

describe("elapsedText", () => {
  const now = Date.parse("2026-11-26T00:02:05.000Z");
  test("running activities tick against now; finished ones are fixed; unstarted are blank", () => {
    expect(elapsedText({ started_at: "2026-11-26T00:00:00.000Z", finished_at: null }, now)).toBe("2:05");
    expect(elapsedText({ started_at: "2026-11-26T00:00:00.000Z", finished_at: "2026-11-26T00:00:07.000Z" }, now)).toBe(
      "0:07",
    );
    expect(elapsedText({ started_at: null, finished_at: null }, now)).toBe("");
  });
});
