/**
 * value-chain-link repository tests — ADR-0116 Phase 5 (the first writer for
 * value_chain_link; the table existed since 0011 with zero writers).
 * Mirrors project-industry-repository.test.ts fixtures.
 *
 * Covers: validation (same-industry, r2/correlation ranges, grade enums,
 * evidence_ref form, unknown industry), creation with audit, listing order,
 * and the ADR-0025 boundary at the schema level (proxy_link rows are a
 * different table — nothing here touches them).
 */
import { test, describe, expect, beforeAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-value-chain-link.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const { createUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const {
  createValueChainLink,
  listLinks,
  validateLinkInput,
} = await import("../../app/web-next/lib/value-chain-link.repository.ts").catch(() =>
  import("../../db/repositories/value-chain-link.repository.ts"),
);

const NOW = new Date().toISOString();
let projectId = "";
const IND_A = ulid();
const IND_B = ulid();

beforeAll(async () => {
  await createUser(db, { userId: "vcl-analyst", role: "analyst", password: "pw-vcl-12345", createdBy: "test", now: NOW });
  for (const [id, name, ksic] of [[IND_A, "산업 A", "11001"], [IND_B, "산업 B", "11002"]] as const) {
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [id, ksic, name, name, NOW]);
  }
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "VCL 테스트 기회", "테스트 산업", "selected", "vcl-analyst", NOW],
  );
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "vcl-analyst", NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), oppId, "직접 진출", "M&A 대안 검토", "test", "vcl-analyst", NOW, NOW],
  );
  // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), oppId],
  );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", "vcl-analyst", NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: "vcl-analyst", needToKnowBasis: "vcl test" }).project.id;
});

describe("validateLinkInput", () => {
  test("same-industry link rejected", () => {
    expect(validateLinkInput({ project_id: projectId, from_industry_id: IND_A, to_industry_id: IND_A, direction: "downstream", assessed_by: "vcl-analyst" })).toContain("동일");
  });
  test("r2 out of range rejected", () => {
    expect(validateLinkInput({ project_id: projectId, from_industry_id: IND_A, to_industry_id: IND_B, direction: "downstream", r2: 1.5, assessed_by: "x" })).toContain("r2");
  });
  test("bad grade enum rejected", () => {
    expect(validateLinkInput({ project_id: projectId, from_industry_id: IND_A, to_industry_id: IND_B, direction: "downstream", switching_cost_grade: "huge", assessed_by: "x" })).toContain("switching_cost_grade");
  });
  test("non-evidence_ref form rejected (ADR-0058)", () => {
    expect(validateLinkInput({ project_id: projectId, from_industry_id: IND_A, to_industry_id: IND_B, direction: "downstream", evidence_ref: "kosis statistics page", assessed_by: "x" })).toContain("evidence_ref");
  });
  test("valid payload passes", () => {
    expect(validateLinkInput({ project_id: projectId, from_industry_id: IND_A, to_industry_id: IND_B, direction: "downstream", elasticity: 0.62, r2: 0.71, switching_cost_grade: "moderate", evidence_ref: "https://ecos.bok.or.kr", assessed_by: "x" })).toBeNull();
  });
});

describe("createValueChainLink", () => {
  test("creates a link with audit row and lists newest-first", () => {
    const link = createValueChainLink(db, {
      project_id: projectId,
      from_industry_id: IND_A,
      to_industry_id: IND_B,
      direction: "downstream",
      elasticity: 0.62,
      correlation: 0.71,
      r2: 0.71,
      switching_cost_grade: "moderate",
      substitution_threat: "low",
      evidence_ref: "src:kosis",
      assessed_by: "vcl-analyst",
    });
    expect(link.id).toBeTruthy();
    expect(link.evidence_ref).toBe("src:kosis");

    const audit = db.query("SELECT action FROM audit_log WHERE target LIKE ?").all(`${projectId}%`) as Array<{ action: string }>;
    expect(audit.some((a) => a.action === "value_chain_link_create")).toBe(true);

    const link2 = createValueChainLink(db, {
      project_id: projectId,
      from_industry_id: IND_B,
      to_industry_id: IND_A,
      direction: "upstream",
      evidence_ref: "doc:note-1",
      assessed_by: "vcl-analyst",
    });
    const links = listLinks(db, projectId);
    expect(links.length).toBe(2);
    expect(links[0].id).toBe(link2.id);
  });

  test("unknown industry fails loudly without inserting", () => {
    const before = listLinks(db, projectId).length;
    expect(() =>
      createValueChainLink(db, {
        project_id: projectId,
        from_industry_id: "01JNOINDUSTRY00000000000",
        to_industry_id: IND_B,
        direction: "downstream",
        assessed_by: "vcl-analyst",
      }),
    ).toThrow(/md_industry/);
    expect(listLinks(db, projectId).length).toBe(before);
  });
});
