/**
 * Unit tests for the route-decision current authority row (design
 * 2026-11-11-route-decision-current-authority, ADR-0135):
 * latestRouteDecision — the process engine's track source (TrackGate, stage
 * predicates, gate ladder/snapshot) — reads the is_current=1 권위 행, not the
 * newest decided_at row. An ADR-0124 draft (초안) is not a decision: a draft
 * saved after the final has a fresher decided_at but must never surface here,
 * so the rendered gate and the S5 save guard (greenfield/[oppId] 409
 * not_applicable_track) read the SAME row.
 *
 * Real scratch SQLite (classification-write test pattern, following
 * process-predicate-alignment.test.ts): resetDb() + runMigrations() before
 * dynamic imports, direct INSERTs on the migrated schema. Fixture currency
 * is driven through finalizeRouteDecisionCurrency (the repository helper the
 * finalize route calls) except where the test exercises a non-currency row
 * shape by design (superseded-only final).
 */

import { test, expect, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-route-decision-current-authority.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { latestRouteDecision } = await import("../../app/web-next/lib/process-flow.ts");
const { finalizeRouteDecisionCurrency } = await import("../../db/repositories/route-decision.repository.ts");
const { capabilityRegisterLead } = await import("../../app/web-next/lib/capability-register-lead.ts");
const { listGateAging } = await import("../../app/web-next/lib/gate-aging.ts");

const U1 = "user-route-authority";
let seq = 0;

function seedOpportunity(): string {
  const id = `opp-${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    id,
    `route-authority-${++seq}`,
    "selected",
    U1,
    "2026-11-11T09:00:00Z",
  ]);
  return id;
}

// Mirrors the finalize route's INSERT shape (status='final', no is_current —
// the flag is set by finalizeRouteDecisionCurrency, never by the insert).
function insertFinal(oppId: string, track: string, subTrack: string | null, decidedAt: string): string {
  const id = `rd-${oppId}-f${++seq}`;
  db.run(
    `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, override_flagged, staging_recommended, total_score, gate_evaluation_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,0,NULL,NULL,NULL,'final')`,
    [id, oppId, track, subTrack, "test route rationale", "test alternatives", U1, decidedAt, "integration"],
  );
  return id;
}

// Mirrors the ADR-0124 draft route's INSERT shape: fresh decided_at, no
// is_current column (DEFAULT 0 — drafts can never carry the authority flag).
function insertDraft(oppId: string, track: string, decidedAt: string): string {
  const id = `rd-${oppId}-d${++seq}`;
  db.run(
    `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'draft',?)`,
    [id, oppId, track, null, null, null, U1, decidedAt, null, decidedAt],
  );
  return id;
}

afterAll(() => {
  resetDb();
});

describe("latestRouteDecision reads the ADR-0135 authority row (is_current=1)", () => {
  test("draft newer than the final does not win — the final's track is returned", () => {
    const oppId = seedOpportunity();
    // Final decision (brownfield) becomes the authority row via the same
    // helper the finalize route calls.
    const finalId = insertFinal(oppId, "brownfield", "m_and_a", "2026-11-11T09:00:00Z");
    finalizeRouteDecisionCurrency(oppId, finalId);
    // A draft saved afterwards carries a fresher decided_at and a different
    // track — exactly the poisoning shape behind the S5 409 defect.
    insertDraft(oppId, "greenfield", "2026-11-11T10:00:00Z");

    const row = latestRouteDecision(oppId);
    expect(row).toBeDefined();
    expect(row?.id).toBe(finalId);
    expect(row?.track).toBe("brownfield");
    expect(row?.sub_track).toBe("m_and_a");
  });

  test("only a draft exists — no decision is returned", () => {
    const oppId = seedOpportunity();
    insertDraft(oppId, "greenfield", "2026-11-11T10:00:00Z");

    // bun:sqlite's .get() yields null for no rows; the function's declared
    // return keeps the pre-existing `| undefined` annotation unchanged
    // (design non-goal: signature/return type byte-stable). Every call site
    // is nullish-safe, so the contract is "no decision surfaces" — falsy.
    expect(latestRouteDecision(oppId)).toBeFalsy();
  });

  test("older superseded final loses to the current authority row", () => {
    const oppId = seedOpportunity();
    // First final (greenfield) is superseded when the track is re-decided.
    const supersededId = insertFinal(oppId, "greenfield", "existing_business_rbd", "2026-11-11T09:00:00Z");
    finalizeRouteDecisionCurrency(oppId, supersededId);
    const currentId = insertFinal(oppId, "brownfield", "jv", "2026-11-11T10:00:00Z");
    finalizeRouteDecisionCurrency(oppId, currentId);
    // Prove the fixture exercised the supersede path (not a hand-set flag).
    const superseded = db
      .query("SELECT is_current, superseded_by FROM route_decision WHERE id = ?")
      .get(supersededId) as { is_current: number; superseded_by: string | null };
    expect(superseded.is_current).toBe(0);
    expect(superseded.superseded_by).toBe(currentId);
    // A newer draft must still not flip the read.
    insertDraft(oppId, "greenfield", "2026-11-11T11:00:00Z");

    const row = latestRouteDecision(oppId);
    expect(row?.id).toBe(currentId);
    expect(row?.track).toBe("brownfield");
    expect(row?.sub_track).toBe("jv");
  });

  test("an opportunity whose only final is superseded (no is_current=1 row) returns undefined", () => {
    const oppId = seedOpportunity();
    // Non-currency row shape that finalizeRouteDecisionCurrency cannot
    // produce: a final whose authority flag is cleared with no successor —
    // hand-set on purpose (fixture hygiene rule, design §5 case 3).
    const orphanId = insertFinal(oppId, "brownfield", "m_and_a", "2026-11-11T09:00:00Z");
    db.run("UPDATE route_decision SET is_current = 0 WHERE id = ?", [orphanId]);

    // Same no-row semantics as above (see the draft-only case).
    expect(latestRouteDecision(oppId)).toBeFalsy();
  });
});

// ── §9 convention-query sweep (design §9, approved 2026-11-12) ───────────────
// The three §9.1 migrate-verdict sites now read the ADR-0135 authority row.
// Shared invariant asserted at EVERY migrated site (§9.4): a draft with a
// newer decided_at must not win — seed the flagged final, then a draft with a
// later decided_at and a different track, and assert the site reads the
// final's track.
describe("§9 convention-query sweep — migrated sites read the authority row", () => {
  // The poisoning fixture behind the whole defect class (§9.2).
  function seedPoisoning(): string {
    const oppId = seedOpportunity();
    const finalId = insertFinal(oppId, "brownfield", "m_and_a", "2026-11-11T09:00:00Z");
    finalizeRouteDecisionCurrency(oppId, finalId);
    insertDraft(oppId, "greenfield", "2026-11-11T10:00:00Z");
    return oppId;
  }

  function seedGateHold(oppId: string, decidedAt: string): void {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [`gd-${oppId}`, "opportunity", oppId, "pre_fs", "hold", "aging fixture", U1, decidedAt],
    );
  }

  test("S3 capability register lead: draft-newer-than-final does not flip the attribution (§9.4 case 2)", () => {
    const oppId = seedPoisoning();
    // The newer greenfield draft must not demote the brownfield lead.
    expect(capabilityRegisterLead(db, oppId)).toBe("brownfield-agent");
  });

  test("capability register lead: draft-only opportunity stays on the greenfield default", () => {
    const oppId = seedOpportunity();
    insertDraft(oppId, "brownfield", "2026-11-11T10:00:00Z");
    // A draft is not a decision — the pre-S4 catalog default holds.
    expect(capabilityRegisterLead(db, oppId)).toBe("greenfield-agent");
  });

  test("gate aging: the opportunity track label reads the final, not the draft (§9.4 case 3)", () => {
    const oppId = seedPoisoning();
    seedGateHold(oppId, "2026-11-10T00:00:00Z");
    const row = listGateAging(db).find((r) => r.entityType === "opportunity" && r.entityId === oppId);
    expect(row).toBeDefined();
    expect(row?.track).toBe("brownfield");
  });

  test("gate aging: draft-only opportunity has no track label (no authority row)", () => {
    const oppId = seedOpportunity();
    insertDraft(oppId, "greenfield", "2026-11-11T10:00:00Z");
    seedGateHold(oppId, "2026-11-10T00:00:00Z");
    const row = listGateAging(db).find((r) => r.entityType === "opportunity" && r.entityId === oppId);
    expect(row).toBeDefined();
    expect(row?.track).toBeNull();
  });

  test("promotion: the charter-track input is the final's track, so the hint guard evaluates brownfield (§9.4 case 1)", () => {
    const oppId = seedPoisoning();
    // After the §9.2 migration the promote route's charter track is exactly
    // this expression — the authority row's track (draft excluded), which
    // buildProjectCharter receives and md_project.track snapshots at
    // promotion. The newer greenfield draft must not reach either.
    const charterTrack = latestRouteDecision(oppId)?.track ?? null;
    expect(charterTrack).toBe("brownfield");
    // The hint guard consumes the same value (`route?.track !== "greenfield"`
    // → badRequest mode_not_allowed): a greenfield-establishment hint on this
    // deal is still refused, as it would be for the flagged final.
    expect(charterTrack !== "greenfield").toBe(true);
  });

  test("tripwire: the promote route consumes the shared authority reader — no residual route_decision convention query", () => {
    // Static tripwire per the repo's source-read test convention
    // (admin-require-admin-tripwire.test.ts precedent): pins that the route
    // keeps importing latestRouteDecision and its raw convention query stays
    // gone (the §9.1 migrate-verdict must not silently regress).
    const src = readFileSync("app/web-next/app/api/opportunities/[id]/promote/route.ts", "utf-8");
    expect(src).toContain("latestRouteDecision");
    expect(src).not.toContain("ORDER BY decided_at DESC, id DESC LIMIT 1");
    expect(src).not.toContain("FROM route_decision");
  });
});
