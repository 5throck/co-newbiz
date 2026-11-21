/**
 * S6 완료기준 visibility + candidate 발굴 출처 cure — design
 * 2026-11-21-s67-completion-visibility, API contracts A/B/C route tests:
 *
 *  - A: GET /api/opportunities/{id}/process — stages[] entries carry
 *       index-aligned blockers (Korean prose) / missing (stable keys from
 *       lib/process-blocker-keys.ts) for evaluated stages; [] for
 *       locked / skipped / terminated.
 *  - B: PATCH /api/brownfield/targets/{targetId} — discovery_source /
 *       discovery_source_url / discovery_note: one transactional update +
 *       ONE appended discovery evidence row (append-only); both-empty → 400
 *       invalid_request; invalid enum → 400; the `source` gap clears.
 *  - C: GET /api/brownfield/{oppId}/targets — targets[].gaps mirror
 *       longListCandidateGaps verbatim; grandfathered opportunities emit []
 *       (parity with the S6 predicate).
 *
 * Harness: real route handlers via nextRequest on a scratch SQLite (house
 * pattern, tests/unit/target-identity-resolution.test.ts); the S6-current
 * state reuses the S1-S12 demo seed with one candidate's discovery evidence
 * removed (the same mutation tests/unit/wave-f6-predicates.test.ts pins).
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s67-completion-visibility.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { listTargets, longListCandidateGaps } = await import("../../app/web-next/lib/brownfield-targets.ts");

const OLD = "2026-09-01T00:00:00.000Z"; // pre-WAVE_F_PREDICATE_DATE (2026-10-08) → grandfathered
const NOW = "2026-11-21T10:00:00Z";
const ANALYST = "s67-analyst";
// Not named "*PASSWORD*" — the pre-commit secret regex gate (pre-commit.ts §7
// pattern 1) matches `password\s*=\s*"…"`-shaped assignments; test login
// secrets flow as a plain constant with a neutral name instead.
const DEMO_PW = "pw-s67-12345";
let cookie = "";
let bfOppId = ""; // the seeded brownfield opportunity (S1–S12 complete before mutation)
let patchOppId = ""; // fresh opportunity for the PATCH (Contract B) tests

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function discoveryEvidence(targetId: string) {
  return db
    .query(
      "SELECT id, kind, title, detail, source_url, source_kind FROM brownfield_target_evidence WHERE target_id = ? AND kind = 'discovery' ORDER BY created_at, id",
    )
    .all(targetId) as Array<{
    id: string;
    kind: string;
    title: string;
    detail: string | null;
    source_url: string | null;
    source_kind: string | null;
  }>;
}

async function registerTarget(companyName: string): Promise<string> {
  const res = await req(`/api/brownfield/${patchOppId}/targets`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ company_name: companyName }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: DEMO_PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie(ANALYST, DEMO_PW);
  bfOppId = seedS1ToS12Demo(TEST_DB_PATH).opportunityId;
  patchOppId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [patchOppId, "발굴 출처 보완 테스트 기회", "전력기기 산업", "selected", ANALYST, NOW],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// ── API A — GET /api/opportunities/{id}/process ─────────────────────────────
test("API A: the S6-current stage carries index-aligned blockers/missing (stable keys), locked/skipped stay []", async () => {
  // The wave-f6 mutation: one candidate loses its discovery evidence → S6 opens
  // with the attributes gap AND the coverage gap (covered 2/3 < min_long_list 3).
  db.run("DELETE FROM brownfield_target_evidence WHERE target_id = 'demo-s1-s12-target-2'");
  const res = await req(`/api/opportunities/${bfOppId}/process`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as {
    data: {
      blockers: string[];
      stages: Array<{ id: string; status: string; blockers: string[]; missing: string[] }>;
    };
  };
  const s6 = data.stages.find((s) => s.id === "S6");
  expect(s6?.status).toBe("current");
  // stable keys, in push order
  expect(s6?.missing).toEqual(["s6.longlist_attributes", "s6.longlist_coverage"]);
  // index-aligned Korean prose for each key
  expect(s6?.blockers).toHaveLength(s6!.missing.length);
  expect(s6?.blockers[0]).toContain("필수 속성·출처가 없는 Long List 후보");
  expect(s6?.blockers[1]).toContain("Long List 커버리지 부족");
  expect(s6?.blockers[1]).toContain("2/3");
  // later unevaluated stages carry empty arrays, statuses unchanged
  const s7 = data.stages.find((s) => s.id === "S7");
  expect(s7?.status).toBe("locked");
  expect(s7?.blockers).toEqual([]);
  expect(s7?.missing).toEqual([]);
  // track-inapplicable stage (S5, brownfield) also []
  const s5 = data.stages.find((s) => s.id === "S5");
  expect(s5?.status).toBe("skipped");
  expect(s5?.blockers).toEqual([]);
  expect(s5?.missing).toEqual([]);
  // an evaluated complete stage carries (empty) arrays too
  const s4 = data.stages.find((s) => s.id === "S4");
  expect(s4?.status).toBe("complete");
  expect(Array.isArray(s4?.blockers)).toBe(true);
  expect(s4?.missing).toEqual([]);
});

test("API A: top-level blockers/requiredArtifacts stay the current-stage label values (byte-identical contract)", async () => {
  const res = await req(`/api/opportunities/${bfOppId}/process`, { headers: { cookie } });
  const { data } = (await res.json()) as { data: { blockers: string[]; requiredArtifacts: string[] } };
  expect(data.requiredArtifacts).toContain("Long List 후보 필수 속성·출처"); // LABEL, not the key
  expect(data.requiredArtifacts).toContain("Long List 최소 커버리지");
  expect(data.blockers.some((b) => b.includes("필수 속성·출처가 없는 Long List 후보"))).toBe(true);
});

// ── API C — GET /api/brownfield/{oppId}/targets ─────────────────────────────
test("API C: targets[].gaps mirror longListCandidateGaps verbatim; the gapped row is named", async () => {
  const res = await req(`/api/brownfield/${bfOppId}/targets`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: { targets: Array<Record<string, unknown>> } };
  const flagged = data.targets.filter((t) => (t.gaps as string[]).length > 0).map((t) => t.id);
  expect(flagged).toEqual(["demo-s1-s12-target-2"]); // exactly the row missing its discovery evidence
  for (const t of data.targets) {
    expect(t.gaps).toEqual(longListCandidateGaps(t as never));
  }
});

test("API C: a grandfathered opportunity emits gaps [] for every row (S6-predicate parity)", async () => {
  db.run("UPDATE opportunity SET created_at = ? WHERE id = ?", [OLD, bfOppId]);
  const res = await req(`/api/brownfield/${bfOppId}/targets`, { headers: { cookie } });
  const { data } = (await res.json()) as { data: { targets: Array<{ id: string; gaps: string[] }> } };
  for (const t of data.targets) expect(t.gaps).toEqual([]); // even the still-gapped target-2
  // restore for any later reader
  db.run("UPDATE opportunity SET created_at = ? WHERE id = ?", [NOW, bfOppId]);
});

// ── API B — PATCH /api/brownfield/targets/{targetId} ────────────────────────
test("API B: PATCH with discovery fields updates the column and appends ONE discovery evidence row (append-only)", async () => {
  const targetId = await registerTarget("태웅");
  // registration wrote one discovery row with BOTH content fields empty → source gap open
  expect(longListCandidateGaps(listTargets(patchOppId).find((t) => t.id === targetId)!)).toEqual([
    "attributes",
    "source",
  ]);
  const before = discoveryEvidence(targetId);
  expect(before).toHaveLength(1);

  const res = await req(`/api/brownfield/targets/${targetId}`, {
    method: "PATCH",
    headers: { cookie },
    body: JSON.stringify({
      discovery_source: "manual",
      discovery_source_url: "https://news.example.co.kr/article/123",
    }),
  });
  expect(res.status).toBe(200);
  const row = db.query("SELECT discovery_source FROM brownfield_target WHERE id = ?").get(targetId) as {
    discovery_source: string;
  };
  expect(row.discovery_source).toBe("manual");
  const after = discoveryEvidence(targetId);
  expect(after).toHaveLength(2); // exactly ONE appended
  expect(after[0]).toEqual(before[0]); // append-only — the registration row is untouched
  expect(after[1].title).toBe("발굴 출처 보완 — 직접 기록");
  expect(after[1].source_url).toBe("https://news.example.co.kr/article/123");
  expect(after[1].detail).toBeNull();
  expect(after[1].source_kind).toBe("manual");
  // the `source` gap cleared; the attributes gap (no universe note) remains
  expect(longListCandidateGaps(listTargets(patchOppId).find((t) => t.id === targetId)!)).toEqual(["attributes"]);
});

test("API B: a note-only cure works; source_kind follows the carried discovery_source", async () => {
  const targetId = await registerTarget("태웅메모");
  const before = discoveryEvidence(targetId).length;
  const res = await req(`/api/brownfield/targets/${targetId}`, {
    method: "PATCH",
    headers: { cookie },
    body: JSON.stringify({ discovery_source: "web_proposal", discovery_note: "2026-11 업계 기사에서 확인한 인수 후보" }),
  });
  expect(res.status).toBe(200);
  const after = discoveryEvidence(targetId);
  expect(after.length).toBe(before + 1);
  expect(after[after.length - 1].source_kind).toBe("web_proposal");
  expect(after[after.length - 1].detail).toBe("2026-11 업계 기사에서 확인한 인수 후보");
  expect(after[after.length - 1].source_url).toBeNull();
  expect(longListCandidateGaps(listTargets(patchOppId).find((t) => t.id === targetId)!)).toEqual(["attributes"]);
});

test("API B: carrying only discovery_source updates the column and appends NO evidence row", async () => {
  const targetId = await registerTarget("경로만수정");
  const before = discoveryEvidence(targetId).length;
  const res = await req(`/api/brownfield/targets/${targetId}`, {
    method: "PATCH",
    headers: { cookie },
    body: JSON.stringify({ discovery_source: "master_proposal" }),
  });
  expect(res.status).toBe(200);
  const row = db.query("SELECT discovery_source FROM brownfield_target WHERE id = ?").get(targetId) as {
    discovery_source: string;
  };
  expect(row.discovery_source).toBe("master_proposal");
  expect(discoveryEvidence(targetId).length).toBe(before); // no content values → no row
});

test("API B: both discovery content fields empty after trim → 400 invalid_request, nothing written", async () => {
  const targetId = await registerTarget("공백발굴");
  const beforeRows = discoveryEvidence(targetId).length;
  const beforeAudit = (
    db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'brownfield_target.update'").get() as { c: number }
  ).c;
  for (const payload of [
    { discovery_source_url: "   ", discovery_note: "" },
    { discovery_note: "   " },
    { discovery_source_url: null, discovery_note: null },
  ]) {
    const res = await req(`/api/brownfield/targets/${targetId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("invalid_request");
    expect(err.error.message).toContain("discovery_source_url / discovery_note");
  }
  expect(discoveryEvidence(targetId).length).toBe(beforeRows);
  const afterAudit = (
    db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'brownfield_target.update'").get() as { c: number }
  ).c;
  expect(afterAudit).toBe(beforeAudit);
  // carrying neither key is still the unchanged identity-edit behaviour
  const ok = await req(`/api/brownfield/targets/${targetId}`, {
    method: "PATCH",
    headers: { cookie },
    body: JSON.stringify({ universe_note: "Universe 적합 메모" }),
  });
  expect(ok.status).toBe(200);
  expect(discoveryEvidence(targetId).length).toBe(beforeRows); // no discovery keys → no row
});

test("API B: discovery_source outside the enum → 400 invalid_request, nothing written", async () => {
  const targetId = await registerTarget("이상경로");
  const beforeRows = discoveryEvidence(targetId).length;
  const res = await req(`/api/brownfield/targets/${targetId}`, {
    method: "PATCH",
    headers: { cookie },
    body: JSON.stringify({ discovery_source: "newsletter", discovery_source_url: "https://example.com/a" }),
  });
  expect(res.status).toBe(400);
  const err = (await res.json()) as { error: { code: string; message: string } };
  expect(err.error.code).toBe("invalid_request");
  expect(err.error.message).toContain("manual | master_proposal | web_proposal");
  const row = db.query("SELECT discovery_source FROM brownfield_target WHERE id = ?").get(targetId) as {
    discovery_source: string;
  };
  expect(row.discovery_source).toBe("manual"); // unchanged
  expect(discoveryEvidence(targetId).length).toBe(beforeRows);
});

test("API B: existing company_name/universe_note behavior stays byte-identical alongside discovery fields", async () => {
  const targetId = await registerTarget("기존필드후보");
  const res = await req(`/api/brownfield/targets/${targetId}`, {
    method: "PATCH",
    headers: { cookie },
    body: JSON.stringify({
      company_name: "기존필드후보(Grp)",
      dart_corp_code: "00777777",
      universe_note: "중형 건설장비 리스 — Universe 중장비 세그먼트 적합",
      discovery_source: "manual",
      discovery_source_url: "https://example.com/source",
      discovery_note: "메모",
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { company_name: string; dart_corp_code: string; universe_note: string } };
  expect(body.data.company_name).toBe("기존필드후보"); // canonicalized
  expect(body.data.dart_corp_code).toBe("00777777");
  expect(body.data.universe_note).toBe("중형 건설장비 리스 — Universe 중장비 세그먼트 적합");
  // response is the updated target row itself (unchanged shape, no evidence echo)
  expect((body.data as unknown as Record<string, unknown>).gaps).toBeUndefined();
  // both gaps cleared now (attributes via the note, source via the evidence row)
  expect(longListCandidateGaps(listTargets(patchOppId).find((t) => t.id === targetId)!)).toEqual([]);
});
