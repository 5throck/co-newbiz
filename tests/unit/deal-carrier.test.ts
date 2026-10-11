import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveDealCarrier, type CarrierGet } from "../../app/web-next/lib/deal-carrier.ts";

const mk = (routes: Record<string, unknown>): { get: CarrierGet; calls: string[] } => {
  const calls: string[] = [];
  const get: CarrierGet = async (u) => {
    calls.push(u);
    if (u in routes) return { data: routes[u] as never };
    throw new Error("404");
  };
  return { get, calls };
};

describe("resolveDealCarrier", () => {
  test("opportunity id passes through without a project probe", async () => {
    const { get, calls } = mk({ "/api/opportunities/O1/process": { x: 1 } });
    const r = await resolveDealCarrier(get, "O1");
    expect(r.opportunityId).toBe("O1");
    expect(calls).toEqual(["/api/opportunities/O1/process"]);
  });
  test("project id resolves to its source opportunity", async () => {
    const { get } = mk({ "/api/projects/P1/process": { opportunity: { id: "O9" } } });
    expect((await resolveDealCarrier(get, "P1")).opportunityId).toBe("O9");
  });
  test("project without source yields null", async () => {
    const { get } = mk({ "/api/projects/P2/process": { opportunity: null } });
    expect((await resolveDealCarrier(get, "P2")).opportunityId).toBeNull();
  });
  test("unknown id rejects", async () => {
    await expect(resolveDealCarrier(mk({}).get, "Z")).rejects.toThrow();
  });
});

describe("carrier resolution wiring", () => {
  const read = (p: string) => readFileSync(`./app/web-next/${p}`, "utf8");
  test("overview page and S3 stage share the resolver", () => {
    expect(read("app/deals/[id]/page.tsx")).toContain("resolveDealCarrier");
    expect(read("components/stages/use-deal-opportunity-id.ts")).toContain("resolveDealCarrier");
    const stage = read("app/deals/[id]/[stage]/page.tsx");
    expect(stage).toContain("useDealOpportunityId(routeId)");
    expect(stage).toContain("noSourceOpportunity={st.opportunityId === null}");
    expect(stage).not.toContain("<SynergyStage opportunityId={params.id}");
  });
});
