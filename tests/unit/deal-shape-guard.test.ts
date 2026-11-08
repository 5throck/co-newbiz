// @version 1.0.0
/**
 * Deal-shape-to-S7 (owner decision 2026-11-08): the write guard for POST /api/opportunities/{id}/deal-shapes, exercised
 * against the REAL process engine on the S1-S12 demo chains (the reference "all predicates satisfied" fixtures): a
 * brownfield opportunity whose S6 is complete is open for the evaluation; one still working on S6 is not; a greenfield
 * opportunity never is. The REST status/code mapping (409 deal_shape_not_open) is covered in opportunity-deal-shape.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../../db/client.ts";
import { seedS1ToS12Demo } from "../../scripts/co-newbiz/seed-s1-s12-demo.ts";
import { DEAL_SHAPE_NOT_OPEN, dealShapeWriteGuard } from "../../app/web-next/lib/deal-shape-guard.ts";

let dir: string | null = null;
afterEach(() => {
  resetDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function seeded() {
  dir = mkdtempSync(join(tmpdir(), "co-newbiz-ds-guard-"));
  const dbPath = join(dir, "d.sqlite");
  const ids = seedS1ToS12Demo(dbPath);
  return { db: getDb(dbPath), ...ids };
}

describe("dealShapeWriteGuard (real process engine)", () => {
  test("the error code the REST route and the UI contract share", () => {
    expect(DEAL_SHAPE_NOT_OPEN).toBe("deal_shape_not_open");
  });

  test("a brownfield opportunity with S1-S6 complete is open for the deal-shape evaluation", () => {
    const { opportunityId } = seeded();
    expect(dealShapeWriteGuard(opportunityId)).toBeNull();
  });

  test("a brownfield opportunity still working on S6 (S7 locked) is refused as stage_not_reached", () => {
    const { db, opportunityId } = seeded();
    db.run("DELETE FROM brownfield_target_evidence WHERE target_id = 'demo-s1-s12-target-2'"); // S6 coverage drops: S6 current
    expect(dealShapeWriteGuard(opportunityId)).toMatchObject({ reason: "stage_not_reached" });
  });

  test("a greenfield current route decision is refused as track_not_brownfield, even though the carrier scope is complete", () => {
    const { db, opportunityId } = seeded();
    db.run(
      "UPDATE route_decision SET track = 'greenfield', sub_track = NULL WHERE opportunity_id = ? AND is_current = 1",
      [opportunityId],
    );
    expect(dealShapeWriteGuard(opportunityId)).toMatchObject({ reason: "track_not_brownfield" });
  });
});
