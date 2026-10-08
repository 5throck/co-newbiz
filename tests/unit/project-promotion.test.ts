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
import { buildProjectCharter } from "../../app/web-next/lib/project-charter.ts";

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
  // alternatives_considered: S4 completion predicate requires it (v2.4.1 alignment).
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [id, opportunityId, track, "test route", "M&A 대안 검토 후 제외", U1, NOW],
  );
  return id;
}

/** S5 artifacts: a complete greenfield_assessment (≥1 gap, strategy, alternatives). */
// ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서
// 세므로, 그 테이블도 함께 채워야 승격 전제조건을 만족한다.
function completeS5(opportunityId: string): void {
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), opportunityId, "직접 진출", "M&A 대안 검토", "test", U1, NOW, NOW],
  );
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opportunityId],
  );
}

/** ADR-0137: S5 투자비 검토 요건 — completeS5 후 business_case_lines_json을 채운다. */
function setS5InvestmentLines(opportunityId: string, lines: Array<{ line: string; category: string; amount: number; note?: string; period?: string; currency?: string }>): void {
  db.run(
    "UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?",
    [JSON.stringify(lines), opportunityId],
  );
}

/** Gate decision rows — promotion requires every track-relevant gate GO
 * (screening + pre_fs both tracks, target_screening brownfield-only). */
function recordGate(opportunityId: string, gate: string, decision: "go" | "hold" = "go"): void {
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), "opportunity", opportunityId, gate, decision, "test gate", U1, NOW],
  );
}

function seedGates(opportunityId: string, track: "greenfield" | "brownfield"): void {
  recordGate(opportunityId, "screening");
  recordGate(opportunityId, "pre_fs");
  if (track === "brownfield") recordGate(opportunityId, "target_screening");
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
    seedGates(oppId, "greenfield");

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

  test("members array grants each assignee their own role, and self-inclusion doesn't downgrade the promoter's lead role", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    seedGates(oppId, "greenfield");

    const result = promoteOpportunity(oppId, {
      promotedBy: U1,
      needToKnowBasis: "team assignment for this deal",
      members: [
        { userId: U2, projectRole: "member" },
        { userId: U1, projectRole: "member" }, // self-inclusion — must not downgrade lead
      ],
    });

    const leadRow = db
      .query("SELECT project_role, need_to_know_basis FROM project_member WHERE project_id = ? AND user_id = ?")
      .get(result.project.id, U1) as Record<string, unknown>;
    expect(leadRow.project_role).toBe("lead");

    const reviewerRow = db
      .query("SELECT project_role, need_to_know_basis, revoked_at FROM project_member WHERE project_id = ? AND user_id = ?")
      .get(result.project.id, U2) as Record<string, unknown>;
    expect(reviewerRow.project_role).toBe("member");
    expect(reviewerRow.need_to_know_basis).toBe("team assignment for this deal");
    expect(reviewerRow.revoked_at).toBeNull();
  });

  test("members array with a non-existent userId throws rather than silently skipping", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    seedGates(oppId, "greenfield");

    expect(() =>
      promoteOpportunity(oppId, {
        promotedBy: U1,
        needToKnowBasis: "basis",
        members: [{ userId: "user-does-not-exist", projectRole: "member" }],
      }),
    ).toThrow();

    // Whole transaction rolled back — no project row leaked from the failed attempt.
    const proj = db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string | null };
    expect(proj.project_id).toBeNull();
  });

  test("ADR-0137: S5 투자비 검토 요건이 promotion 시 business_case_model/line으로 이관된다", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    setS5InvestmentLines(oppId, [
      { line: "생산설비 투자", category: "capex", amount: 12, note: "초기 라인 구축" },
      { line: "초기 인건비", category: "labor", amount: 3 },
      { line: "무효 항목(카테고리 불량)", category: "bogus", amount: 1 },
    ]);
    seedGates(oppId, "greenfield");

    const result = promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });

    const model = db
      .query("SELECT id, kind, name FROM business_case_model WHERE project_id = ?")
      .get(result.project.id) as Record<string, unknown>;
    expect(model.kind).toBe("greenfield_cost");

    const lines = db
      .query("SELECT category, name, annual_amount_krw_m, note FROM business_case_line WHERE model_id = ? ORDER BY category")
      .all(model.id as string) as Array<Record<string, unknown>>;
    // The bogus-category line is dropped, not silently coerced.
    expect(lines).toHaveLength(2);
    const capex = lines.find((l) => l.category === "capex")!;
    expect(capex.name).toBe("생산설비 투자");
    expect(capex.annual_amount_krw_m).toBe(1200); // 12억원 × 100 = 1200 (백만원)
    const labor = lines.find((l) => l.category === "labor")!;
    expect(labor.annual_amount_krw_m).toBe(300);
    expect(labor.note).toBe("S5에서 이관됨 — 검증 필요");
  });

  test("ADR-0137: 투자비 항목이 없으면 business_case_model을 만들지 않는다", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    seedGates(oppId, "greenfield");

    const result = promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });

    const count = db.query("SELECT COUNT(*) c FROM business_case_model WHERE project_id = ?").get(result.project.id) as { c: number };
    expect(count.c).toBe(0);
  });

  test("ADR-0138: gov_rnd 카테고리, 월/분기 정규화, lumpsum·비KRW 통화 note 플래그", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    setS5InvestmentLines(oppId, [
      { line: "정부 R&D 지원금", category: "gov_rnd", amount: 5, note: "국책과제" },
      { line: "월간 임차료", category: "opex", amount: 1, period: "monthly" },
      { line: "분기 라이선스", category: "opex", amount: 2, period: "quarterly" },
      { line: "장비 일시불 구매", category: "capex", amount: 10, period: "lumpsum" },
      { line: "해외 컨설팅", category: "opex", amount: 1, currency: "USD" },
    ]);
    seedGates(oppId, "greenfield");

    const result = promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });
    const model = db.query("SELECT id FROM business_case_model WHERE project_id = ?").get(result.project.id) as { id: string };
    const lines = db
      .query("SELECT name, category, annual_amount_krw_m, note FROM business_case_line WHERE model_id = ? ORDER BY name")
      .all(model.id) as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(5);

    const govRnd = lines.find((l) => l.name === "정부 R&D 지원금")!;
    expect(govRnd.category).toBe("gov_rnd");
    expect(govRnd.annual_amount_krw_m).toBe(500); // 5억 × 100

    const monthly = lines.find((l) => l.name === "월간 임차료")!;
    expect(monthly.annual_amount_krw_m).toBe(1200); // 1억 × 12 × 100

    const quarterly = lines.find((l) => l.name === "분기 라이선스")!;
    expect(quarterly.annual_amount_krw_m).toBe(800); // 2억 × 4 × 100

    const lumpsum = lines.find((l) => l.name === "장비 일시불 구매")!;
    expect(lumpsum.annual_amount_krw_m).toBe(1000); // 10억 × 100, not multiplied
    expect(lumpsum.note).toContain("일시불 총액");

    const fx = lines.find((l) => l.name === "해외 컨설팅")!;
    expect(fx.note).toContain("원문 통화: USD");
  });

  test("double promotion is rejected, not idempotent", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    seedGates(oppId, "greenfield");
    promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "first promotion" });

    expect(() => promoteOpportunity(oppId, { promotedBy: U2, needToKnowBasis: "second attempt" })).toThrow(PromotionError);
    try {
      promoteOpportunity(oppId, { promotedBy: U2, needToKnowBasis: "second attempt" });
    } catch (err) {
      expect((err as PromotionError).code).toBe("already_promoted");
    }
    expect((db.query("SELECT COUNT(*) c FROM md_project").get() as { c: number }).c).toBe(6);
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
    seedGates(oppId, "greenfield");
    // no greenfield_assessment row at all
    try {
      promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect((err as PromotionError).code).toBe("precondition_failed");
    }
    expect((db.query("SELECT COUNT(*) c FROM md_project").get() as { c: number }).c).toBe(6);
  });

  test("brownfield without S7 Short List → precondition_failed; with one → success", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "brownfield");
    seedGates(oppId, "brownfield");
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

  test("pending gate (pre_fs HOLD) → precondition_failed — gates align with the pipeline ordering", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    completeS5(oppId);
    recordGate(oppId, "screening", "go");
    recordGate(oppId, "pre_fs", "hold");
    try {
      promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis" });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect((err as PromotionError).code).toBe("precondition_failed");
    }
    expect((db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string | null }).project_id).toBeNull();
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
    seedGates(oppId, "greenfield");
    try {
      promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "   " });
      throw new Error("expected PromotionError");
    } catch (err) {
      expect((err as PromotionError).code).toBe("precondition_failed");
    }
    expect((db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string | null }).project_id).toBeNull();
  });
});

// ── Route surface: the role boundary (Phase 0 coverage gap) ─────────────────
// The repository layer has no role concept — the 403 lives on the promote
// route. Driven through the real route handlers (nextRequest harness).

describe("buildProjectCharter (ADR-0104) display name", () => {
  test("promotion name is the opportunity name — sub_track stays a classification, never a title suffix", () => {
    const oppId = insertOpportunity();
    insertRouteDecision(oppId, "greenfield");
    db.run("UPDATE route_decision SET sub_track = 'existing_business_rbd' WHERE opportunity_id = ?", [oppId]);

    const { name, charter } = buildProjectCharter(db, { opportunityId: oppId, track: "greenfield", builtBy: U1, now: NOW });
    const opp = db.query("SELECT name FROM opportunity WHERE id = ?").get(oppId) as { name: string };

    expect(name).toBe(opp.name);
    expect(name).not.toContain("existing_business_rbd");
    // The deal shape itself stays recorded in the charter.
    expect(charter.subTrack).toBe("existing_business_rbd");
  });
});

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser: createAccount, approveUser: approveAccount } = await import("../../db/lib/accounts.ts");

describe("POST /api/opportunities/[id]/promote — role boundary", () => {
  test("viewer calling promote → 403, no project created", async () => {
    await createAccount(db, { userId: "viewer-promoter", role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
    approveAccount(db, { userId: "viewer-promoter", approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: "viewer-promoter", password: "pw-viewer-12345" }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];

    const oppId = insertOpportunity();
    const res = await nextRequest(`/api/opportunities/${oppId}/promote`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ needToKnowBasis: "viewer must not promote" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
    // No side effect: the opportunity stays unpromoted.
    expect((db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string | null }).project_id).toBeNull();
  });
});

describe("promoteOpportunity origin derivation", () => {
  test("Wave F-8 (B4): origin is derived from the route sub_track when not supplied; an explicit origin wins", () => {
    const promoteWith = (sub: string, origin?: "external") => {
      const oppId = insertOpportunity();
      insertRouteDecision(oppId, "brownfield");
      db.run("UPDATE route_decision SET sub_track = ? WHERE opportunity_id = ?", [sub, oppId]);
      completeS7(oppId);
      seedGates(oppId, "brownfield");
      const r = promoteOpportunity(oppId, { promotedBy: U1, needToKnowBasis: "basis", origin });
      return (db.query("SELECT origin FROM md_project WHERE id = ?").get(r.project.id) as { origin: string | null }).origin;
    };
    expect(promoteWith("jv")).toBe("joint");
    expect(promoteWith("corporate_venture")).toBe("internal");
    expect(promoteWith("m_and_a")).toBe("external");
    expect(promoteWith("jv", "external")).toBe("external");
  });
});
