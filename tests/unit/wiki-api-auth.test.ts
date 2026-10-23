// @version 1.0.0
/**
 * 위키 읽기 경로의 401 가드(2026-10-23 위키 인앱 뷰어 설계 D7) — /api/wiki,
 * /api/wiki/[slug], /api/wiki/images/[file] 세 표면 모두 authenticate()가
 * 먼저다. 비인증 요청은 401 봉투, 로그인 사용자는 통과한다(AdminGuard 없음 —
 * 최하 역할 viewer도 읽는 안내서다). 이미지 경로는 <img>가 세션 쿠키로 인증에
 * 성립하는지(같은 쿠키 경로) 함께 핀다. 실제 Route Handler를
 * nextRequest()로 기동한다(tests/unit/api.test.ts와 같은 집 세대 규약).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wiki-api-auth.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let viewerCookie: string;
let readToken: string;

beforeAll(async () => {
  await createUser(db, { userId: "bob", role: "viewer", password: "pw-bob-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "bob", approvedBy: "test", now: NOW });
  // createUser는 must_change_password=1로 심는다 — 세션 제약 해제(api.test.ts 규약).
  db.run("UPDATE app_user SET must_change_password = 0");
  viewerCookie = await loginCookie("bob", "pw-bob-123456");
  const tokenRes = await req("/api/tokens", {
    method: "POST",
    headers: { cookie: viewerCookie },
    body: JSON.stringify({ label: "wiki-guard", scopes: ["read"] }),
  });
  readToken = (await tokenRes.json()).data.token as string;
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

describe("wiki read routes require authentication (design D7)", () => {
  const SURFACES = ["/api/wiki", "/api/wiki/Home", "/api/wiki/images/common-01-login.png"] as const;

  for (const path of SURFACES) {
    test(`${path}: unauthenticated -> 401 unauthorized`, async () => {
      const res = await req(path);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    });
  }

  test("a viewer session (lowest role, no AdminGuard) reads index, page and capture image", async () => {
    const index = await req("/api/wiki", { headers: { cookie: viewerCookie } });
    expect(index.status).toBe(200);
    const indexBody = await index.json();
    expect(indexBody.data.pages.length).toBeGreaterThan(0);
    expect(indexBody.data.groups.length).toBeGreaterThan(0);

    const page = await req("/api/wiki/Home", { headers: { cookie: viewerCookie } });
    expect(page.status).toBe(200);
    expect((await page.json()).data.slug).toBe("Home");

    const img = await req("/api/wiki/images/common-01-login.png", { headers: { cookie: viewerCookie } });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
  });

  test("a read-scoped Bearer token also passes (D7 — same authenticate)", async () => {
    const res = await req("/api/wiki", { headers: { authorization: `Bearer ${readToken}` } });
    expect(res.status).toBe(200);
  });

  test("unknown slug is 404 (not 401) once authenticated — allowlist contract (D3)", async () => {
    const res = await req("/api/wiki/없는-문서", { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("percent-encoded slug resolution (2026-10-23 double-encoding defect)", () => {
  // 실측 결함: 클라이언트가 이미 인코딩된 useParams 값을 encodeURIComponent로
  // 한 번 더 싸서(%25EA…) 이중 인코딩 URL로 조회 → 핸들러가 인코딩 문자열을 그대로
  // 받아 키 집합 조회 실패(404). 핸들러의 방어적 해제로 인코딩·원값 모두 성립한다.
  const RAW = "31-공통-S9-실사";
  const ONCE = "31-%EA%B3%B5%ED%86%B5-S9-%EC%8B%A4%EC%82%AC"; // 정상 클라이언트(한 번 인코딩) URL 꼴
  const TWICE = "31-%25EA%25B3%25B5%25ED%2586%25B5-S9-%25EC%258B%25A4%25EC%2582%25AC"; // 결함 클라이언트(이중 인코딩) URL 꼴

  test("single-encoded URL resolves the page (dispatcher decodes, handler decode is a no-op)", async () => {
    const res = await req(`/api/wiki/${ONCE}`, { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.slug).toBe(RAW);
  });

  test("double-encoded URL also resolves — the handler received the once-encoded segment (the measured 404 scenario)", async () => {
    const res = await req(`/api/wiki/${TWICE}`, { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.slug).toBe(RAW);
  });

  test("raw Korean slug still resolves after the defensive decode", async () => {
    const res = await req(`/api/wiki/${RAW}`, { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.slug).toBe(RAW);
  });

  test("malformed % sequence is 404 not_found, never a thrown 500", async () => {
    // %25zz → 디스패처 해제 후 핸들러가 "%zz"를 받는다 — decodeURIComponent가
    // 던지는 URIError는 원값 통과로 흡수되고, 없는 슬러그는 404 봉투로 내려간다.
    const res = await req("/api/wiki/%25zz", { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("encoded image file name resolves through the same defensive decode (D4 allowlist intact)", async () => {
    // 허용목록은 ASCII지만 세그먼트가 인코딩된 채 도달하는 꼴에서도 같은 이름으로 성립한다.
    const res = await req("/api/wiki/images/common-01-login.png", { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const encoded = await req("/api/wiki/images/common%2D01%2Dlogin%2Epng", { headers: { cookie: viewerCookie } });
    expect(encoded.status).toBe(200);
    expect(encoded.headers.get("content-type")).toBe("image/png");
  });
});
