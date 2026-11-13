// @version 1.0.0
/**
 * DELETE /api/market-overview/industry/:industryId/external-reference —
 * external reference supersede (design 2026-09-18-s1-growth-gap-calibration,
 * amendment 2026-11-12c). DELETE is a record-preserving retirement, not a
 * physical delete: superseded_at is stamped, superseded_by stays NULL (plain
 * supersede), the row is never removed, and the audit lands only on the FIRST
 * supersede. Contract pinned here: latest superseded → the resolver falls
 * back to the previous row; wrong industry → 404 (not 403); already
 * superseded → idempotent no-op (200, no second audit); viewer → 403
 * role_required; the audit row is written with action
 * market_external_reference.supersede.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-external-reference-supersede.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { resolveExternalReference, supersedeExternalReference } = await import(
  "../../app/web-next/lib/market-calibration.ts"
);

const NOW = new Date().toISOString();

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const PASSWORDS: Record<string, string> = { ana: "pw-ana-1234567", vic: "pw-vic-1234567" };
let analystCookie: string;
let viewerCookie: string;
let industryA: string;
let industryB: string;

const putRef = (industryId: string, label: string, cagr: number) =>
  nextRequest(`/api/market-overview/industry/${encodeURIComponent(industryId)}/external-reference`, {
    method: "PUT",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ source_label: label, target_year: 2030, external_cagr_pct: cagr }),
  });

const deleteRef = (industryId: string, id: string, cookie = analystCookie) =>
  nextRequest(`/api/market-overview/industry/${encodeURIComponent(industryId)}/external-reference`, {
    method: "DELETE",
    headers: { cookie },
    body: JSON.stringify({ id }),
  });

beforeAll(async () => {
  for (const [userId, role] of [
    ["ana", "analyst"],
    ["vic", "viewer"],
  ] as const) {
    await createUser(db, { userId, role, password: PASSWORDS[userId], createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("ana", PASSWORDS.ana);
  viewerCookie = await loginCookie("vic", PASSWORDS.vic);
  industryA = `ind-supersede-a-${Math.random().toString(36).slice(2, 8)}`;
  industryB = `ind-supersede-b-${Math.random().toString(36).slice(2, 8)}`;
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryA,
    "99101",
    "폐기 테스트 산업A",
    "supersede-test-a",
    NOW,
  ]);
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryB,
    "99102",
    "폐기 테스트 산업B",
    "supersede-test-b",
    NOW,
  ]);
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

async function bodyOf(res: Response): Promise<{
  data?: { reference?: Record<string, unknown> | null; latest?: Record<string, unknown> | null };
  error?: { code?: string };
}> {
  return (await res
    .clone()
    .json()
    .catch(() => ({}))) as never;
}

const getRef = (industryId: string) =>
  nextRequest(`/api/market-overview/industry/${encodeURIComponent(industryId)}/external-reference`, {
    headers: { cookie: analystCookie },
  });

const supersedeAudits = () =>
  (
    db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'market_external_reference.supersede'").get() as {
      n: number;
    }
  ).n;

describe("DELETE external-reference — supersede semantics", () => {
  test("superseding the latest makes the resolver return the previous row and stamps the retirement", async () => {
    const first = await bodyOf(await putRef(industryA, "구 전망 보고서", 5));
    const second = await bodyOf(await putRef(industryA, "신규 애널리스트 전망", 12.5));
    const firstId = first.data!.reference!.id as string;
    const secondId = second.data!.reference!.id as string;
    expect(resolveExternalReference(db, industryA)!.id).toBe(secondId);

    const auditsBefore = supersedeAudits();
    const res = await deleteRef(industryA, secondId);
    expect(res.status).toBe(200);
    const out = await bodyOf(res);
    expect(out.data!.reference!.id).toBe(secondId);
    expect(out.data!.reference!.superseded_at).toBeTruthy();
    expect(out.data!.reference!.superseded_by).toBeNull(); // plain supersede — no successor
    // the retired row still exists (append-only preservation) …
    const stillThere = db.query("SELECT superseded_at FROM market_external_reference WHERE id = ?").get(secondId) as {
      superseded_at: string;
    };
    expect(stillThere.superseded_at).toBeTruthy();
    // … and the live reference is now the previous one.
    expect(resolveExternalReference(db, industryA)!.id).toBe(firstId);
    expect(resolveExternalReference(db, industryA)!.source_label).toBe("구 전망 보고서");
    expect(supersedeAudits()).toBe(auditsBefore + 1);
  });

  test("wrong industry on the path but a valid id → 404 (existence never leaked as a role answer)", async () => {
    const ref = resolveExternalReference(db, industryA)!;
    const res = await deleteRef(industryB, ref.id);
    expect(res.status).toBe(404);
    expect((await bodyOf(res)).error!.code).toBe("not_found");
    // untouched — no retirement stamped by the mismatched-industry call.
    expect(
      (
        db.query("SELECT superseded_at FROM market_external_reference WHERE id = ?").get(ref.id) as {
          superseded_at: string | null;
        }
      ).superseded_at,
    ).toBeNull();
  });

  test("already-superseded → idempotent no-op: 200 with the same row and NO second audit", async () => {
    const rows = db
      .query("SELECT id FROM market_external_reference WHERE industry_id = ? AND superseded_at IS NOT NULL")
      .all(industryA) as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    const supersededId = rows[0].id;
    const auditsBefore = supersedeAudits();
    const repeat = await deleteRef(industryA, supersededId);
    expect(repeat.status).toBe(200);
    const out = await bodyOf(repeat);
    expect(out.data!.reference!.id).toBe(supersededId);
    expect(supersedeAudits()).toBe(auditsBefore); // no double audit
  });

  test("unknown id → 404", async () => {
    const res = await deleteRef(industryA, "mer-unknown-id");
    expect(res.status).toBe(404);
    expect((await bodyOf(res)).error!.code).toBe("not_found");
  });

  test("viewer → 403 role_required with the viewer message; unauthenticated → 401", async () => {
    const ref = resolveExternalReference(db, industryA)!;
    const viewerRes = await deleteRef(industryA, ref.id, viewerCookie);
    expect(viewerRes.status).toBe(403);
    expect((await bodyOf(viewerRes)).error!.code).toBe("role_required");
    const anonRes = await nextRequest(
      `/api/market-overview/industry/${encodeURIComponent(industryA)}/external-reference`,
      {
        method: "DELETE",
        body: JSON.stringify({ id: ref.id }),
      },
    );
    expect(anonRes.status).toBe(401);
    // nothing was retired by the denied calls
    expect(
      (
        db.query("SELECT superseded_at FROM market_external_reference WHERE id = ?").get(ref.id) as {
          superseded_at: string | null;
        }
      ).superseded_at,
    ).toBeNull();
  });

  test("lib-level: supersedeExternalReference returns null for a missing id (404 shape upstream)", async () => {
    expect(supersedeExternalReference(db, industryA, "mer-never-existed", "ana")).toBeNull();
  });
});

describe("GET external-reference — additive { reference, latest } shape (design 2026-11-13 §3.3b)", () => {
  test("before any supersede, latest is the same row as reference", async () => {
    const put = await bodyOf(await putRef(industryB, "유효 참조", 9.9));
    const activeId = put.data!.reference!.id as string;
    const out = await bodyOf(await getRef(industryB));
    expect(out.data!.reference!.id).toBe(activeId);
    expect(out.data!.latest!.id).toBe(activeId);
    expect(out.data!.latest!.superseded_at).toBeNull();
  });

  test("after superseding the only reference: reference null, latest still the retired row", async () => {
    const before = await bodyOf(await getRef(industryB));
    const activeId = before.data!.reference!.id as string;
    const del = await deleteRef(industryB, activeId);
    expect(del.status).toBe(200);
    const out = await bodyOf(await getRef(industryB));
    // the active reference is gone …
    expect(out.data!.reference).toBeNull();
    // … but the retired row stays reachable for the staleness banner (the
    // displayed version may still cite it).
    expect(out.data!.latest!.id).toBe(activeId);
    expect(out.data!.latest!.superseded_at).toBeTruthy();
  });

  test("industry with no reference at all: both null", async () => {
    const fresh = `ind-supersede-c-${Math.random().toString(36).slice(2, 8)}`;
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
      fresh,
      "99103",
      "빈 참조 산업C",
      "supersede-test-c",
      NOW,
    ]);
    const out = await bodyOf(await getRef(fresh));
    expect(out.data!.reference).toBeNull();
    expect(out.data!.latest).toBeNull();
  });
});
