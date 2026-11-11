import { test, expect } from "bun:test";
import {
  canIssueToken,
  canIssueWriteToken,
  writeScopeNoteKey,
  remainingTokenSlots,
  TOKEN_EXPIRY_DAYS,
  TOKEN_DEFAULT_EXPIRY_DAYS,
  TOKEN_ACTIVE_CAP,
  daysRemaining,
  expiryLabel,
  isExpiringSoon,
  relativeParts,
  filterTokensByStatus,
  countByStatus,
  EXPIRING_SOON_DAYS,
} from "../../app/web-next/lib/token-issue-access.ts";
import {
  TOKEN_TTL_DAYS,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  MAX_ACTIVE_TOKENS,
  isAllowedTtl,
} from "../../db/lib/api-tokens.ts";

test("analyst and viewer may issue; admin cannot issue at all (E2); only analyst may write scope", () => {
  // E2 (design 2026-11-11-owner-decisions-intake-batch §4.2): admins can no
  // longer issue NEW tokens — read scope included. The server stays
  // authoritative (POST /api/tokens refuses with role_forbidden); this mirror
  // pins the UI gate parity only.
  for (const r of ["analyst", "viewer"]) expect(canIssueToken(r)).toBe(true);
  for (const r of ["admin", null, undefined, "x"]) expect(canIssueToken(r)).toBe(false);
  expect(canIssueWriteToken("analyst")).toBe(true);
  for (const r of ["viewer", "admin", null]) expect(canIssueWriteToken(r)).toBe(false);
});
test("write notes are role-specific", () => {
  expect(writeScopeNoteKey("viewer")).toBe("writeNoteViewer");
  // The admin branch is dead copy after the E2 form gate — the mirror returns
  // null and the connected-apps page shows the noIssueAdmin note instead.
  expect(writeScopeNoteKey("admin")).toBeNull();
  expect(writeScopeNoteKey("analyst")).toBeNull();
});
test("client constants mirror the server", () => {
  expect([...TOKEN_EXPIRY_DAYS]).toEqual([...TOKEN_TTL_DAYS]);
  for (const d of TOKEN_EXPIRY_DAYS) expect(isAllowedTtl(d)).toBe(true);
  expect(TOKEN_DEFAULT_EXPIRY_DAYS).toBe(DEFAULT_TTL_DAYS);
  expect(TOKEN_ACTIVE_CAP).toBe(MAX_ACTIVE_TOKENS);
});
test("remaining slots clamp at zero", () => {
  expect(remainingTokenSlots(2)).toBe(3);
  expect(remainingTokenSlots(9)).toBe(0);
});

test("180 days is an allowed TTL and the maximum on both sides", () => {
  expect(TOKEN_EXPIRY_DAYS).toContain(180);
  expect(isAllowedTtl(180)).toBe(true);
  expect(isAllowedTtl(181)).toBe(false);
  expect(Math.max(...TOKEN_EXPIRY_DAYS)).toBe(180);
  expect(MAX_TTL_DAYS).toBe(180);
});

const NOW = Date.parse("2026-10-29T00:00:00.000Z");
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

test("daysRemaining rounds up and handles null", () => {
  expect(daysRemaining(inDays(5), NOW)).toBe(5);
  expect(daysRemaining(new Date(NOW + 2 * 3_600_000).toISOString(), NOW)).toBe(1);
  expect(daysRemaining(inDays(-1), NOW)).toBe(-1);
  expect(daysRemaining(null, NOW)).toBeNull();
});

test("expiryLabel: D-n for active, expired, none for revoked/no expiry", () => {
  expect(expiryLabel("active", inDays(30), NOW)).toEqual({ kind: "days", days: 30 });
  expect(expiryLabel("expired", inDays(-3), NOW)).toEqual({ kind: "expired" });
  expect(expiryLabel("active", inDays(-1), NOW)).toEqual({ kind: "expired" });
  expect(expiryLabel("revoked", inDays(10), NOW)).toEqual({ kind: "none" });
  expect(expiryLabel("active", null, NOW)).toEqual({ kind: "none" });
});

test("isExpiringSoon: only active tokens within 7 days", () => {
  expect(EXPIRING_SOON_DAYS).toBe(7);
  expect(isExpiringSoon("active", inDays(7), NOW)).toBe(true);
  expect(isExpiringSoon("active", inDays(8), NOW)).toBe(false);
  expect(isExpiringSoon("active", inDays(-1), NOW)).toBe(false);
  expect(isExpiringSoon("expired", inDays(3), NOW)).toBe(false);
  expect(isExpiringSoon("revoked", inDays(3), NOW)).toBe(false);
  expect(isExpiringSoon("active", null, NOW)).toBe(false);
});

test("relativeParts picks minute/hour/day and null under a minute", () => {
  expect(relativeParts(new Date(NOW - 30_000).toISOString(), NOW)).toBeNull();
  expect(relativeParts(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toEqual({ value: -5, unit: "minute" });
  expect(relativeParts(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toEqual({ value: -3, unit: "hour" });
  expect(relativeParts(new Date(NOW - 4 * 86_400_000).toISOString(), NOW)).toEqual({ value: -4, unit: "day" });
});

test("status filter and counts", () => {
  const rows = [
    { status: "active" as const },
    { status: "expired" as const },
    { status: "revoked" as const },
    { status: "active" as const },
  ];
  expect(filterTokensByStatus(rows, "all")).toHaveLength(4);
  const dated = [
    { status: "active" as const, expires_at: inDays(3) },
    { status: "active" as const, expires_at: inDays(30) },
    { status: "revoked" as const, expires_at: inDays(3) },
  ];
  expect(filterTokensByStatus(dated, "expiring", NOW)).toEqual([{ status: "active", expires_at: inDays(3) }]);
  expect(filterTokensByStatus(rows, "active")).toHaveLength(2);
  expect(filterTokensByStatus(rows, "revoked")).toHaveLength(1);
  expect(countByStatus(rows)).toEqual({ active: 2, expired: 1, revoked: 1 });
});
