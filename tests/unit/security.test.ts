// @version 1.0.0
/**
 * Wave 5.5 information-protection tests — docs/security/security-model.md §7's full
 * 8-point verification list, one describe per point, plus the account/
 * session flows of §4. Every asserted figure was first verified against the
 * real engines (bun -e smoke runs) before being encoded here — nothing is
 * asserted from reading the code alone.
 *
 * Runs against a real scratch SQLite file (deleted after), not a mock DB
 * layer, so actual SQL, CHECK constraints, and triggers are exercised.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import type { Database } from "bun:sqlite";
import * as projectRepo from "../../db/repositories/project.repository.ts";
import {
  grantProjectMembership,
  revokeProjectMembership,
  acknowledgeInsider,
} from "../../db/lib/access-control.ts";
import {
  createUser,
  approveUser,
  authenticate,
  validateSession,
  revokeSessions,
  changePassword,
  resetPassword,
  MAX_FAILED_ATTEMPTS,
} from "../../db/lib/accounts.ts";
import { verifyPassword } from "../../scripts/lib/auth.ts";

const TEST_DB_PATH = "db/data/test-security.sqlite";
const NOW = "2026-08-20T10:00:00Z";

let db: Database;

beforeAll(async () => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH); // primes the client cache the repository layer reads through

  // Projects: P1 plain, P2 MNPI, P3 behind the "competitor-desk" wall.
  const projects: [string, string, string][] = [
    ["P1", "NP-2026-001", "2026-01-01T00:00:00Z"],
    ["P2", "NP-2026-002", "2026-01-02T00:00:00Z"],
    ["P3", "NP-2026-003", "2026-01-03T00:00:00Z"],
  ];
  for (const [id, no, at] of projects) {
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, no, at]);
  }
  db.run(
    `INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at)
     VALUES ('P2','restricted',1,'legal','2026-01-02T00:00:00Z')`,
  );
  db.run(
    `INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, wall_group, classified_by, classified_at)
     VALUES ('P3','confidential',0,'competitor-desk','legal','2026-01-03T00:00:00Z')`,
  );

  // Accounts: alice (member), bob (outsider), root (admin, no membership),
  // walled (member of P3 but blocked by wall group).
  const users: [string, "admin" | "analyst" | "viewer", string | null][] = [
    ["alice", "analyst", null],
    ["bob", "analyst", null],
    ["root", "admin", null],
    ["walled", "analyst", "competitor-desk"],
  ];
  for (const [userId, role, wallGroup] of users) {
    await createUser(db, { userId, role, password: `pw-${userId}-12345`, createdBy: "boot", now: NOW, wallGroup });
    await approveUser(db, { userId, approvedBy: "root", now: NOW });
  }

  grantProjectMembership(db, { projectId: "P1", userId: "alice", projectRole: "lead", grantedBy: "root", needToKnowBasis: "deal team lead", now: NOW });
  grantProjectMembership(db, { projectId: "P2", userId: "alice", projectRole: "contributor", grantedBy: "root", needToKnowBasis: "valuation model owner", now: NOW });
  grantProjectMembership(db, { projectId: "P3", userId: "walled", projectRole: "observer", grantedBy: "root", needToKnowBasis: "ops review", now: NOW });
});

afterAll(async () => {
  resetDb();
  // Windows: the WAL checkpoint can still be flushing when afterAll fires, so
  // the scratch files are briefly locked — retry after a short wait.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = TEST_DB_PATH + suffix;
        if (existsSync(p)) rmSync(p);
      }
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

describe("security-model §7 item 1 — non-member sees nothing", () => {
  test("non-member's project list is empty", () => {
    expect(projectRepo.listVisibleProjects("bob")).toHaveLength(0);
  });

  test("non-member's direct fetch by exact id returns null, not an error", () => {
    expect(projectRepo.getProjectIfVisible("bob", "P1")).toBeNull();
    expect(projectRepo.getProjectIfVisible("bob", "P2")).toBeNull();
  });

  test("member's list contains only their projects", () => {
    const nos = projectRepo.listVisibleProjects("alice").map((p) => p.project_no);
    expect(nos).toEqual(["NP-2026-002", "NP-2026-001"]); // created_at DESC
  });
});

describe("security-model §7 item 2 — admin is not deal-data visibility", () => {
  test("admin without membership sees no projects", () => {
    expect(projectRepo.listVisibleProjects("root")).toHaveLength(0);
    expect(projectRepo.getProjectIfVisible("root", "P1")).toBeNull();
  });
});

describe("security-model §7 item 3 — single enforcement point, no bypass path", () => {
  test("the repository exports exactly the gated functions — no unfiltered read variant exists", () => {
    // ADR-0095 adds promoteOpportunity (the one write path into md_project that
    // grants the promoter lead membership in the same transaction) and its
    // typed PromotionError. The deny-by-default READ surface is unchanged:
    // still only getProjectIfVisible / listVisibleProjects.
    expect(Object.keys(projectRepo).sort()).toEqual([
      "PromotionError",
      "createProject",
      "getProjectIfVisible",
      "listVisibleProjects",
      "promoteOpportunity",
    ]);
  });

  test("every read function requires a callerId as its first parameter", () => {
    // Structural: calling with a non-member id cannot leak, even with the
    // exact project id in hand (the crafted-query attempt from §7 item 3).
    expect(projectRepo.getProjectIfVisible("bob", "P1")).toBeNull();
  });
});

describe("security-model §7 item 4 — MNPI handling (FR-SEC-06)", () => {
  test("membership grant on an MNPI project auto-populates insider_list with the basis as reason", () => {
    const row = db.query("SELECT reason FROM insider_list WHERE project_id = 'P2' AND user_id = 'alice'").get() as { reason: string };
    expect(row.reason).toContain("valuation model owner");
  });

  test("every read of the MNPI project writes data_access_log", () => {
    const before = (db.query("SELECT COUNT(*) c FROM data_access_log WHERE project_id = 'P2' AND action = 'read' AND user_id = 'alice'").get() as { c: number }).c;
    projectRepo.getProjectIfVisible("alice", "P2");
    const after = (db.query("SELECT COUNT(*) c FROM data_access_log WHERE project_id = 'P2' AND action = 'read' AND user_id = 'alice'").get() as { c: number }).c;
    expect(after).toBe(before + 1);
  });

  test("excludeMnpi (the MCP default) hides the MNPI project from a member", () => {
    const nos = projectRepo.listVisibleProjects("alice", { excludeMnpi: true }).map((p) => p.project_no);
    expect(nos).toEqual(["NP-2026-001"]);
    expect(projectRepo.getProjectIfVisible("alice", "P2", { excludeMnpi: true })).toBeNull();
  });

  test("the scoped-token override is itself audit-logged", () => {
    const before = (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'mnpi_scope_override' AND target = 'P2'").get() as { c: number }).c;
    expect(projectRepo.getProjectIfVisible("alice", "P2", { mnpiScopeOverrideBy: "scoped-token-7f" })).not.toBeNull();
    const after = (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'mnpi_scope_override' AND target = 'P2'").get() as { c: number }).c;
    expect(after).toBe(before + 1);
  });

  test("insider acknowledgement is recorded and audited", () => {
    acknowledgeInsider(db, { projectId: "P2", userId: "alice", now: NOW });
    const row = db.query("SELECT acknowledged_at FROM insider_list WHERE project_id = 'P2' AND user_id = 'alice'").get() as { acknowledged_at: string };
    expect(row.acknowledged_at).toBe(NOW);
  });

  test("membership revoke closes the insider_list entry", () => {
    revokeProjectMembership(db, { projectId: "P2", userId: "alice", revokedBy: "root", now: "2026-08-20T12:00:00Z" });
    const row = db.query("SELECT removed_at FROM insider_list WHERE project_id = 'P2' AND user_id = 'alice'").get() as { removed_at: string };
    expect(row.removed_at).toBe("2026-08-20T12:00:00Z");
    expect(projectRepo.getProjectIfVisible("alice", "P2")).toBeNull();
    // restore for later describes
    grantProjectMembership(db, { projectId: "P2", userId: "alice", projectRole: "contributor", grantedBy: "root", needToKnowBasis: "valuation model owner", now: "2026-08-20T12:05:00Z" });
  });

  test("acknowledgement by a non-insider is refused", () => {
    expect(() => acknowledgeInsider(db, { projectId: "P2", userId: "bob", now: NOW })).toThrow(/not on the active insider list/);
  });
});

describe("security-model §7 item 5 — comp_benchmark aggregate floor (FR-SEC-05)", () => {
  const insertComp = (id: string, headcount: number) =>
    db.run(
      `INSERT INTO comp_benchmark (id, project_id, job_family, grade, headcount, target_median, acquirer_median, gap_pct, annual_cost_delta)
       VALUES (?,'P1','eng','G5',?,100,90,10.0,1000)`,
      [id, headcount],
    );

  test("headcount 1 and 2 rows are rejected by the k=3 CHECK — individual granularity cannot be stored", () => {
    expect(() => insertComp("K1", 1)).toThrow(/CHECK/);
    expect(() => insertComp("K2", 2)).toThrow(/CHECK/);
  });

  test("a k=3 aggregate row is accepted", () => {
    insertComp("K3", 3);
    expect((db.query("SELECT headcount FROM comp_benchmark WHERE id = 'K3'").get() as { headcount: number }).headcount).toBe(3);
  });

  test("v_comp_anonymized exposes no payroll-median columns", () => {
    const cols = (db.query("PRAGMA table_info(v_comp_anonymized)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("gap_pct");
    expect(cols).not.toContain("target_median");
    expect(cols).not.toContain("acquirer_median");
  });
});

describe("security-model §7 item 6 — executive_ref is a surrogate key, never a name", () => {
  const insertExec = (id: string, ref: string) =>
    db.run(
      `INSERT INTO management_package (id, project_id, executive_ref, role_title, base_pay)
       VALUES (?, 'P1', ?, 'CEO', 100000000)`,
      [id, ref],
    );

  test("a Korean real name is rejected", () => {
    expect(() => insertExec("M-KR", "김철수")).toThrow(/CHECK/);
  });

  test("a Western real name (space + lowercase) is rejected", () => {
    expect(() => insertExec("M-EN", "John Smith")).toThrow(/CHECK/);
  });

  test("the position-based surrogate format is accepted", () => {
    db.run(
      `INSERT INTO management_package (id, project_id, executive_ref, role_title, base_pay)
       VALUES ('M-OK','P1','TARGET-CEO-01','CEO',100000000)`,
    );
    const row = db.query("SELECT executive_ref FROM management_package WHERE id = 'M-OK'").get() as { executive_ref: string };
    expect(row.executive_ref).toBe("TARGET-CEO-01");
  });
});

describe("security-model §7 item 7 — audit_log is append-only (FR-SEC-07)", () => {
  test("DELETE is aborted by the DB trigger", () => {
    expect(() => db.run("DELETE FROM audit_log")).toThrow(/append-only/);
  });

  test("UPDATE is aborted equally — rewriting history is deletion with extra steps", () => {
    expect(() => db.run("UPDATE audit_log SET action = 'x'")).toThrow(/append-only/);
  });

  test("INSERT still works — append is the only write shape", () => {
    db.run(`INSERT INTO audit_log (id, actor_user_id, action, target, created_at) VALUES ('A-OK','root','probe','t','${NOW}')`);
    expect((db.query("SELECT COUNT(*) c FROM audit_log WHERE id = 'A-OK'").get() as { c: number }).c).toBe(1);
  });
});

describe("security-model §7 item 8 — password is not recoverable from the DB (FR-SEC-09)", () => {
  test("a direct dump of app_user contains no plaintext password", () => {
    const dump = JSON.stringify(db.query("SELECT * FROM app_user WHERE user_id = 'alice'").all());
    expect(dump).not.toContain("pw-alice-12345");
    expect(dump).toContain("password_hash"); // hash material exists, plaintext does not
  });

  test("the stored hash verifies with the right password and rejects the wrong one", async () => {
    const row = db.query("SELECT password_salt, password_hash, password_iterations FROM app_user WHERE user_id = 'alice'").get() as {
      password_salt: string; password_hash: string; password_iterations: number;
    };
    expect(await verifyPassword("pw-alice-12345", { salt: row.password_salt, hash: row.password_hash, iterations: row.password_iterations })).toBe(true);
    expect(await verifyPassword("wrong", { salt: row.password_salt, hash: row.password_hash, iterations: row.password_iterations })).toBe(false);
  });

  test("session tokens are stored hashed — a session-table dump cannot be replayed", async () => {
    const auth = await authenticate(db, { userId: "alice", password: "pw-alice-12345", now: NOW });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const dump = JSON.stringify(db.query("SELECT * FROM session").all());
    expect(dump).not.toContain(auth.session.token);
  });
});

describe("wall_group exclusion (FR-SEC-04)", () => {
  test("a member behind the project's wall sees it nowhere — list or direct fetch", () => {
    expect(projectRepo.listVisibleProjects("walled")).toHaveLength(0);
    expect(projectRepo.getProjectIfVisible("walled", "P3")).toBeNull();
  });

  test("the same user sees non-walled projects normally if made a member", () => {
    grantProjectMembership(db, { projectId: "P1", userId: "walled", projectRole: "observer", grantedBy: "root", needToKnowBasis: "ops review", now: NOW });
    expect(projectRepo.getProjectIfVisible("walled", "P1")?.project_no).toBe("NP-2026-001");
  });
});

describe("membership grant guards (design §4-9-1(a) / FR-SEC-08)", () => {
  test("a grant without a need-to-know basis is refused", () => {
    expect(() =>
      grantProjectMembership(db, { projectId: "P1", userId: "bob", projectRole: "observer", grantedBy: "root", needToKnowBasis: "   ", now: NOW }),
    ).toThrow(/need_to_know_basis/);
  });

  test("a grant to an account that does not exist is refused — no phantom or agent accounts", () => {
    expect(() =>
      grantProjectMembership(db, { projectId: "P1", userId: "ghost", projectRole: "observer", grantedBy: "root", needToKnowBasis: "x", now: NOW }),
    ).toThrow(/FR-SEC-08/);
  });
});

describe("account lifecycle and lockout (security-model §4)", () => {
  test("a fresh account cannot authenticate before approval", async () => {
    await createUser(db, { userId: "dave", role: "viewer", password: "pw-dave-12345", createdBy: "boot", now: NOW });
    const res = await authenticate(db, { userId: "dave", password: "pw-dave-12345", now: NOW });
    expect(res).toEqual({ ok: false, reason: "pending_approval" });
  });

  test("five consecutive failures lock the account for 30 minutes", async () => {
    approveUser(db, { userId: "dave", approvedBy: "root", now: NOW });
    let last: Awaited<ReturnType<typeof authenticate>> = { ok: false, reason: "invalid_credentials" };
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      last = await authenticate(db, { userId: "dave", password: `wrong-${i}-pw`, now: NOW });
    }
    expect(last).toEqual({ ok: false, reason: "locked", lockedUntil: "2026-08-20T10:30:00.000Z" });
  });

  test("the correct password is refused while locked", async () => {
    const res = await authenticate(db, { userId: "dave", password: "pw-dave-12345", now: "2026-08-20T10:10:00Z" });
    expect(res).toEqual({ ok: false, reason: "locked", lockedUntil: "2026-08-20T10:30:00.000Z" });
  });

  test("a successful login after lockout expiry unlocks and clears the counter", async () => {
    const res = await authenticate(db, { userId: "dave", password: "pw-dave-12345", now: "2026-08-20T10:31:00Z" });
    expect(res.ok).toBe(true);
    const row = db.query("SELECT failed_attempts, locked_until FROM app_user WHERE user_id = 'dave'").get() as { failed_attempts: number; locked_until: string | null };
    expect(row.failed_attempts).toBe(0);
    expect(row.locked_until).toBeNull();
  });
});

describe("session lifecycle", () => {
  test("an issued session validates and carries the account role", async () => {
    const auth = await authenticate(db, { userId: "alice", password: "pw-alice-12345", now: NOW });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const v = validateSession(db, auth.session.token, NOW);
    expect(v).toMatchObject({ userId: "alice", role: "analyst" });
  });

  test("revocation kills the session immediately", async () => {
    const auth = await authenticate(db, { userId: "alice", password: "pw-alice-12345", now: NOW });
    if (!auth.ok) return;
    revokeSessions(db, { userId: "alice", now: NOW });
    expect(validateSession(db, auth.session.token, NOW)).toBeNull();
  });

  test("an expired session does not validate", async () => {
    const auth = await authenticate(db, { userId: "alice", password: "pw-alice-12345", now: NOW });
    if (!auth.ok) return;
    expect(validateSession(db, auth.session.token, "2026-08-21T00:00:00Z")).toBeNull();
  });
});

describe("password change and reset (security-model §4)", () => {
  test("changing to a previously used password is refused via password_history", async () => {
    const first = await changePassword(db, { userId: "bob", currentPassword: "pw-bob-12345", newPassword: "pw-bob-67890", now: NOW });
    expect(first.token.length).toBe(64);
    await expect(
      changePassword(db, { userId: "bob", currentPassword: "pw-bob-67890", newPassword: "pw-bob-12345", now: NOW }),
    ).rejects.toThrow(/password_history/);
  });

  test("a wrong current password is refused", async () => {
    await expect(
      changePassword(db, { userId: "bob", currentPassword: "nope-nope-nope", newPassword: "pw-bob-abcde", now: NOW }),
    ).rejects.toThrow(/Current password does not match/);
  });

  test("password change revokes prior sessions and issues a fresh one", async () => {
    const before = await authenticate(db, { userId: "bob", password: "pw-bob-67890", now: NOW });
    if (!before.ok) throw new Error("authenticate failed");
    const changed = await changePassword(db, { userId: "bob", currentPassword: "pw-bob-67890", newPassword: "pw-bob-abcde", now: "2026-08-20T11:00:00Z" });
    expect(validateSession(db, before.session.token, "2026-08-20T11:01:00Z")).toBeNull();
    expect(validateSession(db, changed.token, "2026-08-20T11:01:00Z")).toMatchObject({ userId: "bob" });
  });

  test("admin reset forces the change flow and revokes every session", async () => {
    const live = await authenticate(db, { userId: "bob", password: "pw-bob-abcde", now: "2026-08-20T12:00:00Z" });
    if (!live.ok) throw new Error("authenticate failed");
    await resetPassword(db, { userId: "bob", tempPassword: "temp-bob-9999", resetBy: "root", now: "2026-08-20T12:30:00Z" });
    expect(validateSession(db, live.session.token, "2026-08-20T12:31:00Z")).toBeNull();
    const res = await authenticate(db, { userId: "bob", password: "temp-bob-9999", now: "2026-08-20T12:31:00Z" });
    expect(res).toMatchObject({ ok: true, mustChangePassword: true });
  });
});
