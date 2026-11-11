/**
 * Target identity resolution — design 2026-11-11-target-identity-resolution
 * (DEC-20261111-06) Rows 1+ implementation tests for D1 (canonical names at
 * the identity write boundary), D3 (code-aware duplicate handling on both
 * registration POSTs + PATCH collision 409) and D4 (the unified
 * updateTargetFields path), exercised against the REAL route handlers via the
 * nextRequest harness and a scratch SQLite per the house fixture pattern.
 *
 * D2 lives in brownfield-llm-support.test.ts (the web-search normalize tests
 * live there per design §11); D5 extends dart-financial-facts.test.ts; D6/D7
 * live in target-sync-visibility.test.ts.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-target-identity.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { resolveOrCreateCompany, createTarget } = await import("../../app/web-next/lib/brownfield-targets.ts");

const NOW = "2026-11-11T10:00:00Z";
const ANALYST = "identity-analyst";
let analystCookie = "";
let oppId = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function auditCount(action: string): number {
  return (db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = ?").get(action) as { c: number }).c;
}

function insertCompanyLegacy(nameKo: string, corpCode: string | null): string {
  const id = ulid();
  db.run("INSERT INTO md_company (id, dart_corp_code, name_ko, created_at) VALUES (?,?,?,?)", [
    id,
    corpCode,
    nameKo,
    NOW,
  ]);
  return id;
}

beforeAll(async () => {
  await createUser(db, {
    userId: ANALYST,
    role: "analyst",
    password: "pw-identity-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-identity-12345");
  oppId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [oppId, "신원 해석 테스트 기회", "전력기기 산업", "selected", ANALYST, NOW],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// ── D1: resolveOrCreateCompany three-pass idempotent chain (design §3.3) ──
describe("D1 resolveOrCreateCompany", () => {
  test("raw-name second pass finds a legacy glossed row and normalizes its name_ko in place", () => {
    const legacyId = insertCompanyLegacy("비에이치아이(BHI)", null);
    const resolved = resolveOrCreateCompany(db, "비에이치아이(BHI)", null);
    expect(resolved).toBe(legacyId); // same row — no twin minted
    const row = db.query("SELECT name_ko, dart_corp_code FROM md_company WHERE id = ?").get(legacyId) as {
      name_ko: string;
      dart_corp_code: string | null;
    };
    expect(row.name_ko).toBe("비에이치아이"); // one-time in-place normalization
    expect(row.dart_corp_code).toBeNull();
    expect(
      (db.query("SELECT COUNT(*) AS c FROM md_company WHERE name_ko = '비에이치아이'").get() as { c: number }).c,
    ).toBe(1);
  });

  test("raw-name pass fills a NULL code but never overwrites an existing code (unique index discipline)", () => {
    const cleanId = insertCompanyLegacy("한전KPS", "00159218");
    // by-code pass misses (different code), canonical-name pass hits, fill is conditional on NULL.
    const resolved = resolveOrCreateCompany(db, "한전KPS(KEPCO KPS)", "00999999");
    expect(resolved).toBe(cleanId);
    expect(
      (db.query("SELECT dart_corp_code FROM md_company WHERE id = ?").get(cleanId) as { dart_corp_code: string })
        .dart_corp_code,
    ).toBe("00159218");
    expect((db.query("SELECT COUNT(*) AS c FROM md_company WHERE name_ko LIKE '한전%'").get() as { c: number }).c).toBe(
      1,
    );
  });

  test("by-code pass wins and the second call is idempotent through the canonical pass", () => {
    const id = insertCompanyLegacy("신원로봇", "00777777");
    expect(resolveOrCreateCompany(db, "전혀다른이름(글로스)", "00777777")).toBe(id);
    expect(resolveOrCreateCompany(db, "신원로봇", "00777777")).toBe(id);
    // no insert happened — neither the raw glossed name nor its canonical form exists as a row
    expect(
      (db.query("SELECT COUNT(*) AS c FROM md_company WHERE name_ko LIKE '전혀다른이름%'").get() as { c: number }).c,
    ).toBe(0);
  });

  test("insert always uses the canonical name", () => {
    resolveOrCreateCompany(db, "태웅(Taeung)", null);
    expect((db.query("SELECT COUNT(*) AS c FROM md_company WHERE name_ko = '태웅'").get() as { c: number }).c).toBe(1);
    expect(
      (db.query("SELECT COUNT(*) AS c FROM md_company WHERE name_ko = '태웅(Taeung)'").get() as { c: number }).c,
    ).toBe(0);
  });

  test("createTarget stores the canonical name on both brownfield_target and md_company", () => {
    const t = createTarget(oppId, "파워(Power)", null, null, { actorUserId: ANALYST });
    expect(t.company_name).toBe("파워");
    expect((db.query("SELECT COUNT(*) AS c FROM md_company WHERE name_ko = '파워'").get() as { c: number }).c).toBe(1);
  });
});

// ── D3: code-aware dedupe on the opportunity targets POST (design §5.1) ──
describe("D3 POST /targets dedupe", () => {
  test("code match dedupes to 200 with the existing row, meta deduped:true, and a dedupe audit", async () => {
    const created = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "코드후보", dart_corp_code: "00111111" }),
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as { data: { id: string } };
    const before = auditCount("brownfield_target.dedupe");

    const again = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "코드후보(재제안)", dart_corp_code: "00111111" }),
    });
    expect(again.status).toBe(200);
    const body = (await again.json()) as { data: { id: string }; meta: { deduped?: boolean } };
    expect(body.data.id).toBe(first.data.id);
    expect(body.meta.deduped).toBe(true);
    const rows = (
      db
        .query("SELECT COUNT(*) AS c FROM brownfield_target WHERE opportunity_id = ? AND dart_corp_code = '00111111'")
        .get(oppId) as { c: number }
    ).c;
    expect(rows).toBe(1); // the duplicate POST created no second row
    expect(auditCount("brownfield_target.dedupe")).toBe(before + 1);
    const audit = db
      .query("SELECT target FROM audit_log WHERE action = 'brownfield_target.dedupe' ORDER BY created_at DESC LIMIT 1")
      .get() as {
      target: string;
    };
    expect(audit.target).toBe(`${oppId}:${first.data.id}`);
  });

  test("canonical-name match dedupes a glossed re-proposal of a clean row", async () => {
    const created = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "클린후보" }),
    });
    const first = (await created.json()) as { data: { id: string } };
    const glossed = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "클린후보(Gloss)" }),
    });
    expect(glossed.status).toBe(200);
    const body = (await glossed.json()) as { data: { id: string }; meta: { deduped?: boolean } };
    expect(body.data.id).toBe(first.data.id);
    expect(body.meta.deduped).toBe(true);
  });

  test("a genuinely new candidate still registers with 201", async () => {
    const res = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "새로운후보" }),
    });
    expect(res.status).toBe(201);
  });

  test("no cross-opportunity false positive", async () => {
    const other = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
      other,
      "다른 기회",
      "전력기기 산업",
      "selected",
      ANALYST,
      NOW,
    ]);
    const res = await req(`/api/brownfield/${other}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "새로운후보" }),
    });
    expect(res.status).toBe(201);
  });

  test("an excluded target does not block re-registration", async () => {
    const created = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "제외된후보" }),
    });
    const first = (await created.json()) as { data: { id: string } };
    db.run("UPDATE brownfield_target SET status = 'excluded' WHERE id = ?", [first.data.id]);
    const res = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "제외된후보" }),
    });
    expect(res.status).toBe(201);
  });
});

// ── D3: same matrix on the target-proposals accept POST ──
describe("D3 POST /target-proposals dedupe", () => {
  test("code match dedupes to 200 + deduped meta + dedupe audit", async () => {
    const created = await req(`/api/brownfield/${oppId}/target-proposals`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        company_name: "제안코드후보",
        dart_corp_code: "00222222",
        discovery_source: "web_proposal",
      }),
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as { data: { id: string } };
    const before = auditCount("brownfield_target.dedupe");
    const again = await req(`/api/brownfield/${oppId}/target-proposals`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        company_name: "제안코드후보",
        dart_corp_code: "00222222",
        discovery_source: "web_proposal",
      }),
    });
    expect(again.status).toBe(200);
    const body = (await again.json()) as {
      data: { id: string; discovery_source: string };
      meta: { deduped?: boolean };
    };
    expect(body.data.id).toBe(first.data.id);
    expect(body.meta.deduped).toBe(true);
    expect(body.data.discovery_source).toBe("web_proposal"); // the EXISTING row's provenance
    expect(auditCount("brownfield_target.dedupe")).toBe(before + 1);
  });

  test("canonical-name match dedupes a glossed acceptance of a clean row", async () => {
    const created = await req(`/api/brownfield/${oppId}/target-proposals`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "제안클린후보" }),
    });
    const first = (await created.json()) as { data: { id: string } };
    const glossed = await req(`/api/brownfield/${oppId}/target-proposals`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "제안클린후보(Grp)" }),
    });
    expect(glossed.status).toBe(200);
    const body = (await glossed.json()) as { data: { id: string }; meta: { deduped?: boolean } };
    expect(body.data.id).toBe(first.data.id);
    expect(body.meta.deduped).toBe(true);
  });

  test("a new acceptance still returns 201 with the accept audit", async () => {
    const before = auditCount("target_proposal.accept");
    const res = await req(`/api/brownfield/${oppId}/target-proposals`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "제안새후보", discovery_source: "web_proposal" }),
    });
    expect(res.status).toBe(201);
    expect(auditCount("target_proposal.accept")).toBe(before + 1);
  });
});

// ── D3: PATCH collision → 409 + existing_target_id, no auto-merge ──
describe("D3 PATCH collision", () => {
  test("rename onto a sibling's canonical name returns 409 duplicate_target with existing_target_id and leaves the row untouched", async () => {
    const a = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "형제에이" }),
    });
    const b = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "형제비" }),
    });
    const aRow = (await a.json()) as { data: { id: string } };
    const bRow = (await b.json()) as { data: { id: string; company_name: string } };

    const res = await req(`/api/brownfield/${oppId}/targets/${bRow.data.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "형제에이(Gloss)" }),
    });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { code: string; details?: { existing_target_id?: string } } };
    expect(err.error.code).toBe("duplicate_target");
    expect(err.error.details?.existing_target_id).toBe(aRow.data.id);
    const after = db.query("SELECT company_name FROM brownfield_target WHERE id = ?").get(bRow.data.id) as {
      company_name: string;
    };
    expect(after.company_name).toBe("형제비"); // untouched — no auto-merge
  });

  test("code collision returns 409; renaming within the target's own canonical name passes", async () => {
    await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "코드형제에이", dart_corp_code: "00333333" }),
    });
    const b = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "코드형제비" }),
    });
    const bRow = (await b.json()) as { data: { id: string } };

    const codeHit = await req(`/api/brownfield/${oppId}/targets/${bRow.data.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ dart_corp_code: "00333333" }),
    });
    expect(codeHit.status).toBe(409);

    const okPatch = await req(`/api/brownfield/${oppId}/targets/${bRow.data.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "코드형제비(Gloss)" }),
    });
    expect(okPatch.status).toBe(200); // sibling scan excludes the target itself
    const body = (await okPatch.json()) as { data: { company_name: string } };
    expect(body.data.company_name).toBe("코드형제비"); // canonical of the patch input
  });
});

// ── D4: unified updateTargetFields through both PATCH routes ──
describe("D4 PATCH unification", () => {
  test("opp-keyed PATCH re-links md_company (master gains the code) and audits the composite target", async () => {
    const created = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "재링크후보(BHI)" }),
    });
    const row = (await created.json()) as { data: { id: string } };
    const masterBefore = db.query("SELECT id, dart_corp_code FROM md_company WHERE name_ko = '재링크후보'").get() as {
      id: string;
      dart_corp_code: string | null;
    };
    expect(masterBefore.dart_corp_code).toBeNull();
    const before = auditCount("brownfield_target.update");

    const res = await req(`/api/brownfield/${oppId}/targets/${row.data.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ dart_corp_code: "00409788" }),
    });
    expect(res.status).toBe(200);
    const master = db.query("SELECT dart_corp_code, name_ko FROM md_company WHERE id = ?").get(masterBefore.id) as {
      dart_corp_code: string | null;
      name_ko: string;
    };
    expect(master.dart_corp_code).toBe("00409788"); // NULL filled on the SAME row — relink, not twin
    expect(master.name_ko).toBe("재링크후보");
    const target = db.query("SELECT dart_corp_code FROM brownfield_target WHERE id = ?").get(row.data.id) as {
      dart_corp_code: string;
    };
    expect(target.dart_corp_code).toBe("00409788");
    const audit = db
      .query("SELECT target FROM audit_log WHERE action = 'brownfield_target.update' AND target = ?")
      .get(`${oppId}:${row.data.id}`);
    expect(audit).toBeTruthy(); // composite shape on BOTH routes now
    expect(auditCount("brownfield_target.update")).toBe(before + 1);
  });

  test("explicit null clears a code through the opp-keyed route (the COALESCE fix); absent key leaves it unchanged", async () => {
    const created = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "클리어후보", dart_corp_code: "00555555" }),
    });
    const row = (await created.json()) as { data: { id: string } };
    // absent key → unchanged
    const note = await req(`/api/brownfield/${oppId}/targets/${row.data.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ universe_note: "메모" }),
    });
    expect(note.status).toBe(200);
    const afterNote = db
      .query("SELECT dart_corp_code, universe_note FROM brownfield_target WHERE id = ?")
      .get(row.data.id) as {
      dart_corp_code: string;
      universe_note: string;
    };
    expect(afterNote.dart_corp_code).toBe("00555555");
    expect(afterNote.universe_note).toBe("메모");
    // explicit null → clear
    const clear = await req(`/api/brownfield/${oppId}/targets/${row.data.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ dart_corp_code: null }),
    });
    expect(clear.status).toBe(200);
    const afterClear = db.query("SELECT dart_corp_code FROM brownfield_target WHERE id = ?").get(row.data.id) as {
      dart_corp_code: string | null;
    };
    expect(afterClear.dart_corp_code).toBeNull();
  });

  test("detail PATCH regression: canonicalization + md_company relink + composite audit preserved through delegation", async () => {
    const created = await req(`/api/brownfield/${oppId}/targets`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "상세수정후보" }),
    });
    const row = (await created.json()) as { data: { id: string } };
    const res = await req(`/api/brownfield/targets/${row.data.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ company_name: "상세수정후보(Grp)", dart_corp_code: "00666666" }),
    });
    expect(res.status).toBe(200);
    const target = db
      .query("SELECT company_name, dart_corp_code FROM brownfield_target WHERE id = ?")
      .get(row.data.id) as {
      company_name: string;
      dart_corp_code: string;
    };
    expect(target.company_name).toBe("상세수정후보"); // canonicalized
    expect(target.dart_corp_code).toBe("00666666");
    const master = db.query("SELECT dart_corp_code FROM md_company WHERE name_ko = '상세수정후보'").get() as {
      dart_corp_code: string;
    };
    expect(master.dart_corp_code).toBe("00666666"); // relinked through updateTargetFields
    const audit = db
      .query("SELECT target FROM audit_log WHERE action = 'brownfield_target.update' AND target = ?")
      .get(`${oppId}:${row.data.id}`);
    expect(audit).toBeTruthy(); // composite (was bare targetId before D4)
  });
});
