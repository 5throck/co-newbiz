// Wave U-1 inbox read model: pure merge + parallel load with partial failure.
// The module has no write path — every item only links to an existing control.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInbox, loadInbox, type ProposalSrc } from "../../app/web-next/lib/inbox.ts";

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
