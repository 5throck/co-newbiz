// Wave U-1 inbox read model: pure merge + parallel load with partial failure.
// The module has no write path — every item only links to an existing control.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInbox, gateHoldHref, gateStageTab, loadInbox, type ProposalSrc } from "../../app/web-next/lib/inbox.ts";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const proposal = (over: Partial<ProposalSrc>): ProposalSrc => ({
  id: "p1", kind: "gate_decision", entity_type: "project", entity_id: "d1", stage_id: "S9",
  payload: { gate: "dd", decision: "go" }, rationale: "because", via_client_id: "mcp-x", status: "pending",
  expires_at: "2026-10-15T12:00:00Z", created_at: "2026-10-05T12:00:00Z", ...over,
});

describe("buildInbox", () => {
  test("maps proposals to confirm links and labels the rationale as AI draft only for MCP clients", () => {
    const [a, b] = buildInbox({ proposals: [proposal({}), proposal({ id: "p2", via_client_id: null })] }, NOW);
    expect(a.href).toBe("/proposals/p1/confirm");
    expect(a.kind).toBe("gate_proposal");
    expect(a.gate).toBe("dd");
    expect(a.aiDraft).toBe("because");
    expect(a.ageDays).toBe(3);
    expect(b.aiDraft).toBeUndefined();
  });

  test("ignores non-pending proposals, read notifications and non-hold decisions", () => {
    const items = buildInbox({
      proposals: [proposal({ status: "confirmed" })],
      notifications: [{ id: "n", project_id: null, trigger_type: "x", severity: "info", payload: "{}", sent_at: "2026-10-08T00:00:00Z", read_at: "2026-10-08T01:00:00Z" }],
      pipeline: { projects: [], currentHolds: [{ entityType: "project", entityId: "d1", label: "D", gate: "fs", decision: "kill", decidedAt: "2026-10-01T00:00:00Z", ageDays: 7 }] },
    }, NOW);
    expect(items).toEqual([]);
  });

  test("orders by severity then oldest first; expiring proposals are high", () => {
    const items = buildInbox({
      proposals: [
        proposal({ id: "old", created_at: "2026-10-01T00:00:00Z" }),
        proposal({ id: "soon", created_at: "2026-10-07T00:00:00Z", expires_at: "2026-10-09T00:00:00Z" }),
        proposal({ id: "older", created_at: "2026-09-30T00:00:00Z" }),
      ],
    }, NOW);
    expect(items.map((i) => i.id)).toEqual(["proposal:soon", "proposal:older", "proposal:old"]);
  });

  test("S12 blockers become closure-precondition items linking to the portfolio screen", () => {
    const [c] = buildInbox({ pipeline: { projects: [{ projectId: "d9", projectNo: "N9", projectName: null, currentStage: "S12", blockers: ["transition decision missing"] }], currentHolds: [] } }, NOW);
    expect(c.kind).toBe("closure_precondition");
    expect(c.href).toBe("/projects/d9/portfolio");
  });
});

describe("gate HOLD links", () => {
  const hold = (entityType: "opportunity" | "project", entityId: string, gate: string, track?: string | null) =>
    ({ entityType, entityId, gate, label: "L", decision: "hold", decidedAt: "2026-10-01T00:00:00Z", ageDays: 3, track });
  test("screening HOLD opens the S3 tab where the screening gate form lives", () => {
    const [i] = buildInbox({ pipeline: { projects: [], currentHolds: [hold("opportunity", "o1", "screening")] } }, NOW);
    expect(i.kind).toBe("gate_hold");
    expect(i.href).toBe("/deals/o1/s3");
  });
  test("each gate maps to the stage tab hosting its decision panel", () => {
    expect(gateHoldHref(hold("opportunity", "o1", "pre_fs"))).toBe("/deals/o1/s5");
    expect(gateHoldHref(hold("opportunity", "o1", "target_screening"))).toBe("/deals/o1/s7");
    expect(gateHoldHref(hold("project", "p 1", "fs"))).toBe("/deals/p%201/s8");
    expect(gateHoldHref(hold("project", "p1", "dd"))).toBe("/deals/p1/s9");
    expect(gateHoldHref(hold("project", "p1", "entity_ic"))).toBe("/deals/p1/s11");
    expect(gateHoldHref(hold("project", "p1", "group_ic"))).toBe("/deals/p1/s11");
  });
  test("pre_fs splits by track: brownfield records on the S4 committee tab, greenfield stays on S5", () => {
    // T-20261022-002: S5 is a TrackGate dead end for a brownfield deal and S6 hosts
    // no pre_fs decision panel — the S4 committee panel is that track's surface.
    expect(gateStageTab("pre_fs", "brownfield")).toBe("s4");
    // ?tab=committee lands the reviewer on the committee tab itself — the S4
    // page's default tab is 경쟁 구조, not the decision surface (T-20261022-041).
    expect(gateHoldHref(hold("opportunity", "o-bf", "pre_fs", "brownfield"))).toBe("/deals/o-bf/s4?tab=committee");
    expect(gateHoldHref(hold("project", "p-bf", "pre_fs", "brownfield"))).toBe("/deals/p-bf/s4?tab=committee");
    expect(gateStageTab("pre_fs", "greenfield")).toBe("s5");
    expect(gateHoldHref(hold("opportunity", "o-gf", "pre_fs", "greenfield"))).toBe("/deals/o-gf/s5");
  });
  test("pre_fs HOLD without a known track keeps the historical S5 destination", () => {
    expect(gateHoldHref(hold("opportunity", "o1", "pre_fs", null))).toBe("/deals/o1/s5");
    expect(gateHoldHref(hold("opportunity", "o1", "pre_fs", "zzz_track"))).toBe("/deals/o1/s5");
  });
  test("other gates ignore the track", () => {
    expect(gateHoldHref(hold("opportunity", "o1", "target_screening", "greenfield"))).toBe("/deals/o1/s7");
  });
  test("unknown gate falls back to the previous entity pages", () => {
    expect(gateHoldHref(hold("project", "p1", "zzz"))).toBe("/projects/p1/process");
    expect(gateHoldHref(hold("opportunity", "o1", "zzz"))).toBe("/opportunities/o1");
  });
});

describe("loadInbox", () => {
  test("a failing source degrades to a failed[] row; others still load", async () => {
    const get = async (path: string) => {
      if (path.startsWith("/api/notifications")) throw new Error("boom");
      if (path.startsWith("/api/proposals")) return { data: [proposal({})] as never };
      return { data: { projects: [], currentHolds: [] } as never };
    };
    const r = await loadInbox(get as never, NOW);
    expect(r.items).toHaveLength(1);
    expect(r.failed).toEqual([{ source: "notifications", message: "boom" }]);
  });

  test("module has no write call (read model only — boundary #2)", () => {
    const src = readFileSync(join(import.meta.dirname, "../../app/web-next/lib/inbox.ts"), "utf8");
    expect(src).not.toMatch(/\.(post|put|patch|delete)\s*[<(]/);
    expect(src).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
  });
});
