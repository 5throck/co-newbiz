/**
 * Unit tests for promoteOpportunity (ADR-0095) — the opportunity→project
 * promotion transaction. Real scratch SQLite (classification-write test
 * pattern) so the 0063 columns, the FK to opportunity, and the membership
 * write inside the same transaction are exercised by SQLite itself.
 *
 * Covered: success path (project row + opportunity backlink + promoter as
 * `lead` member + audit, all-or-nothing), double-promotion rejection, and the
 * per-track precondition failures (missing route decision, greenfield S5
 * incomplete, brownfield S7 Short List absent).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { promoteOpportunity, PromotionError } from "../../db/repositories/project.repository.ts";

const TEST_DB_PATH = "db/data/test-project-promotion.sqlite";
const NOW = "2026-09-03T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

const U1 = "user-promoter";
const U2 = "user-other";

function insertUser(userId: string): void {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), userId, "analyst", "active", "salt", "hash", 1, NOW],
  );
}

function insertOpportunity(status = "selected"): string {
  const id = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [id, `opp-${id.slice(-6)}`, "산업 테스트", status, U1, NOW],
  );
  return id;
}

function insertRouteDecision(opportunityId: string, track: "greenfield" | "brownfield"): string {
  const id = ulid();
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?)",
    [id, opportunityId, track, "test route", U1, NOW],
  );
  return id;
}

/** S5 artifacts: a complete greenfield_assessment (≥1 gap, strategy, alternatives). */
function completeS5(opportunityId: string): void {
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, capability_gaps_json, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ulid(), opportunityId, JSON.stringify([{ gap: "g1", resolution: "hire" }]), "직접 진출", "M&A 대안 검토", "test", U1, NOW, NOW],
  );
}

/** S7 artifact: one shortlisted brownfield_target. */
function completeS7(opportunityId: string): void {
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?)`,
    [ulid(), opportunityId, "테스트 대상", "shortlisted", NOW, NOW],
  );
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  insertUser(U1);
  insertUser(U2);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

describe("promoteOpportunity (ADR-0095)", () => {
  test("greenfield success: project row + opportunity backlink + lead membership + audit, atomically", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);

    const result = promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "promoter of this review", origin: "internal" });

    const proj = db
      .query("SELECT id, project_no, origin, track, source_opportunity_id FROM md_project WHERE id = ?")
      .get(result.project.id) as Record<string, unknown>;
    expect(proj.project_no).toBe(result.project.project_no);
    expect(proj.origin).toBe("internal");
    expect(proj.track).toBe("greenfield");
    expect(proj.source_opportunity_id).toBe(oppId);

    const opp = db.query("SELECT project_id, promoted_at FROM opportunity WHERE id = ?").get(oppId) as Record<string, unknown>;
    expect(opp.project_id).toBe(result.project.id);
    expect(opp.promoted_at).toBe(result.promotedAt);

    const member = db
      .query("SELECT project_role, need_to_know_basis, revoked_at FROM project_member WHERE project_id = ? AND user_id = ?")
      .get(result.project.id, U1) as Record<string, unknown>;
    expect(member.project_role).toBe("lead");
    expect(member.need_to_know_basis).toBe("promoter of this review");
    expect(member.revoked_at).toBeNull();

    const audit = db
      .query("SELECT COUNT(*) c FROM audit_log WHERE action = 'opportunity_promoted' AND target LIKE ?")
      .get(`${oppId}%`) as { c: number };
    expect(audit.c).toBe(1);
  });

  test("double promotion is rejected, not idempotent", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "first promotion" });

    expect(() => promoteOpportunity(oppId, { promotedBy: U2, needToKnowBasis: "second attempt" })).toThrow(PromotionError);
    try {
      promoteOpportunity(oppId, { promotedBy: U2, needToKnowBasis: "second attempt" });
    } catch (err) {
      expect((err as PromotionError).code).toBe("already_promoted");
    }
    expect((db.query("SELECT COUNT(*) c FROM md_project").get() as { c: number }).c).toBe(2);
  });

  test("missing route decision (no track) → precondition_failed", () => {
    const oppId = insertOpportunity();
    completeS5(oppId); // S5 done, but S4 route never decided
    try {
      promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromotionError);
      expect((err as PromotionError).code).toBe("precondition_failed");
    }
    expect((db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string | null }).project_id).toBeNull();
  });

  test("greenfield with incomplete S5 → precondition_failed", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    // no greenfield_assessment row at all
    try {
      promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect((err as PromotionError).code).toBe("precondition_failed");
    }
    expect((db.query("SELECT COUNT(*) c FROM md_project").get() as { c: number }).c).toBe(2);
  });

  test("brownfield without S7 Short List → precondition_failed; with one → success", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "brownfield");
    try {
      promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect((err as PromotionError).code).toBe("precondition_failed");
    }
    completeS7(oppId);
    const result = promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });
    expect(result.project.track).toBe("brownfield");
  });

  test("unknown opportunity → not_found", () => {
    try {
      promoteOpportunity("does-not-exist", { promotedBy: U1, needToKnowBasis: "basis" });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect((err as PromotionError).code).toBe("not_found");
    }
  });

  test("empty needToKnowBasis is rejected before any write", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    try {
      promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "   " });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect((err as PromotionError).code).toBe("precondition_failed");
    }
    expect((db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string | null }).project_id).toBeNull();
  });
});
