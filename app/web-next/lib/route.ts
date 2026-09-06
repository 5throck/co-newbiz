// Route handler wrapper — converts uncaught errors into the standard
// {data, meta, error} envelope (api-spec §9) instead of Next's default
// HTML 500, which lib/api.ts and the MCP REST layer cannot parse.
import { fail } from "./envelope.ts";

export function route<Ctx>(handler: (request: Request, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      console.error("[api] unhandled route error:", err);
      return fail(500, "internal_error", err instanceof Error ? err.message : "Internal server error.");
    }
  };
}
