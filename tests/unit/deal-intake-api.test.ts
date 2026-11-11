// @version 1.0.0
/**
 * Deal-board client-request intake — backend Row 1 (ADR-0197, migration 0190;
 * design 2026-11-11-owner-decisions-intake-batch §3.4 + §3.8).
 *
 * POST /api/deal-intake (create + intake_created audit, analyst+ gate, closed
 * source vocabulary), the optional intake_id backfill on POST
 * /api/opportunities (link + intake_linked audit; already-linked / unknown /
 * >30-day-stale refusals audited intake_link_refused while the opportunity
 * creation itself proceeds), and the detail GET's LEFT-JOIN intake payload —
 * all against the real Route Handlers via nextRequest() on a scratch SQLite
 * file. Migration 0190 must apply cleanly for this suite to even seed.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.CO_NEWBIZ_LLM_PROVIDER = "none"; // never call a real LLM from a unit test

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-deal-intake.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const intakeRepo = await import("../../db/repositories/deal-intake.repository.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  const seed: [string, "admin" | "analyst" | "viewer", string][] = [
    ["di-analyst", "analyst", "pw-di-ana-12345"],
    ["di-viewer", "viewer", "pw-di-view-123"],
    ["di-admin", "admin", "pw-di-admin-123"],
  ];
  for (const [userId, role, password] of seed) {
    await createUser(db, { userId, role, password, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("di-analyst", "pw-di-ana-12345");
  viewerCookie = await loginCookie("di-viewer", "pw-di-view-123");
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

async function registerOpportunity(cookie: string, name: string, intakeId?: string) {
  return req("/api/opportunities", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ name, intake_id: intakeId }),
  });
}
const auditTargets = (action: string) =>
  (db.query("SELECT target FROM audit_log WHERE action = ?").all(action) as { target: string }[]).map((r) => r.target);

describe("POST /api/deal-intake", () => {
  test("migration 0190 applied — deal_intake has the ADR-0197 column order", () => {
    const cols = (db.query("PRAGMA table_info(deal_intake)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "opportunity_id", "source", "requested_by", "note", "created_by", "created_at"]);
  });

  test("unauthenticated POST is 401", async () => {
    const res = await req("/api/deal-intake", { method: "POST", body: JSON.stringify({ source: "board_new_deal" }) });
    expect(res.status).toBe(401);
  });

  test("viewer POST is 403 (server gate is defense-in-depth)", async () => {
    const res = await req("/api/deal-intake", {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ source: "board_new_deal" }),
    });
    expect(res.status).toBe(403);
  });

  test("analyst POST creates the row and audits intake_created", async () => {
    const res = await req("/api/deal-intake", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ source: "board_new_deal", requested_by: "  김후원  ", note: " 시장 진입 검토 요청 " }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data as { id: string };
    const row = db
      .query("SELECT opportunity_id, source, requested_by, note, created_by, created_at FROM deal_intake WHERE id = ?")
      .get(id) as {
      opportunity_id: string | null;
      source: string;
      requested_by: string | null;
      note: string | null;
      created_by: string;
      created_at: string;
    };
    expect(row.opportunity_id).toBeNull(); // created unlinked — the deal does not exist yet
    expect(row.source).toBe("board_new_deal");
    expect(row.requested_by).toBe("김후원"); // trimmed
    expect(row.note).toBe("시장 진입 검토 요청");
    expect(row.created_by).toBe("di-analyst"); // session actor, never a body identity
    expect(auditTargets("intake_created")).toContain(`${id}:board_new_deal`);
  });

  test("unknown source is a typed 400 before INSERT", async () => {
    const res = await req("/api/deal-intake", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ source: "email" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
    const count = db.query("SELECT COUNT(*) AS n FROM deal_intake WHERE source = 'email'").get() as { n: number };
    expect(count.n).toBe(0);
  });

  test("both board sources are accepted (closed vocabulary)", async () => {
    for (const source of ["board_new_deal", "board_known_target"]) {
      const res = await req("/api/deal-intake", {
        method: "POST",
        headers: { cookie: analystCookie },
        body: JSON.stringify({ source }),
      });
      expect(res.status).toBe(201);
    }
  });
});

describe("intake_id backfill at POST /api/opportunities", () => {
  test("a fresh intake links, audits intake_linked, and the detail GET returns it", async () => {
    const created = await req("/api/deal-intake", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ source: "board_known_target", requested_by: "후원사 A" }),
    });
    const intakeId = ((await created.json()).data as { id: string }).id;

    const res = await registerOpportunity(analystCookie, "후원사 A 정수처리 설비 검토", intakeId);
    expect(res.status).toBe(201);
    const oppId = ((await res.json()).data as { id: string }).id;

    const linked = db.query("SELECT opportunity_id FROM deal_intake WHERE id = ?").get(intakeId) as {
      opportunity_id: string;
    };
    expect(linked.opportunity_id).toBe(oppId);
    expect(auditTargets("intake_linked")).toContain(`${intakeId} -> ${oppId}`);

    const detail = await req(`/api/opportunities/${oppId}`, { headers: { cookie: analystCookie } });
    expect(detail.status).toBe(200);
    const payload = (await detail.json()).data as { intake: Record<string, string> | null };
    expect(payload.intake).not.toBeNull();
    expect(payload.intake?.id).toBe(intakeId);
    expect(payload.intake?.source).toBe("board_known_target");
    expect(payload.intake?.requested_by).toBe("후원사 A");
    expect(payload.intake?.created_by).toBe("di-analyst");
  });

  test("detail GET returns intake null for a deal without an intake (no fabrication)", async () => {
    const res = await registerOpportunity(analystCookie, "인테이크 없는 검토");
    expect(res.status).toBe(201);
    const oppId = ((await res.json()).data as { id: string }).id;
    const detail = await req(`/api/opportunities/${oppId}`, { headers: { cookie: analystCookie } });
    const payload = (await detail.json()).data as { intake: unknown };
    expect(payload.intake).toBeNull();
  });

  test("an already-linked intake refuses 409, audits intake_link_refused, opportunity still created", async () => {
    const created = await req("/api/deal-intake", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ source: "board_new_deal" }),
    });
    const intakeId = ((await created.json()).data as { id: string }).id;
    const first = await registerOpportunity(analystCookie, "첫 딜", intakeId);
    expect(first.status).toBe(201);
    const second = await registerOpportunity(analystCookie, "두 번째 딜 (같은 인테이크 재사용)", intakeId);
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("intake_not_linkable");
    expect(body.error.details.reason).toBe("already_linked");
    expect(body.error.details.opportunity_id).toBeTruthy(); // the deal was still created
    expect(auditTargets("intake_link_refused")).toContain("already_linked");
    // The opportunity is reachable and unlinked — proceeding is the ruling.
    const detail = await req(`/api/opportunities/${body.error.details.opportunity_id as string}`, {
      headers: { cookie: analystCookie },
    });
    expect(((await detail.json()).data as { intake: unknown }).intake).toBeNull();
  });

  test("an unknown intake id refuses 409 with reason not_found, opportunity still created", async () => {
    const res = await registerOpportunity(analystCookie, "유령 인테이크 딜", "01GHOSTGHOSTGHOSTGHOSTGHOST");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.details.reason).toBe("not_found");
    expect(auditTargets("intake_link_refused")).toContain("not_found");
    const detail = await req(`/api/opportunities/${body.error.details.opportunity_id as string}`, {
      headers: { cookie: analystCookie },
    });
    expect(detail.status).toBe(200);
  });

  test("an intake older than the 30-day window refuses 409 with reason stale", async () => {
    const staleId = intakeRepo.createDealIntake(db, {
      source: "board_new_deal",
      createdBy: "di-analyst",
      now: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    });
    const res = await registerOpportunity(analystCookie, "30일 지난 인테이크 딜", staleId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.details.reason).toBe("stale");
    expect(auditTargets("intake_link_refused")).toContain("stale");
    // Within the window links fine — the boundary is the constant, not the clock.
    const freshId = intakeRepo.createDealIntake(db, {
      source: "board_new_deal",
      createdBy: "di-analyst",
      now: new Date(Date.now() - 29 * 86_400_000).toISOString(),
    });
    const okRes = await registerOpportunity(analystCookie, "29일 인테이크 딜", freshId);
    expect(okRes.status).toBe(201);
  });
});

describe("repository contract (deal-intake.repository.ts)", () => {
  // Real opportunity rows — deal_intake.opportunity_id carries an FK.
  function seedOpportunity(id: string) {
    db.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES (?, ?, 'di-analyst', ?)", [id, id, NOW]);
  }

  test("linkDealIntakeToOpportunity is idempotent and refuses re-linking (IS NULL predicate)", () => {
    seedOpportunity("opp-x");
    seedOpportunity("opp-y");
    const id = intakeRepo.createDealIntake(db, { source: "board_new_deal", createdBy: "di-analyst", now: NOW });
    expect(intakeRepo.linkDealIntakeToOpportunity(db, { intakeId: id, opportunityId: "opp-x" })).toBe(true);
    // Second link is a no-op, not an overwrite.
    expect(intakeRepo.linkDealIntakeToOpportunity(db, { intakeId: id, opportunityId: "opp-y" })).toBe(false);
    expect(getIntake(id).opportunity_id).toBe("opp-x");
    // Linking a non-existent intake is also false.
    expect(intakeRepo.linkDealIntakeToOpportunity(db, { intakeId: "01NOPE", opportunityId: "opp-x" })).toBe(false);
  });

  test("getIntakeByOpportunity returns the linked row, null otherwise", () => {
    seedOpportunity("opp-r");
    const id = intakeRepo.createDealIntake(db, {
      source: "board_known_target",
      note: "n",
      createdBy: "di-analyst",
      now: NOW,
    });
    intakeRepo.linkDealIntakeToOpportunity(db, { intakeId: id, opportunityId: "opp-r" });
    expect(intakeRepo.getIntakeByOpportunity(db, "opp-r")?.id).toBe(id);
    expect(intakeRepo.getIntakeByOpportunity(db, "opp-unlinked")).toBeNull();
    expect(intakeRepo.getIntakeById(db, id)?.source).toBe("board_known_target");
    expect(intakeRepo.getIntakeById(db, "01MISSING")).toBeNull();
  });
});

function getIntake(id: string): { opportunity_id: string | null } {
  return db.query("SELECT opportunity_id FROM deal_intake WHERE id = ?").get(id) as { opportunity_id: string | null };
}
