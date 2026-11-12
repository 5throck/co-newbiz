// @version 1.0.0
/**
 * Design 2026-11-11-route-decision-current-authority §9.4 case 1 — the
 * route-level completion test. The §9 sweep already carries lib-level case
 * assertions in route-decision-current-authority.test.ts (charter-track
 * expression, capability lead, gate aging); this suite dispatches the REAL
 * POST /api/opportunities/[id]/promote handler (helpers/next-route-dispatch,
 * entry-market-derivation.test.ts dispatch pattern) so the authority-row read
 * is asserted through the route's own code path:
 *   - the poisoning fixture (an ADR-0124 draft with a fresher decided_at than
 *     the flagged final) — the promotion must see the FINAL's track, not the
 *     draft's, in the charter-track input (buildProjectCharter), the
 *     md_project.track display snapshot (§9.2), and the response;
 *   - the hint guard (§9.2): a greenfield-only establishment hint is accepted
 *     when the authority track is greenfield and 400s mode_not_allowed when
 *     the authority track is brownfield — even when a newer greenfield draft
 *     exists (with the pre-§9.2 convention query, the draft would have been
 *     the one the guard evaluated).
 * Scratch SQLite (classification-write pattern): resetDb() + runMigrations()
 * before dynamic imports; route dispatch through next-route-dispatch with a
 * real analyst login (cookie + synthesized CSRF pair).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-promotion-charter-e2e.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { finalizeRouteDecisionCurrency } = await import("../../db/repositories/route-decision.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = "2026-11-12T00:00:00Z";
const ANALYST = "promo-e2e-analyst";
let cookie = "";
let seq = 0;
const json = JSON.stringify;

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-promo-e2e-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-promo-e2e-1");
});

afterAll(() => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      Bun.sleepSync(50 * (attempt + 1));
    }
  }
});

// Poisoning fixture (§9.2): a flagged final followed by an ADR-0124 draft with
// a fresher decided_at and the OTHER track. Currency is driven through
// finalizeRouteDecisionCurrency exactly like the finalize route does.
function seedPoisoned(finalTrack: "greenfield" | "brownfield", draftTrack: "greenfield" | "brownfield"): string {
  const oppId = `opp-promo-e2e-${++seq}`;
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, market_size_krw_m, growth_rate, capability_gap_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      oppId,
      `promotion-charter-e2e-${seq}`,
      "scope",
      "selected",
      ANALYST,
      NOW,
      80000,
      0.06,
      json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }] }),
    ],
  );
  const finalId = `rd-${oppId}-final`;
  db.run(
    `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, override_flagged, staging_recommended, total_score, gate_evaluation_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,0,NULL,NULL,NULL,'final')`,
    [
      finalId,
      oppId,
      finalTrack,
      null,
      "final rationale",
      "alternatives",
      ANALYST,
      "2026-11-11T09:00:00Z",
      "integration",
    ],
  );
  finalizeRouteDecisionCurrency(oppId, finalId);
  const draftId = `rd-${oppId}-draft`;
  db.run(
    `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'draft',?)`,
    [draftId, oppId, draftTrack, null, null, null, ANALYST, "2026-11-11T10:00:00Z", null, "2026-11-11T10:00:00Z"],
  );
  return oppId;
}

// S4/S5 greenfield facts the promotion preconditions require: track-relevant
// gates GO, and a greenfield_assessment with entry strategy + alternatives.
function seedGreenfieldPromotable(oppId: string): void {
  for (const gate of ["screening", "pre_fs"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", oppId, gate, "go", "e2e fixture", ANALYST, NOW],
    );
  }
  db.run(
    "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, null],
  );
}

const promote = (id: string, body: Record<string, unknown>) =>
  nextRequest(`/api/opportunities/${id}/promote`, { method: "POST", headers: { cookie }, body: json(body) });

const mdProject = (oppId: string) =>
  db.query("SELECT id, track, charter_json FROM md_project WHERE source_opportunity_id = ?").get(oppId) as
    | { id: string; track: string | null; charter_json: string | null }
    | undefined;

describe("§9.4 case 1 route-level — POST /promote sees the authority track, not the draft's", () => {
  test("final greenfield + newer brownfield draft: the charter, the md_project.track snapshot, and the response all carry greenfield", async () => {
    const oppId = seedPoisoned("greenfield", "brownfield");
    seedGreenfieldPromotable(oppId);
    const res = await promote(oppId, { needToKnowBasis: "e2e fixture membership basis" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { project_id: string; track: string | null; source_opportunity_id: string } | null;
      error: { code: string } | null;
    };
    expect(body.error).toBeNull();
    // The route response's track is the promotion-time snapshot — the FINAL's.
    expect(body.data).not.toBeNull();
    const promoted = body.data as { project_id: string; track: string | null; source_opportunity_id: string };
    expect(promoted.track).toBe("greenfield");
    expect(promoted.source_opportunity_id).toBe(oppId);
    // md_project.track (the §9.2 display snapshot) and the charter-track input
    // (buildProjectCharter's track argument, persisted inside charter_json)
    // must both carry the authority row's track; the draft's brownfield must
    // not surface anywhere.
    const project = mdProject(oppId);
    expect(project?.track).toBe("greenfield");
    const charter = JSON.parse(project?.charter_json ?? "{}") as { versions: Array<{ track: string | null }> };
    expect(charter.versions[0]?.track).toBe("greenfield");
    expect(charter.versions[0]?.track).not.toBe("brownfield");
    // The opportunity carrier is consumed by THIS promotion.
    const opp = db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string };
    expect(opp.project_id).toBe(promoted.project_id);
  });

  test("same authority-greenfield fixture: a greenfield-only establishment hint is accepted (positive control for the hint guard)", async () => {
    const oppId = seedPoisoned("greenfield", "brownfield");
    seedGreenfieldPromotable(oppId);
    const res = await promote(oppId, {
      needToKnowBasis: "e2e fixture membership basis",
      establishment_mode_suggested: "new_entity",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { establishment_mode_suggested: string | null } | null };
    expect(body.data?.establishment_mode_suggested).toBe("new_entity");
  });

  test("final brownfield + newer greenfield draft: a greenfield-only hint still 400s mode_not_allowed — the guard evaluated the FINAL, not the draft", async () => {
    const oppId = seedPoisoned("brownfield", "greenfield");
    const res = await promote(oppId, {
      needToKnowBasis: "e2e fixture membership basis",
      establishment_mode_suggested: "new_entity",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data: null; error: { code: string; message: string } };
    // mode_not_allowed is the guard's own rejection — with the pre-§9.2
    // convention query the newer GREENFIELD draft would have passed this
    // guard (track greenfield + origin defaulting internal for greenfield),
    // so this exact request is the discriminator the §9.4 plan pins.
    expect(body.error.code).toBe("mode_not_allowed");
    // Nothing was promoted — the route rejected before the repository call.
    expect(mdProject(oppId)).toBeNull();
  });
});
