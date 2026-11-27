// Post-login landing resolution for the `/` redirect stub (ADR-0091
// role–screen split). The admin role uses only the admin console (its
// sidebar never shows the business screens), so an admin's landing screen
// is the 시스템 대시보드 (/admin); every other role — and an
// unauthenticated visit, which /deals handles through its own gate —
// lands on the 검토/안건 보드 (/deals), the 2026-09-14 single landing
// screen. Pure and side-effect-free: the page (app/page.tsx) owns the
// session read and the redirect; deep links (`next`) never reach `/`
// because the login page pushes to `next` before this resolves.
import type { UserRole } from "../../../db/lib/accounts.ts";

/** The two landing screens a `/` visit may resolve to. */
export type LandingPath = "/admin" | "/deals";

/**
 * Role → landing path. `admin` is the only admin-console role
 * (db/lib/accounts.ts UserRole; /admin/** is guarded to exactly this role
 * by components/AdminGuard.tsx), so the mapping is a single equality:
 * admin → /admin, analyst | viewer | null (unauthenticated) → /deals.
 */
export function resolveLandingPath(role: UserRole | null): LandingPath {
  return role === "admin" ? "/admin" : "/deals";
}
