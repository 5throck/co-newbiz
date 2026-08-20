// @version 1.0.0
/**
 * API token routes — docs/api-spec.md §2 (Wave 5.6A).
 *
 * Bearer credentials for MCP/CLI clients. The plaintext token appears in
 * exactly one response (POST 201) — after that only identity columns are
 * ever returned (FR-SEC-09). Revocation is owner-scoped: a token id you do
 * not own is indistinguishable from one that does not exist.
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { issueApiToken, listApiTokens, revokeApiToken } from "../../db/lib/api-tokens.ts";
import { badRequest, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv } from "./middleware.ts";

export const tokenRoutes = new Hono<AppEnv>();
tokenRoutes.use("*", requireAuth);

/** POST /api/tokens — {label, scopes?} -> plaintext returned ONCE. */
tokenRoutes.post("/api/tokens", async (c) => {
  const body = await c.req.json().catch(() => null) as { label?: string; scopes?: string[] } | null;
  if (!body?.label?.trim()) {
    return badRequest(c, "invalid_request", "label is required.");
  }
  try {
    const issued = issueApiToken(getDb(), {
      userId: c.get("auth").userId,
      label: body.label.trim(),
      scopes: body.scopes && body.scopes.length > 0 ? body.scopes : ["read"],
      now: new Date().toISOString(),
    });
    return ok(
      c,
      { token: issued.token, id: issued.id, label: body.label.trim() },
      201,
      { note: "Store this token now — it is never shown again." },
    );
  } catch (err) {
    return badRequest(c, "token_issue_failed", err instanceof Error ? err.message : "Token issue failed.");
  }
});

/** GET /api/tokens — identity columns only, hash never leaves the engine. */
tokenRoutes.get("/api/tokens", (c) => {
  return ok(c, listApiTokens(getDb(), c.get("auth").userId));
});

/** DELETE /api/tokens/:id — owner-scoped revocation. */
tokenRoutes.delete("/api/tokens/:id", (c) => {
  const a = c.get("auth");
  const id = c.req.param("id");
  const row = getDb().query("SELECT user_id FROM api_token WHERE id = ?").get(id) as { user_id: string } | null;
  if (!row || row.user_id !== a.userId) return notFound(c);
  const revoked = revokeApiToken(getDb(), { tokenId: id, revokedBy: a.userId, now: new Date().toISOString() });
  return ok(c, { ok: true, revoked });
});
