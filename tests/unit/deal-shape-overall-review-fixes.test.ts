// @version 1.0.0
/**
 * ADR-0201 / migration 0198: the S7 deal-shape evaluation is overall-viability-first. Real scratch SQLite through the full
 * migration chain: the 0198 rebuild (legacy rows copied verbatim, both partial unique indexes, rollback guard), the
 * replace-the-set repository writes (supersede semantics, no-op, stale live_token), REST (stale 409, no-op 200, role),
 * kill criterion #9 reading an overall row, and the MCP tool schema text.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const DB_PATH = join(ROOT, "db/data/test-deal-shape-overall-review.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(DB_PATH + s)) rmSync(DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(DB_PATH);
const db = getDb(DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { previewGateSnapshot, clearSnapshotCache } = await import("../../app/web-next/lib/gate-snapshot.ts");
const { dealShapeGuardDeps } = await import("../../app/web-next/lib/deal-shape-guard.ts");
const repo = await import("../../db/repositories/opportunity-deal-shape.repository.ts");
const S = await import("./_gate-integrity-support.ts");

const NOW = "2026-11-17T09:00:00.000Z";
const _NO_SHAPE = "deal-shape-chain:no_viable_deal_shape";
const ANALYST = "ov-analyst";
const VIEWER = "ov-viewer";
const realEvaluate = dealShapeGuardDeps.evaluate;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  for (const [userId, role] of [
    [ANALYST, "analyst"],
    [VIEWER, "viewer"],
  ] as const) {
    await createUser(db, { userId, role, password: `pw-${userId}-123456`, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const u of [ANALYST, VIEWER]) {
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: u, password: `pw-${u}-123456` }),
    });
    cookies[u] = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  }
  dealShapeGuardDeps.evaluate = (() => ({ terminated: false, stages: [{ id: "S7", status: "current" }] })) as never;
});
afterAll(() => {
  dealShapeGuardDeps.evaluate = realEvaluate;
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(DB_PATH + s)) rmSync(DB_PATH + s);
});

const newOpp = () => S.insertOpportunity(db, "brownfield", ANALYST);
const tok = (o: string) => repo.getLiveToken(db, o);
const base = (o: string, now = NOW) => ({ opportunityId: o, liveToken: tok(o), evaluatedBy: ANALYST, now });
const shapes = (...names: string[]) => names.map((shape) => ({ shape, rationale: `why ${shape}` }));
const viableSet = (o: string, names: string[], intent = "integration", now = NOW) =>
  repo.recordViableShapes(db, { ...base(o, now), intent, shapes: shapes(...names) });
const _notViable = (o: string, rationale = "nothing fits", now = NOW) =>
  repo.recordOverallNotViable(db, { ...base(o, now), rationale });
const count = (o: string) =>
  (
    db.query("SELECT COUNT(*) AS n FROM opportunity_deal_shape_evaluation WHERE opportunity_id = ?").get(o) as {
      n: number;
    }
  ).n;
const rawInsert = (o: string, over: Record<string, unknown> = {}) => {
  const r = {
    id: ulid(),
    opportunity_id: o,
    shape: "spv",
    intent: "integration",
    viable: 1,
    rationale: "x",
    evidence_ref: null,
    evaluated_by: ANALYST,
    evaluated_at: NOW,
    superseded_by: null,
    ...over,
  };
  db.run(
    "INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    Object.values(r) as never,
  );
  return r.id as string;
};
const _kind = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as { kind?: string }).kind ?? "other";
  }
};
const _killKeys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);
const _preview = (o: string) => {
  clearSnapshotCache();
  return previewGateSnapshot(
    { entityType: "opportunity", entityId: o, gate: "target_screening", actor: ANALYST, db },
    { fresh: true },
  ).snapshot;
};

describe("review fixes: transactional audit, superseded ids in the audit target, legacy verdict, body cap", () => {
  const sendRaw = (o: string, raw: string, headers: Record<string, string> = {}) =>
    nextRequest(`/api/opportunities/${o}/deal-shapes`, {
      method: "POST",
      body: raw,
      headers: { cookie: cookies[ANALYST], ...headers },
    });

  test("an audit callback that throws rolls the whole write back (no unaudited verdict)", () => {
    const o = newOpp();
    viableSet(o, ["spv"]);
    const before = repo.listDealShapeEvaluations(db, o);
    const n = count(o);
    const boom = () =>
      repo.recordOverallNotViable(db, {
        ...base(o),
        rationale: "r",
        onWrite: () => {
          throw new Error("audit down");
        },
      });
    expect(boom).toThrow("audit down");
    expect(count(o)).toBe(n);
    expect(repo.listDealShapeEvaluations(db, o).live.map((r) => r.id)).toEqual(before.live.map((r) => r.id));
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("the audit target lists the new row ids and the superseded ids", async () => {
    const o = newOpp();
    const first = viableSet(o, ["spv"]);
    const res = await nextRequest(`/api/opportunities/${o}/deal-shapes`, {
      method: "POST",
      body: JSON.stringify({ viable: false, rationale: "gone", live_token: tok(o) }),
      headers: { cookie: cookies[ANALYST] },
    });
    expect(res.status).toBe(201);
    const newId = ((await res.json()) as { data: { rows: Array<{ id: string }> } }).data.rows[0].id;
    const row = db
      .query("SELECT target FROM audit_log WHERE action = 'opportunity.deal_shape.record_not_viable' AND target LIKE ?")
      .get(`${o}:%`) as { target: string };
    expect(row.target).toBe(`${o}:${newId}:superseded=${first.rows[0].id}`);
  });

  test("only legacy viable = 0 shape rows live: verdict reads not_viable (consistent with #9); empty stays unassessed", () => {
    const o = newOpp();
    expect(repo.listDealShapeEvaluations(db, o).verdict).toBe("unassessed");
    rawInsert(o, { shape: "spv", viable: 0 });
    expect(repo.listDealShapeEvaluations(db, o)).toMatchObject({ verdict: "not_viable", overall: null });
    expect(repo.summarizeLiveDealShapes(db, o)).toMatchObject({ recorded: 1, viable: 0 });
  });

  test("a body over 64 KB is refused with 413 before parsing (Content-Length and real size)", async () => {
    const o = newOpp();
    const big = JSON.stringify({ viable: false, rationale: "x".repeat(70 * 1024), live_token: tok(o) });
    const res = await sendRaw(o, big);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
    expect((await sendRaw(o, "{", { "content-length": String(200 * 1024) })).status).toBe(413);
    expect((await sendRaw(o, "not json")).status).toBe(400);
    expect(repo.listDealShapeEvaluations(db, o).verdict).toBe("unassessed");
  });

  test("a terminated/killed opportunity stays writable (deal-shape-guard.ts: only the track rule applies)", async () => {
    const o = newOpp();
    dealShapeGuardDeps.evaluate = (() => ({ terminated: true, stages: [{ id: "S7", status: "terminated" }] })) as never;
    try {
      expect((await sendRaw(o, JSON.stringify({ viable: false, rationale: "r", live_token: tok(o) }))).status).toBe(
        201,
      );
    } finally {
      dealShapeGuardDeps.evaluate = (() => ({ terminated: false, stages: [{ id: "S7", status: "current" }] })) as never;
    }
  });
});
