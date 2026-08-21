/**
 * Unit tests for the certification repository's write-time transferability
 * boundary (design of record 2026-08-22, overturn 7 / non-negotiable
 * boundary #5). Runs against a real scratch SQLite file (same pattern as
 * migration-0012.test.ts).
 *
 * LAYERING UNDER TEST — two constraints at two layers, deliberately:
 *   - the DB CHECK (migration 0012) constrains transferability_basis to the
 *     enum ('verified','inferred') — 'inferred' is ADMITTED by the database
 *     (see the raw-INSERT test below), because the DB's job is to record
 *     the basis;
 *   - the repository (db/repositories/certification.repository.ts) is the
 *     enforcement layer that refuses to circulate an inference and rejects
 *     a 'verified' claim with no evidence reference. The block living HERE
 *     — not in a route, not in a CHECK — is what makes it hold for every
 *     caller.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { createCertification, updateTransferability } from "../../db/repositories/certification.repository.ts";

const TEST_DB_PATH = "db/data/test-certification-repository.sqlite";
const NOW = "2026-08-22T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, `NP-${projectId.slice(-6)}`, NOW]);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

describe("createCertification boundary (non-negotiable boundary #5)", () => {
  test("accepts verified + evidence_ref", () => {
    const row = createCertification({
      project_id: projectId,
      name: "IATF 16949",
      transferability_basis: "verified",
      transferability_evidence_ref: "IATF Rules 6th ed. §5.2 (change of ownership notification)",
      load_bearing: true,
    });
    expect(row.transferability_basis).toBe("verified");
    expect(row.transferability_evidence_ref).toContain("IATF Rules");
    expect(row.load_bearing).toBe(1);
  });

  test("rejects inferred — inference never enters circulation", () => {
    expect(() =>
      createCertification({
        project_id: projectId,
        name: "ISO 14001",
        transferability_basis: "inferred",
      }),
    ).toThrow(/boundary #5.*inferred/s);
    const rows = db.query("SELECT id FROM certification WHERE name = ?").all("ISO 14001");
    expect(rows).toEqual([]); // the throw happened before the INSERT, not after
  });

  test("rejects verified without evidence_ref — unsupported claim", () => {
    expect(() =>
      createCertification({
        project_id: projectId,
        name: "CE marking",
        transferability_basis: "verified",
      }),
    ).toThrow(/evidence_ref.*unsupported claim/s);
  });

  test("accepts an unassessed certification (basis null) — the gate kills later, the writer does not guess", () => {
    const row = createCertification({ project_id: projectId, name: "KEMA certified" });
    expect(row.transferability_basis).toBeNull();
    expect(row.load_bearing).toBe(0);
  });

  test("DB-level CHECK still admits 'inferred' — the block lives in the write path, not the schema", () => {
    // Layering proof: a raw INSERT (bypassing the repository) succeeds for
    // 'inferred' because migration 0012's CHECK only constrains the enum.
    // If this test ever fails with a CHECK error, the layering silently
    // moved into the DB and the repository block's test coverage above
    // would be enforcing nothing — re-check where boundary #5 lives.
    const id = ulid();
    db.run("INSERT INTO certification (id, project_id, name, transferability_basis) VALUES (?,?,?,?)", [
      id,
      projectId,
      "Raw-inserted inferred",
      "inferred",
    ]);
    const row = db.query("SELECT transferability_basis FROM certification WHERE id = ?").get(id) as {
      transferability_basis: string;
    };
    expect(row.transferability_basis).toBe("inferred");
  });
});

describe("updateTransferability boundary", () => {
  test("accepts verified + evidence_ref on a previously unassessed row", () => {
    const row = createCertification({ project_id: projectId, name: "ISO 9001" });
    const updated = updateTransferability(row.id, {
      transferability_basis: "verified",
      transferability_evidence_ref: "IAF MD 4:2022 §4.3",
    });
    expect(updated.transferability_basis).toBe("verified");
    expect(updated.transferability_evidence_ref).toBe("IAF MD 4:2022 §4.3");
  });

  test("rejects an update to inferred", () => {
    const row = createCertification({ project_id: projectId, name: "UL Listed" });
    expect(() => updateTransferability(row.id, { transferability_basis: "inferred" })).toThrow(/boundary #5.*inferred/s);
  });

  test("rejects verified with the evidence_ref arriving empty in the same call", () => {
    const row = createCertification({ project_id: projectId, name: "AS9100D" });
    expect(() =>
      updateTransferability(row.id, { transferability_basis: "verified", transferability_evidence_ref: "  " }),
    ).toThrow(/unsupported claim/);
  });

  test("rejects stripping the evidence_ref from an already-verified row (resulting-state guard)", () => {
    const row = createCertification({
      project_id: projectId,
      name: "IATF 16949 (2nd site)",
      transferability_basis: "verified",
      transferability_evidence_ref: "IATF Rules 6th ed. §5.2",
    });
    expect(() => updateTransferability(row.id, { transferability_evidence_ref: null })).toThrow(/unsupported claim/);
    const after = db.query("SELECT transferability_evidence_ref FROM certification WHERE id = ?").get(row.id) as {
      transferability_evidence_ref: string | null;
    };
    expect(after.transferability_evidence_ref).toContain("IATF Rules"); // untouched by the rejected update
  });

  test("throws on an unknown id instead of silently no-oping", () => {
    expect(() => updateTransferability("01NOSUCHCERT", { transferability_basis: "verified", transferability_evidence_ref: "x" })).toThrow(
      /not found/,
    );
  });
});
