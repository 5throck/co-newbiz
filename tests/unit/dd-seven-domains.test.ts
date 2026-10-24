// ADR-0148 / design 2026-10-12 section 6B: the S9 workspace renders all seven domains.
// Projects created on/after 2026-10-01 can judge the four added tabs; older projects see
// them read-only and outside the completion count.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../../db/client.ts";
import { seedS1ToS12Demo } from "../../scripts/co-newbiz/seed-s1-s12-demo.ts";
import {
  DD_DOMAINS, DD_DOMAIN_AGENTS, ddCompletionSummary, listDdWorkspace, upsertChecklistState,
} from "../../app/web-next/lib/dd-checklist-tailor.ts";
import { DD_WORKSPACE_CHECKLISTS, getChecklistItems } from "../../app/web-next/lib/library.ts";
import { KO_DATA } from "../../app/web-next/lib/ko-data-values.ts";

// i18n re-pin (T3-6): the seven payload titles live in ko-data-values.ts (§4); display resolves common.ddDomain.*.
const KO_DD_DOMAIN: Record<string, string> = {
  commercial: KO_DATA.ddDomainCommercial, technical: KO_DATA.ddDomainTechnical, legal: KO_DATA.ddDomainLegal,
  financial: KO_DATA.ddDomainFinancial, hr: KO_DATA.ddDomainHr, market: KO_DATA.ddDomainMarket, financing: KO_DATA.ddDomainFinancing,
};

const NEW = ["financial", "hr", "market", "financing"] as const;
let dir: string | null = null;
afterEach(() => {
  resetDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
function demo() {
  dir = mkdtempSync(join(tmpdir(), "co-newbiz-dd7-"));
  const ids = seedS1ToS12Demo(join(dir, "d.sqlite"));
  return { db: getDb(join(dir, "d.sqlite")), ...ids };
}

describe("seven-domain DD workspace", () => {
  test("constants cover all seven domains with labels and agents", () => {
    expect([...DD_DOMAINS]).toEqual(["commercial", "technical", "legal", "financial", "hr", "market", "financing"]);
    for (const d of DD_DOMAINS) {
      expect(KO_DD_DOMAIN[d]).toBeTruthy();
      expect(DD_DOMAIN_AGENTS[d]).toBeTruthy();
    }
    expect(DD_DOMAIN_AGENTS.financial).toBe("financial-analyst");
    expect(DD_DOMAIN_AGENTS.hr).toBe("hr-integration-agent");
    expect(DD_DOMAIN_AGENTS.market).toBe("market-intelligence-agent");
    expect(DD_DOMAIN_AGENTS.financing).toBe("financing-agent");
  });

  test("every tab title is Korean and the seven domains match DD_DOMAIN_LABEL", () => {
    const { projectId } = demo();
    const ws = listDdWorkspace(projectId);
    for (const d of ws.domains.slice(0, 7)) expect(d.title).toBe(KO_DD_DOMAIN[d.domain]!);
    for (const d of ws.domains) expect(d.title).toMatch(/[가-힣]/);
    expect(ws.domains.map((d) => d.title)).not.toContain("Commercial DD");
  });

  test("new project: seven shared tabs, new tabs judgeable and counted", () => {
    const { db, projectId } = demo();
    db.run("UPDATE md_project SET created_at = '2026-10-05T00:00:00.000Z' WHERE id = ?", [projectId]);
    const ws = listDdWorkspace(projectId);
    const ids = ws.domains.map((d) => d.domain);
    expect(ids.slice(0, 7)).toEqual([...DD_DOMAINS]);
    for (const d of ws.domains.filter((x) => (NEW as readonly string[]).includes(x.domain))) {
      expect(d.counted).toBe(true);
      expect(d.counted_reason).toBeUndefined();
      expect(d.items.length).toBeGreaterThan(0);
    }
    const item = getChecklistItems(DD_WORKSPACE_CHECKLISTS.hr!)![0]!;
    db.run("DELETE FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = ? AND item_id = ?", [projectId, DD_WORKSPACE_CHECKLISTS.hr, item.id]);
    const before = ddCompletionSummary(projectId).unassessed;
    expect(before).toBeGreaterThan(0);
    expect(upsertChecklistState(projectId, DD_WORKSPACE_CHECKLISTS.hr!, item.id, "pass", "u1")).not.toBeNull();
    expect(ddCompletionSummary(projectId).unassessed).toBe(before - 1);
  });

  test("project created before 2026-10-01: new tabs judgeable for reference, counts unchanged", () => {
    const { db, projectId } = demo();
    db.run("UPDATE md_project SET created_at = '2026-08-01T00:00:00.000Z' WHERE id = ?", [projectId]);
    const countBefore = ddCompletionSummary(projectId);
    const ws = listDdWorkspace(projectId);
    for (const d of ws.domains) {
      const isNew = (NEW as readonly string[]).includes(d.domain);
      expect(d.counted).toBe(!isNew);
      if (isNew) expect(d.counted_reason).toContain("not counted in S9 completion");
    }
    expect(countBefore.unassessed).toBe(0);
    const item = getChecklistItems(DD_WORKSPACE_CHECKLISTS.market!)![0]!;
    expect(upsertChecklistState(projectId, DD_WORKSPACE_CHECKLISTS.market!, item.id, "fail", "u1")).not.toBeNull();
    const fin = getChecklistItems(DD_WORKSPACE_CHECKLISTS.financial!)!.find((i) => i.mandatory)!;
    expect(upsertChecklistState(projectId, DD_WORKSPACE_CHECKLISTS.financial!, fin.id, "fail", "u1")).not.toBeNull();
    // persisted and listed, but the completion count is byte-identical
    expect(listDdWorkspace(projectId).domains.find((d) => d.domain === "market")!.items.find((i) => i.id === item.id)!.state?.status).toBe("fail");
    expect(ddCompletionSummary(projectId)).toEqual(countBefore);
    // original three stay judgeable
    const c = getChecklistItems(DD_WORKSPACE_CHECKLISTS.commercial!)![0]!;
    expect(upsertChecklistState(projectId, DD_WORKSPACE_CHECKLISTS.commercial!, c.id, "pass", "u1")).not.toBeNull();
  });

  test("brownfield project lists the seven tabs followed by sub-track tabs", () => {
    const { db, projectId } = demo();
    db.run("UPDATE md_project SET created_at = '2026-10-05T00:00:00.000Z' WHERE id = ?", [projectId]);
    const ws = listDdWorkspace(projectId);
    expect(ws.domains.slice(0, 7).map((d) => d.domain)).toEqual([...DD_DOMAINS]);
  });
});

describe("pre-cutoff greenfield in the workspace scope (ADR-0160 addendum 2026-10-12)", () => {
  test("hr is counted (standard + custom rows); the other three newer domains stay reference-only", async () => {
    const gf = await import("../../app/web-next/lib/greenfield-subtrack.ts");
    const { createDdCustomItem, reviewDdCustomItem } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
    const { db, projectId } = demo();
    const opp = (db.query("SELECT source_opportunity_id o FROM md_project WHERE id = ?").get(projectId) as { o: string }).o;
    db.run("UPDATE route_decision SET track = 'greenfield', sub_track = NULL WHERE opportunity_id = ? AND is_current = 1", [opp]);
    db.run("UPDATE md_project SET created_at = '2026-06-01T00:00:00.000Z' WHERE id = ?", [projectId]);
    db.run("UPDATE project_policy_pin SET pinned_at = '2026-06-01T00:00:00.000Z' WHERE project_id = ?", [projectId]);
    db.run("DELETE FROM project_checklist_item_state WHERE project_id = ? AND checklist_id IN (?,?,?,?)", [projectId, ...NEW.map((d) => DD_WORKSPACE_CHECKLISTS[d]!)]);
    // Not in scope yet: byte-identical to the grandfathered path.
    expect(listDdWorkspace(projectId).domains.find((d) => d.domain === "hr")!.counted).toBe(false);
    const hrItem = getChecklistItems(DD_WORKSPACE_CHECKLISTS.hr!)![0]!;
    upsertChecklistState(projectId, DD_WORKSPACE_CHECKLISTS.hr!, hrItem.id, "pending", "u1");
    const mkt = getChecklistItems(DD_WORKSPACE_CHECKLISTS.market!)![0]!;
    upsertChecklistState(projectId, DD_WORKSPACE_CHECKLISTS.market!, mkt.id, "pending", "u1");
    const outOfScope = ddCompletionSummary(projectId);
    expect(outOfScope.judged).toBeUndefined();

    expect(gf.optInWorkspaceScope({ projectId, migrationNote: "opt in", actor: "u1" }, db).ok).toBe(true);
    const ws = listDdWorkspace(projectId);
    for (const d of ws.domains.slice(0, 7)) expect(d.counted).toBe(d.domain === "hr" || !(NEW as readonly string[]).includes(d.domain));
    const c = ddCompletionSummary(projectId);
    // hr pending row counts, market pending row does not.
    expect(c.pending).toBe(outOfScope.pending + 1);
    const it = createDdCustomItem(projectId, { domain: "hr", itemLabel: "New-team hiring plan" });
    reviewDdCustomItem(projectId, it.id, "approved", "u1");
    upsertChecklistState(projectId, "custom:hr", it.id, "fail", "u1");
    expect(ddCompletionSummary(projectId).mandatoryUnmet).toBe(c.mandatoryUnmet + 1);
  });
});

describe("custom DD items on the four ADR-0148 domains (migration 0137)", () => {
  test("hr custom item: create -> approve -> judge on a post-cutoff project", async () => {
    const { createDdCustomItem, reviewDdCustomItem, upsertChecklistState, listDdWorkspace } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
    const { db, projectId } = demo();
    db.run("UPDATE md_project SET created_at = '2026-10-05T00:00:00.000Z' WHERE id = ?", [projectId]);
    const created = createDdCustomItem(projectId, { domain: "hr", itemLabel: "Verify CBA successorship for the plant union" });
    expect(created.status).toBe("proposed");
    expect(reviewDdCustomItem(projectId, created.id, "approved", "u-lead")?.domain).toBe("hr");
    expect(upsertChecklistState(projectId, "custom:hr", created.id, "pass", "u-lead")).not.toBeNull();
    const hr = listDdWorkspace(projectId).domains.find((d) => d.domain === "hr")!;
    expect(hr.custom.map((c) => c.id)).toContain(created.id);
    expect(hr.custom.find((c) => c.id === created.id)?.state?.status).toBe("pass");
  });

  test("pre-cutoff project: new-domain custom items allowed and persisted, not counted", async () => {
    const { createDdCustomItem, reviewDdCustomItem, upsertChecklistState, ddCompletionSummary } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
    const { db, projectId } = demo();
    db.run("UPDATE md_project SET created_at = '2026-09-01T00:00:00.000Z' WHERE id = ?", [projectId]);
    const before = ddCompletionSummary(projectId);
    for (const domain of ["financial", "hr", "market", "financing"] as const) {
      const it = createDdCustomItem(projectId, { domain, itemLabel: "x" });
      expect(reviewDdCustomItem(projectId, it.id, "approved", "u")?.status).toBe("approved");
      expect(upsertChecklistState(projectId, `custom:${domain}`, it.id, "fail", "u")).not.toBeNull();
    }
    expect(ddCompletionSummary(projectId)).toEqual(before);
    // commercial (an original domain) still works for the same project.
    const c = createDdCustomItem(projectId, { domain: "commercial", itemLabel: "Check top-3 customer contracts" });
    expect(reviewDdCustomItem(projectId, c.id, "approved", "u")?.status).toBe("approved");
  });
});
