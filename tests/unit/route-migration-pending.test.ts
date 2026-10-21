// route() wrapper (2026-10-21): a schema-drift error ("no such table/column")
// is the dev server outliving a migration — it must come back as a readable
// 503 migration_pending envelope, never Next's HTML 500 that lib/api.ts can
// only render as "서버 응답이 비어 있거나 손상되었습니다".
import { describe, expect, test } from "bun:test";
import { MIGRATION_PENDING_MESSAGE, route } from "../../app/web-next/lib/route.ts";

describe("route() error envelopes", () => {
  test("no such table → 503 migration_pending with the restart/migrate guidance", async () => {
    const handler = route(async () => { throw new Error("no such table: risk_assessment_ledger"); });
    const res = await handler(new Request("http://x/api/test"), {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("migration_pending");
    expect(body.error.message).toContain(MIGRATION_PENDING_MESSAGE);
    expect(body.error.message).toContain("risk_assessment_ledger");
  });

  test("no such column → 503 as well; any other error stays a 500 internal_error", async () => {
    const col = route(async () => { throw new Error("no such column: evidence_kind"); });
    expect((await col(new Request("http://x/api/test"), {})).status).toBe(503);
    const other = route(async () => { throw new Error("boom"); });
    const res = await other(new Request("http://x/api/test"), {});
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("internal_error");
  });
});
