// Route handler wrapper — converts uncaught errors into the standard
// {data, meta, error} envelope (api-spec §9) instead of Next's default
// HTML 500, which lib/api.ts and the MCP REST layer cannot parse.
//
// 2026-10-21: a schema error ("no such table/column") means the database is
// behind the code — the dev server applies migrations only at boot, so a
// server that outlived a migration answers every new-table read with an
// opaque 500. Name the cause and the fix instead (503 migration_pending).
import { fail } from "./envelope.ts";

const SCHEMA_DRIFT = /no such (table|column)/i;

export const MIGRATION_PENDING_MESSAGE =
  "데이터베이스 마이그레이션이 적용되지 않았습니다 — dev 서버를 재시작하거나 bun run db:migrate 를 실행하세요.";

export function route<Ctx>(handler: (request: Request, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      console.error("[api] unhandled route error:", err);
      const message = err instanceof Error ? err.message : "Internal server error.";
      if (SCHEMA_DRIFT.test(message)) return fail(503, "migration_pending", `${MIGRATION_PENDING_MESSAGE} (${message})`);
      return fail(500, "internal_error", message);
    }
  };
}
