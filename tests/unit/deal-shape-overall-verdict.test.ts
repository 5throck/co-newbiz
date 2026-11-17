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
const DB_PATH = join(ROOT, "db/data/test-deal-shape-overall.sqlite");
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
const NO_SHAPE = "deal-shape-chain:no_viable_deal_shape";
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
const notViable = (o: string, rationale = "nothing fits", now = NOW) =>
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
const kind = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as { kind?: string }).kind ?? "other";
  }
};
const killKeys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);
const preview = (o: string) => {
  clearSnapshotCache();
  return previewGateSnapshot(
    { entityType: "opportunity", entityId: o, gate: "target_screening", actor: ANALYST, db },
    { fresh: true },
  ).snapshot;
};

describe("repository: replace-the-set writes (ADR-0201 section 3.2)", () => {
  test("an overall row stores NULL shape and intent; a second live overall row cannot exist", () => {
    const o = newOpp();
    const r = notViable(o);
    expect(r.rows[0]).toMatchObject({ shape: null, intent: null, viable: false, evaluated_by: ANALYST });
    const l = repo.listDealShapeEvaluations(db, o);
    expect(l).toMatchObject({ verdict: "not_viable", live: [] });
    expect(l.overall?.id).toBe(r.rows[0].id);
    expect(() => rawInsert(o, { shape: null, intent: null, viable: 0 })).toThrow();
  });

  test("not viable supersedes every live row, legacy viable = 0 rows included; nothing is deleted", () => {
    const o = newOpp();
    viableSet(o, ["spv", "full_acquisition"]);
    rawInsert(o, { shape: "joint_venture", viable: 0 }); // a legacy not-viable row alongside the viable ones
    expect(repo.listDealShapeEvaluations(db, o).live).toHaveLength(3);
    const n = count(o);
    const r = notViable(o);
    expect(r.superseded).toHaveLength(3);
    const l = repo.listDealShapeEvaluations(db, o);
    expect(l.live).toEqual([]);
    expect(l.history).toHaveLength(3);
    expect(l.history.every((h) => h.superseded_by === r.rows[0].id)).toBe(true);
    expect(count(o)).toBe(n + 1);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("viable supersedes the overall row, unselected shapes and legacy not-viable rows; rows land in canonical shape order under one intent", () => {
    const o = newOpp();
    notViable(o);
    const r = viableSet(o, ["minority_stake", "spv", "full_acquisition"], "capability_access");
    expect(r.rows.map((x) => x.shape)).toEqual(["full_acquisition", "spv", "minority_stake"]);
    expect(r.rows.every((x) => x.viable && x.intent === "capability_access")).toBe(true);
    let l = repo.listDealShapeEvaluations(db, o);
    expect(l).toMatchObject({ verdict: "viable", overall: null });
    expect(l.history).toHaveLength(1); // the overall row

    rawInsert(o, { shape: "joint_venture", viable: 0 }); // a legacy row that is somehow live
    const r2 = viableSet(o, ["spv"]);
    l = repo.listDealShapeEvaluations(db, o);
    expect(l.live.map((x) => x.shape)).toEqual(["spv"]);
    const old = l.history.filter((h) => h.shape === "minority_stake" || h.shape === "joint_venture");
    expect(old).toHaveLength(2);
    expect(old.every((h) => h.superseded_by === r2.rows[0].id)).toBe(true); // unselected shapes point at the first new row
    expect(l.history.find((h) => h.shape === "spv" && h.id === r.rows[1].id)?.superseded_by).toBe(r2.rows[0].id);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("an identical set writes nothing (changed: false); any change in rationale, intent or shapes writes", () => {
    const o = newOpp();
    expect(viableSet(o, ["spv", "joint_venture"]).changed).toBe(true);
    const n = count(o);
    expect(viableSet(o, ["joint_venture", "spv"])).toEqual({ rows: [], superseded: [], changed: false });
    expect(count(o)).toBe(n);
    expect(viableSet(o, ["spv", "joint_venture"], "capability_access").changed).toBe(true);
    expect(viableSet(o, ["spv"], "capability_access").changed).toBe(true);
    expect(notViable(o).changed).toBe(true);
    expect(notViable(o).changed).toBe(false);
    expect(notViable(o, "different reason").changed).toBe(true);
  });

  test("the live set is never overall + shape rows together, whatever the write order", () => {
    const o = newOpp();
    for (const step of [
      () => viableSet(o, ["spv"]),
      () => notViable(o),
      () => viableSet(o, ["majority_stake", "spv"]),
      () => notViable(o, "again"),
      () => viableSet(o, ["license_in"]),
    ]) {
      step();
      const l = repo.listDealShapeEvaluations(db, o);
      expect(Boolean(l.overall) && l.live.length > 0).toBe(false);
    }
  });

  test("a missing, blank or stale live_token is refused as stale with the current token; a fresh one succeeds", () => {
    const o = newOpp();
    viableSet(o, ["spv"]);
    const staleToken = tok(o);
    viableSet(o, ["spv", "joint_venture"]);
    const attempt = (liveToken: unknown) => () =>
      repo.recordOverallNotViable(db, { ...base(o), liveToken, rationale: "r" });
    for (const t of [undefined, "", "nope", staleToken]) expect(kind(attempt(t))).toBe("stale");
    try {
      attempt(staleToken)();
    } catch (e) {
      expect((e as { details: { live_token: string } }).details.live_token).toBe(tok(o));
    }
    expect(repo.listDealShapeEvaluations(db, o).live).toHaveLength(2); // nothing written by a refused call
    expect(kind(attempt(tok(o)))).toBe("ok");
  });

  test("validation: vocabulary, duplicate, empty and oversized sets, intent, rationale, evidence, identity, unknown opportunity", () => {
    const o = newOpp();
    const v = (over: Record<string, unknown>) =>
      kind(() =>
        repo.recordViableShapes(db, { ...base(o), intent: "integration", shapes: shapes("spv"), ...over } as never),
      );
    expect(v({ shapes: shapes("royalty") })).toBe("invalid");
    expect(v({ shapes: shapes("spv", "spv") })).toBe("invalid");
    expect(v({ shapes: [] })).toBe("invalid");
    expect(v({ shapes: undefined })).toBe("invalid");
    expect(v({ shapes: [...repo.DEAL_SHAPES, "spv"].map((shape) => ({ shape, rationale: "r" })) })).toBe("invalid");
    expect(v({ intent: "growth" })).toBe("invalid");
    expect(v({ shapes: [{ shape: "spv", rationale: "  " }] })).toBe("invalid");
    expect(v({ shapes: [{ shape: "spv", rationale: "x".repeat(repo.RATIONALE_MAX + 1) }] })).toBe("invalid");
    expect(v({ shapes: [{ shape: "spv", rationale: "r", evidence_ref: 5 }] })).toBe("invalid");
    expect(v({ evaluatedBy: "" })).toBe("invalid");
    expect(v({ opportunityId: "missing" })).toBe("opportunity_not_found");
    expect(kind(() => repo.recordOverallNotViable(db, { ...base(o), rationale: " " }))).toBe("invalid");
    expect(repo.listDealShapeEvaluations(db, o).live).toEqual([]);
  });
});

describe("kill criterion #9 reads an overall row without a reader change", () => {
  test("empty = null/unassessed; one overall row = recorded 1, viable 0, triggered; N viable shapes = N; legacy all-not-viable still triggers", () => {
    const o = newOpp();
    expect(repo.summarizeLiveDealShapes(db, o)).toBeNull();
    expect(killKeys(preview(o).kill.unassessed)).toContain(NO_SHAPE);

    notViable(o, "nothing fits", "2026-11-17T10:00:00.000Z");
    expect(repo.summarizeLiveDealShapes(db, o)).toEqual({
      recorded: 1,
      viable: 0,
      latestAt: "2026-11-17T10:00:00.000Z",
      overallNotViable: true,
    });
    const snap = preview(o);
    expect(killKeys(snap.kill.triggered)).toContain(NO_SHAPE);
    expect(snap.kill.triggered.find((t) => t.key === NO_SHAPE)).toMatchObject({ action: "mark_conditional" });
    expect(killKeys(snap.kill.unassessed)).not.toContain(NO_SHAPE);

    viableSet(o, ["spv", "joint_venture"]);
    expect(repo.summarizeLiveDealShapes(db, o)).toMatchObject({ recorded: 2, viable: 2, overallNotViable: false });
    const clean = preview(o);
    expect(killKeys(clean.kill.triggered)).not.toContain(NO_SHAPE);
    expect(killKeys(clean.kill.unassessed)).not.toContain(NO_SHAPE);

    const legacy = newOpp();
    rawInsert(legacy, { shape: "spv", viable: 0 });
    expect(repo.summarizeLiveDealShapes(db, legacy)).toMatchObject({ recorded: 1, viable: 0, overallNotViable: false });
    expect(killKeys(preview(legacy).kill.triggered)).toContain(NO_SHAPE);
  });
});

describe("REST /api/opportunities/:id/deal-shapes (overall-first contract)", () => {
  const send = (o: string, body: unknown, as: string = ANALYST) =>
    nextRequest(`/api/opportunities/${o}/deal-shapes`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { cookie: cookies[as] },
    });
  const read = async (o: string) =>
    (
      (await (
        await nextRequest(`/api/opportunities/${o}/deal-shapes`, { headers: { cookie: cookies[ANALYST] } })
      ).json()) as { data: any }
    ).data;

  test("GET reports verdict, overall, live_token, unselected_shapes (+ alias) and viable_count through the lifecycle", async () => {
    const o = newOpp();
    const empty = await read(o);
    expect(empty).toMatchObject({ verdict: "unassessed", overall: null, live: [], viable_count: null });
    expect(empty.unselected_shapes).toEqual(repo.DEAL_SHAPES);
    expect(empty.unevaluated_shapes).toEqual(repo.DEAL_SHAPES);
    expect(empty.live_token).toBe(tok(o));

    const no = await send(o, { viable: false, rationale: "no fit", live_token: empty.live_token });
    expect(no.status).toBe(201);
    const off = await read(o);
    expect(off).toMatchObject({ verdict: "not_viable", viable_count: 0, live: [] });
    expect(off.overall).toMatchObject({ shape: null, intent: null, rationale: "no fit" });

    const yes = await send(o, {
      viable: true,
      intent: "integration",
      shapes: shapes("spv"),
      live_token: off.live_token,
    });
    expect(yes.status).toBe(201);
    const on = await read(o);
    expect(on).toMatchObject({ verdict: "viable", overall: null, viable_count: 1 });
    expect(on.unselected_shapes).not.toContain("spv");
    expect(on.history.map((h: any) => h.shape)).toEqual([null]); // overall rows live in history, both kinds
  });

  test("409 deal_shape_stale carries the current token; the same body replayed is 200 changed:false; session user is the evaluator", async () => {
    const o = newOpp();
    const body = () => ({
      viable: true,
      intent: "integration",
      shapes: shapes("spv"),
      live_token: tok(o),
      evaluated_by: "attacker",
    });
    const first = await send(o, body());
    expect(first.status).toBe(201);
    const stale = await send(o, { ...body(), live_token: "stale-token" });
    expect(stale.status).toBe(409);
    const err = ((await stale.json()) as { error: { code: string; details: { live_token: string } } }).error;
    expect(err).toMatchObject({ code: "deal_shape_stale", details: { live_token: tok(o) } });
    const noToken = await send(o, { viable: false, rationale: "r" });
    expect(noToken.status).toBe(409);
    const same = await send(o, body());
    expect(same.status).toBe(200);
    expect(((await same.json()) as { data: { changed: boolean } }).data.changed).toBe(false);
    expect(repo.listDealShapeEvaluations(db, o).live[0].evaluated_by).toBe(ANALYST);
  });

  test("a viewer cannot record (403); the not-viable audit action is written for an overall verdict", async () => {
    const o = newOpp();
    expect((await send(o, { viable: false, rationale: "r", live_token: tok(o) }, VIEWER)).status).toBe(403);
    expect((await send(o, { viable: false, rationale: "r", live_token: tok(o) })).status).toBe(201);
    const audit = db
      .query("SELECT action FROM audit_log WHERE action = 'opportunity.deal_shape.record_not_viable' AND target LIKE ?")
      .all(`${o}:%`);
    expect(audit).toHaveLength(1);
  });
});

describe("MCP tool schema text (ADR-0011: REST client only)", () => {
  test("record_deal_shape_evaluation documents the union body, live_token and replace-the-set; get documents the token", async () => {
    const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
    const rec = REGISTRY.find((t) => t.name === "record_deal_shape_evaluation")!;
    expect(rec.routes).toEqual(["POST /api/opportunities/{opportunityId}/deal-shapes"]);
    const hint = JSON.stringify(rec);
    for (const needle of [
      "viable: false",
      "viable: true",
      "shapes",
      "live_token",
      "REPLACES",
      "get_deal_shape_evaluations",
      "deal_shape_stale",
    ])
      expect(hint).toContain(needle);
    expect(rec.description).not.toMatch(/Record ONE deal-shape verdict/);
    const get = REGISTRY.find((t) => t.name === "get_deal_shape_evaluations")!;
    expect(get.description).toContain("live_token");
    expect(get.description).toMatch(/not_viable/);
  });
});
