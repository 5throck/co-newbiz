// N2 (owner decision 2026-11-17): writes that presuppose a SELECTED opportunity are refused
// server-side with 409 `not_selected` (lib/selected-guard.ts), not left to the UI:
//   - POST /api/opportunities/[id]/route-decision
//   - POST /api/opportunities/[id]/route-recommendation (covered in route-recommendation.test.ts)
//   - PUT  /api/brownfield/[oppId]/targets/[targetId]/eval-state/[criterionId]
//   - POST /api/brownfield/[oppId]/targets/[targetId]/eval-state/accept-rule
//   - POST /api/brownfield/[oppId]/targets/[targetId]/{shortlist,exclude,rerank,screening-draft}
//   - POST /api/brownfield/[oppId]/eval-draft-runs (bulk AI evaluation run)
// A selected opportunity passes the guard (the request reaches body validation / the write).
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-opportunity-selected-guard.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-11-17T00:00:00Z";
let cookie = "";
const ids = { selected: "", assessed: "", tSel: "", tAss: "", cSel: "", cAss: "" };

const ROUTE_BODY = {
  track: "greenfield",
  intent: "integration",
  rationale: "guard test",
  scores: [
    "control_need",
    "capability_criticality",
    "market_uncertainty",
    "integration_capacity",
    "speed_to_capability",
  ].map((criterion) => ({ criterion, score: 1, evidence_note: "n" })),
};

function seedOpp(status: string): { opp: string; target: string; criterion: string } {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    opp,
    `opp ${status}`,
    status,
    "test",
    NOW,
  ]);
  const target = ulid();
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    [target, opp, "Target", "pending", NOW, NOW],
  );
  const criterion = ulid();
  db.run(
    "INSERT INTO brownfield_eval_criterion (id, opportunity_id, category, source, label, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [criterion, opp, "financial", "custom", "crit", "test", NOW],
  );
  return { opp, target, criterion };
}

beforeAll(async () => {
  await createUser(db, {
    userId: "sel-a",
    role: "analyst",
    password: "pw-sel-a-12345678",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: "sel-a", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: "sel-a", password: "pw-sel-a-12345678" }),
  });
  cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  const s = seedOpp("selected");
  const a = seedOpp("assessed");
  Object.assign(ids, {
    selected: s.opp,
    tSel: s.target,
    cSel: s.criterion,
    assessed: a.opp,
    tAss: a.target,
    cAss: a.criterion,
  });
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

async function expectNotSelected(res: Response) {
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error.code).toBe("not_selected");
  expect(body.data).toBeNull();
}

describe("N2 server-side selection guard", () => {
  test("route-decision: 409 not_selected for a non-selected opportunity, passes for selected", async () => {
    await expectNotSelected(
      await nextRequest(`/api/opportunities/${ids.assessed}/route-decision`, {
        method: "POST",
        body: JSON.stringify(ROUTE_BODY),
        headers: { cookie },
      }),
    );
    const ok = await nextRequest(`/api/opportunities/${ids.selected}/route-decision`, {
      method: "POST",
      body: JSON.stringify(ROUTE_BODY),
      headers: { cookie },
    });
    expect(ok.status).not.toBe(409);
  });

  test("eval-state PUT: 409 not_selected, writes nothing; selected opportunity is accepted", async () => {
    const put = (opp: string, t: string, c: string) =>
      nextRequest(`/api/brownfield/${opp}/targets/${t}/eval-state/${c}`, {
        method: "PUT",
        body: JSON.stringify({ status: "pass" }),
        headers: { cookie },
      });
    await expectNotSelected(await put(ids.assessed, ids.tAss, ids.cAss));
    expect(
      (
        db
          .query("SELECT COUNT(*) n FROM brownfield_target_eval_state WHERE brownfield_target_id = ?")
          .get(ids.tAss) as { n: number }
      ).n,
    ).toBe(0);
    const ok = await put(ids.selected, ids.tSel, ids.cSel);
    expect(ok.status).toBe(200);
  });

  test("eval-state accept-rule: 409 not_selected for a non-selected opportunity", async () => {
    await expectNotSelected(
      await nextRequest(`/api/brownfield/${ids.assessed}/targets/${ids.tAss}/eval-state/accept-rule`, {
        method: "POST",
        body: JSON.stringify({ category: "financial" }),
        headers: { cookie },
      }),
    );
  });

  test("unknown target stays 404 (existence is checked before selection)", async () => {
    const res = await nextRequest(`/api/brownfield/${ids.assessed}/targets/UNKNOWN/eval-state/accept-rule`, {
      method: "POST",
      body: JSON.stringify({ category: "financial" }),
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
  test("S6 target writes (shortlist / exclude / rerank / screening-draft) and the bulk AI run: 409 not_selected", async () => {
    db.run("UPDATE brownfield_target SET status = 'shortlisted', rank = 1 WHERE id = ?", [ids.tAss]);
    const post = (path: string, body: unknown = {}) =>
      nextRequest(path, { method: "POST", body: JSON.stringify(body), headers: { cookie } });
    const base = `/api/brownfield/${ids.assessed}/targets/${ids.tAss}`;
    await expectNotSelected(await post(`${base}/shortlist`));
    await expectNotSelected(await post(`${base}/exclude`, { reason: "r" }));
    await expectNotSelected(await post(`${base}/rerank`, { direction: "up" }));
    await expectNotSelected(await post(`${base}/screening-draft`));
    await expectNotSelected(await post(`/api/brownfield/${ids.assessed}/eval-draft-runs`, { category: "both" }));
    // nothing was written
    const row = db.query("SELECT status, rank FROM brownfield_target WHERE id = ?").get(ids.tAss) as {
      status: string;
      rank: number;
    };
    expect(row).toEqual({ status: "shortlisted", rank: 1 });
  });

  test("S6 target writes: unknown target stays 404 before the selection check", async () => {
    for (const leaf of ["shortlist", "exclude", "screening-draft"]) {
      const res = await nextRequest(`/api/brownfield/${ids.assessed}/targets/UNKNOWN/${leaf}`, {
        method: "POST",
        body: JSON.stringify({ reason: "r" }),
        headers: { cookie },
      });
      expect(res.status).toBe(404);
    }
  });
});
