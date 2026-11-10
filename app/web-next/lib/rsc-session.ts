// RSC session resolution (D5/B-2, design 2026-11-11-admin-security-and-board-fixes
// §7) — the Server Component counterpart of app/web-next/lib/auth.ts's
// Route-Handler gate. Server pages cannot read a Request object, so the
// session cookie comes from next/headers' cookies() and the token is resolved
// with db/lib/accounts.ts's validateSession UNCHANGED (same session lifecycle,
// same audit trail — the lib/auth.ts header rule).
//
// Server-only module: imports next/headers and the bun:sqlite-backed client,
// neither of which may enter a client bundle. Read-only — no DB writes; a
// session-less visit returns null and the caller renders its unauthenticated
// fallback instead of failing.
import { cookies } from "next/headers";
import { getDb } from "../../../db/client.ts";
import { validateSession, type ValidSession } from "../../../db/lib/accounts.ts";
import { SESSION_COOKIE } from "./auth.ts";

/** Cookie-store shape of next/headers' cookies() — narrowed for injectable tests. */
export interface CookieStoreLike {
  get(name: string): { value: string } | undefined;
}

/** Resolve the RSC session from an explicit cookie store (test seam). */
export function sessionFromCookieStore(store: CookieStoreLike): ValidSession | null {
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(getDb(), token, new Date().toISOString());
}

/** The one call a server page makes — async because Next 16 cookies() is async. */
export async function getRscSession(): Promise<ValidSession | null> {
  return sessionFromCookieStore(await cookies());
}
