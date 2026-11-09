// @version 1.0.0
/**
 * governance:sync — registry sync, manifest drift gate, missing-metadata
 * findings, review-due computation and the admin routes (admin-only, audited).
 * Uses a scratch SQLite and a temp fixture repo; never the dev/prod DB.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-governance-registry.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { applyGovernanceManifest, computeReviewDue, listGovernanceView } = await import(
  "../../db/lib/governance-registry.ts"
);
const { scanGovernanceDocs, buildManifest, serializeManifest, checkManifestDrift, MANIFEST_REL } = await import(
  "../../scripts/co-newbiz/governance-sync.ts"
);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = "2026-10-29T00:00:00.000Z";
const opts = { actor: "test", via: "cli" as const, now: NOW };

function fixture(version = "1.0.0"): string {
  const root = mkdtempSync(join(tmpdir(), "gov-fixture-"));
  for (const d of [
    "policies/group",
    "procedures/_shared/p-one",
    "procedures/_template",
    "checklists",
    "templates/deliverables",
  ])
    mkdirSync(join(root, d), { recursive: true });
  writeFileSync(
    join(root, "policies/group/pol.md"),
    `---\ngovernance_doc_id: pol-x\ntitle: Pol X\nversion: "${version}"\nenforceability: mandatory\nowner_agent: pgm\neffective_from: "2026-01-31"\nreview_cycle_months: 12\n---\n# Pol X\n`,
  );
  writeFileSync(join(root, "policies/group/pol_ko.md"), `---\ngovernance_doc_id: pol-x\n---\n`);
  writeFileSync(
    join(root, "procedures/_shared/p-one/schema.yaml"),
    `procedure_id: shared-p-one\ntitle: P One\nversion: "2.0.0"\napplicability: conditional\nowner_agent: pgm\n`,
  );
  writeFileSync(join(root, "procedures/_template/schema.yaml"), `procedure_id: TODO\n`);
  writeFileSync(
    join(root, "checklists/c.yaml"),
    `governance_doc_id: chk-c\ntitle: C\nversion: "1.0.0"\nenforceability: mixed\nowner_agent: pgm\neffective_from: 2026-02-01\n`,
  );
  // missing owner + enforceability -> error finding, not registered
  writeFileSync(join(root, "checklists/bad.yaml"), `governance_doc_id: chk-bad\ntitle: Bad\nversion: "1.0.0"\n`);
  writeFileSync(
    join(root, "templates/deliverables/t.md"),
    `---\ngovernance_doc_id: tpl-t\ntitle: T\nversion: "1.0.0"\nenforceability: recommended\nowner_agent: docs-writer\n---\n`,
  );
  return root;
}

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("scan", () => {
  test("coverage, derived enforceability, pairs and templates skipped, findings listed", () => {
    const scan = scanGovernanceDocs(fixture());
    const m = buildManifest(scan);
    expect(m.counts.by_layer).toMatchObject({ policy: 1, procedure: 1, checklist: 1, template: 1, guideline: 0 });
    expect(scan.docs.find((d) => d.key === "shared-p-one")?.enforceability).toBe("mixed");
    expect(scan.docs.find((d) => d.key === "chk-c")?.effective_from).toBe("2026-02-01");
    const bad = scan.findings.find((f) => f.path === "checklists/bad.yaml");
    expect(bad?.severity).toBe("error");
    expect(bad?.missing).toEqual(["enforceability", "owner_agent"]);
    expect(scan.docs.some((d) => d.key === "chk-bad")).toBe(false);
    // missing effective date is a warning, never invented
    expect(scan.findings.find((f) => f.path.endsWith("p-one/schema.yaml"))?.missing).toContain("effective_from");
    expect(scan.docs.find((d) => d.key === "shared-p-one")?.effective_from).toBeNull();
  });
});

describe("sync", () => {
  test("insert, idempotent, supersede on version change, never deletes", () => {
    const seeded = (db.query("SELECT COUNT(*) AS n FROM governance_doc").get() as { n: number }).n;
    expect(seeded).toBeGreaterThanOrEqual(4);
    const m1 = buildManifest(scanGovernanceDocs(fixture("1.0.0")));
    const dry = applyGovernanceManifest(db, m1, { ...opts, dryRun: true });
    expect(dry.inserted).toBe(4);
    expect((db.query("SELECT COUNT(*) AS n FROM governance_doc").get() as { n: number }).n).toBe(seeded);

    const r1 = applyGovernanceManifest(db, m1, opts);
    expect([r1.inserted, r1.superseded, r1.unchanged]).toEqual([4, 0, 0]);
    const r2 = applyGovernanceManifest(db, m1, opts);
    expect([r2.inserted, r2.superseded, r2.updated, r2.unchanged]).toEqual([0, 0, 0, 4]);

    const m2 = buildManifest(scanGovernanceDocs(fixture("1.1.0")));
    const r3 = applyGovernanceManifest(db, m2, opts);
    expect([r3.inserted, r3.superseded, r3.unchanged]).toEqual([0, 1, 3]);
    const rows = db
      .query("SELECT id, version, superseded_by FROM governance_doc WHERE key = 'pol-x' ORDER BY version")
      .all() as Array<{ id: string; version: string; superseded_by: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("pol-x");
    expect(rows[0].superseded_by).toBe(rows[1].id);
    expect(rows[1].superseded_by).toBeNull();

    // doc removed from repo: kept, reported as orphan; seeded decision records untouched
    const empty = buildManifest({ docs: m2.docs.filter((d) => d.key !== "chk-c"), findings: [] });
    const r4 = applyGovernanceManifest(db, empty, opts);
    expect(r4.orphans.map((o) => o.key)).toContain("chk-c");
    expect((db.query("SELECT COUNT(*) AS n FROM governance_doc").get() as { n: number }).n).toBe(seeded + 5);
    expect(db.query("SELECT 1 FROM governance_doc WHERE id = 'gd-0022-market-thresholds'").get()).not.toBeNull();
  });

  test("every non-dry run is audited, dry run is not", () => {
    const n = () =>
      (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'governance_sync'").get() as { n: number }).n;
    const before = n();
    applyGovernanceManifest(db, buildManifest({ docs: [], findings: [] }), { ...opts, dryRun: true });
    expect(n()).toBe(before);
    applyGovernanceManifest(db, buildManifest({ docs: [], findings: [] }), opts);
    expect(n()).toBe(before + 1);
  });
});

describe("manifest drift", () => {
  test("current manifest passes; stale or missing fails", () => {
    const root = fixture();
    mkdirSync(join(root, "docs/governance"), { recursive: true });
    expect(checkManifestDrift(root).drift).toBe(true); // missing
    writeFileSync(join(root, MANIFEST_REL), serializeManifest(buildManifest(scanGovernanceDocs(root))));
    expect(checkManifestDrift(root).drift).toBe(false);
    writeFileSync(
      join(root, "templates/deliverables/t.md"),
      `---\ngovernance_doc_id: tpl-t\ntitle: T\nversion: "2.0.0"\nenforceability: recommended\nowner_agent: docs-writer\n---\n`,
    );
    const r = checkManifestDrift(root);
    expect(r.drift).toBe(true);
    expect(r.message).toContain("template/tpl-t");
  });
  test("the repo's committed manifest is current", () => {
    expect(checkManifestDrift().drift).toBe(false);
  });
});

describe("review due", () => {
  test("next review = effective_from + cycle; overdue / due soon / ok / none", () => {
    const d = (eff: string | null, cyc: number | null, sup: string | null = null) =>
      computeReviewDue({ effective_from: eff, review_cycle_months: cyc, superseded_by: sup }, "2026-10-29");
    expect(d("2025-10-01", 12)).toEqual({ next_review: "2026-10-01", status: "overdue", days_left: -28 });
    expect(d("2025-11-15", 12).status).toBe("due_soon");
    expect(d("2026-01-31", 12).status).toBe("ok");
    expect(d("2026-01-31", 1).next_review).toBe("2026-02-28"); // month-end clamp
    expect(d(null, 12).status).toBe("none");
    expect(d("2026-01-01", null).status).toBe("none");
    expect(d("2025-01-01", 6, "x").status).toBe("none");
    expect(d("", 12).status).toBe("none");
  });
});

describe("view and routes", () => {
  let adminCookie = "";
  let analystCookie = "";
  beforeAll(async () => {
    const now = new Date().toISOString();
    await createUser(db, { userId: "gadmin", role: "admin", password: "pw-admin-12345", createdBy: "test", now });
    approveUser(db, { userId: "gadmin", approvedBy: "test", now });
    await createUser(db, { userId: "ganalyst", role: "analyst", password: "pw-analyst-12345", createdBy: "test", now });
    approveUser(db, { userId: "ganalyst", approvedBy: "test", now });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = async (u: string, p: string) =>
      (
        (
          await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: u, password: p }) })
        ).headers.getSetCookie()[0] ?? ""
      ).split(";")[0];
    adminCookie = await login("gadmin", "pw-admin-12345");
    analystCookie = await login("ganalyst", "pw-analyst-12345");
  });

  test("waiver concentration rolls up per document lineage", () => {
    db.run("PRAGMA foreign_keys = OFF");
    const cur = (
      db.query("SELECT id FROM governance_doc WHERE key = 'pol-x' AND superseded_by IS NULL").get() as { id: string }
    ).id;
    const future = new Date(Date.now() + 30 * 86400_000).toISOString();
    for (let i = 0; i < 3; i++) {
      db.run(
        "INSERT INTO waiver (id, project_id, governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [`w${i}`, `p${i}`, i === 0 ? "pol-x" : cur, "§2.1", "r", "a", "pgm", "b", NOW, future, "active", NOW],
      );
    }
    db.run("PRAGMA foreign_keys = ON");
    const rows = listGovernanceView(db, {
      now: new Date().toISOString(),
      libraryIndex: new Map([["policies/group/pol.md", "lib-pol"]]),
    });
    const current = rows.find((r) => r.id === cur);
    if (!current) throw new Error(`governance row ${cur} missing`);
    expect(current.active_waivers).toBe(3);
    expect(current.waiver_concentrated).toBe(true);
    expect(current.waiver_clauses[0]).toEqual({ clause_ref: "§2.1", count: 3 });
    expect(current.library_id).toBe("lib-pol");
    const superseded = rows.find((r) => r.id === "pol-x");
    if (!superseded) throw new Error("superseded pol-x row missing");
    expect(superseded.active_waivers).toBe(0); // superseded row carries none
  });

  test("routes are admin-only", async () => {
    expect((await nextRequest("/api/admin/governance")).status).toBe(401);
    expect((await nextRequest("/api/admin/governance", { headers: { cookie: analystCookie } })).status).toBe(403);
    expect(
      (
        await nextRequest("/api/admin/governance/sync", {
          method: "POST",
          body: "{}",
          headers: { cookie: analystCookie },
        })
      ).status,
    ).toBe(403);
    expect((await nextRequest("/api/admin/governance/sync", { method: "POST", body: "{}" })).status).toBe(401);
  });

  test("admin sync applies the committed manifest and is audited", async () => {
    const before = (
      db
        .query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'governance_sync' AND actor_user_id = 'gadmin'")
        .get() as { n: number }
    ).n;
    const res = await nextRequest("/api/admin/governance/sync", {
      method: "POST",
      body: "{}",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { inserted: number; unchanged: number; findings: unknown[] } };
    expect(body.data.inserted).toBeGreaterThan(40);
    // findings is advisory drift data, not a health signal: the 2026-11-09
    // metadata cleanup (version/enforceability/effective_from) cleared the
    // debt that used to keep this above zero, so a clean manifest may
    // legitimately report none.
    expect(Array.isArray(body.data.findings)).toBe(true);
    const again = (
      (await (
        await nextRequest("/api/admin/governance/sync", {
          method: "POST",
          body: "{}",
          headers: { cookie: adminCookie },
        })
      ).json()) as { data: { inserted: number } }
    ).data;
    expect(again.inserted).toBe(0);
    const after = (
      db
        .query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'governance_sync' AND actor_user_id = 'gadmin'")
        .get() as { n: number }
    ).n;
    expect(after).toBe(before + 2);
    const list = (await (await nextRequest("/api/admin/governance", { headers: { cookie: adminCookie } })).json()) as {
      data: Array<{ key: string; library_id: string | null }>;
    };
    expect(list.data.find((r) => r.key === "chk-hr-dd")?.library_id).toBe("chk-hr-dd-checklist");
  });
});
