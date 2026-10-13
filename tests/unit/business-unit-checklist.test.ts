// @version 1.0.0
/**
 * ADR-0167 slice 2 — business-unit formation checklist, mode tags, mode-based S9
 * attach and the IC "no liability isolation" standing risk, against the real
 * checklist files, the real route handler and a scratch SQLite.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const ROOT = join(import.meta.dir, "..", "..");
const TEST_DB_PATH = "db/data/test-business-unit-checklist.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const gf = await import("../../app/web-next/lib/greenfield-subtrack.ts");
const { subTrackChecklistIds } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
const { getChecklistItems } = await import("../../app/web-next/lib/library.ts");
const { icStandingRisks, BUSINESS_UNIT_NO_ISOLATION_NOTE } = await import("../../app/web-next/lib/establishment-mode-view.ts");
const { validateApplicabilityTags } = await import("../../checklists/_validate.ts");

interface Item { id: string; text: string; mandatory: boolean; waiver_eligible: boolean; modes?: string[]; origins?: string[]; review_status?: string }
const loadChecklist = (f: string) => parseYaml(readFileSync(join(ROOT, "checklists", f), "utf8")) as { version: string; items: Item[]; legal_basis: string[] };

describe("checklist content and tags", () => {
  const bu = loadChecklist("business-unit-formation-checklist.yaml");
  const ef = loadChecklist("entity-formation-checklist.yaml");

  test("bu-01..bu-09 exist, are business_unit only, draft-AI, and the human confirmation is not waivable", () => {
    expect(bu.items.map((i) => i.id)).toEqual(["bu-01", "bu-02", "bu-03", "bu-04", "bu-05", "bu-06", "bu-07", "bu-08", "bu-09"]);
    for (const i of bu.items) {
      expect(i.modes).toEqual(["business_unit"]);
      expect(i.review_status ?? "draft-AI").toBe("draft-AI");
    }
    expect(bu.items.find((i) => i.id === "bu-09")).toMatchObject({ mandatory: true, waiver_eligible: false });
  });

  test("unverified statements are marked 확인 필요 and the legal basis cites MST numbers", () => {
    for (const id of ["bu-01", "bu-03", "bu-04", "bu-05", "bu-06", "bu-07"]) {
      expect(bu.items.find((i) => i.id === id)!.text).toContain("확인 필요");
    }
    const basis = bu.legal_basis.join("\n");
    for (const mst of ["273629", "276117", "283641", "285279"]) expect(basis).toContain(mst);
    expect(basis).toContain("2026-10-14");
  });

  test("ef-01..ef-19 are new_entity only (ef-13..18 also joint-only); gx-01..03 apply to both modes", () => {
    for (const i of ef.items) {
      if (i.id.startsWith("gx-")) {
        expect(i.modes).toEqual(["new_entity", "business_unit"]);
      } else {
        expect(i.modes).toEqual(["new_entity"]);
        const n = Number(i.id.slice(3));
        if (n >= 13 && n <= 18) expect(i.origins).toEqual(["joint"]);
        else expect(i.origins).toBeUndefined();
      }
    }
    expect(ef.items.length).toBe(22);
  });

  test("the validator rejects malformed modes / origins tags", () => {
    const ok = validateApplicabilityTags("x.yaml", { modes: ["new_entity"], origins: ["joint"] }, "t");
    expect(ok).toEqual([]);
    expect(validateApplicabilityTags("x.yaml", { modes: ["bogus"] }, "t").length).toBe(1);
    expect(validateApplicabilityTags("x.yaml", { modes: [] }, "t").length).toBe(1);
    expect(validateApplicabilityTags("x.yaml", { origins: ["external"] }, "t").length).toBe(1);
    expect(validateApplicabilityTags("x.yaml", { modes: ["new_entity", "new_entity"] }, "t").length).toBe(1);
  });

  test("the library projection lists the new checklist with its modes", () => {
    const items = getChecklistItems("chk-business-unit-formation-checklist")!;
    expect(items.length).toBe(9);
    expect(items[0].modes).toEqual(["business_unit"]);
    expect(getChecklistItems("chk-entity-formation-checklist")!.find((i) => i.id === "gx-01")!.modes).toEqual(["new_entity", "business_unit"]);
  });
});

describe("mode-based S9 attach", () => {
  const NEW = "2026-10-20T00:00:00.000Z";
  function seed(mode: string | null): string {
    const opp = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `bu ${ulid()}`, "t", "selected", "root", NEW]);
    db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, "greenfield", "intra_venture", "t", "root", NEW]);
    const id = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, origin, track) VALUES (?,?,?,?,?,?)", [id, `BU-${id.slice(-8)}`, NEW, opp, "internal", "greenfield"]);
    if (mode) db.run("UPDATE md_project SET establishment_mode = ? WHERE id = ?", [mode, id]);
    return id;
  }

  test("extraChecklistsForMode swaps only the entity-formation checklist for business_unit", () => {
    expect(gf.extraChecklistsForMode("intra_venture", "business_unit")).toEqual(["chk-rbd-technology-checklist", "chk-business-unit-formation-checklist"]);
    for (const m of ["new_entity", null, "unknown"]) {
      expect(gf.extraChecklistsForMode("intra_venture", m)).toEqual(["chk-rbd-technology-checklist", "chk-entity-formation-checklist"]);
    }
    expect(gf.extraChecklistsForMode("existing_business_rbd", "business_unit")).toEqual(["chk-rbd-technology-checklist"]);
  });

  test("a business_unit project attaches bu-01/04/05; new_entity and legacy keep ef-01/03/07", () => {
    const bu = seed("business_unit");
    expect(subTrackChecklistIds(bu)).toEqual(["chk-rbd-technology-checklist", "chk-business-unit-formation-checklist"]);
    expect(gf.scopedChecklistItems("chk-business-unit-formation-checklist")!.map((i) => i.id)).toEqual(["bu-01", "bu-04", "bu-05"]);
    expect(gf.greenfieldSelection(bu, db)!.na_reason_checklists).toContain("chk-business-unit-formation-checklist");
    for (const m of ["new_entity", null]) {
      const p = seed(m);
      expect(subTrackChecklistIds(p)).toEqual(["chk-rbd-technology-checklist", "chk-entity-formation-checklist"]);
    }
  });
});

describe("IC standing risk", () => {
  test("icStandingRisks: business_unit carries no_liability_isolation, others nothing", () => {
    expect(icStandingRisks("business_unit")).toEqual([{ key: "no_liability_isolation", text: BUSINESS_UNIT_NO_ISOLATION_NOTE }]);
    expect(icStandingRisks("new_entity")).toEqual([]);
    expect(icStandingRisks(null)).toEqual([]);
  });

  test("the ic-package route returns the standing risk for a business_unit project and never blocks", async () => {
    const NOW = new Date().toISOString();
    await createUser(db, { userId: "bu_analyst", role: "analyst", password: "pw-bu-analyst-1", createdBy: "test", now: NOW });
    approveUser(db, { userId: "bu_analyst", approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "bu_analyst", password: "pw-bu-analyst-1" }) });
    const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    const read = async (mode: string) => {
      const opp = ulid();
      db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `ic ${ulid()}`, "t", "selected", "bu_analyst", NOW]);
      const id = ulid();
      db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, origin, track, establishment_mode) VALUES (?,?,?,?,?,?,?)", [id, `IC-${id.slice(-8)}`, NOW, opp, "internal", "greenfield", mode]);
      db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, "bu_analyst", "member", "root", NOW, "author"]);
      const res = await nextRequest(`/api/projects/${id}/ic-package`, { headers: { cookie } });
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: { standing_risks: Array<{ key: string }>; gates: { go_gaps: string[] } } }).data;
    };
    const bu = await read("business_unit");
    expect(bu.standing_risks.map((r) => r.key)).toEqual(["no_liability_isolation"]);
    const ne = await read("new_entity");
    expect(ne.standing_risks).toEqual([]);
    // informational: the standing risk is not a go-gap
    expect(bu.gates.go_gaps.join(" ")).not.toContain("책임 격리");
  });
});
