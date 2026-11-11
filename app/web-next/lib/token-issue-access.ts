// UI mirror of POST /api/tokens role rules (server stays authoritative):
// admins can no longer issue NEW tokens at all (E2, design
// 2026-11-11-owner-decisions-intake-batch §4.2 — read scope included);
// analyst and viewer may still issue read tokens, and only analyst may add
// the write scope (viewer loses 'write' at issue and at validation; an
// EXISTING admin token stays valid until expiry — validateApiToken is
// untouched). Constants mirror db/lib/api-tokens.ts (that module pulls
// node:crypto, so it is not importable from a client bundle); a unit test
// pins the parity.

export type TokenIssueRole = "analyst" | "viewer" | "admin";

export function canIssueToken(role: string | null | undefined): boolean {
  return role === "analyst" || role === "viewer";
}

export function canIssueWriteToken(role: string | null | undefined): boolean {
  return role === "analyst";
}

/** Catalog key (pages.connectedApps.*) for the role-correct write-scope explanation, or null. */
export function writeScopeNoteKey(role: string | null | undefined): "writeNoteViewer" | null {
  if (role === "viewer") return "writeNoteViewer";
  return null;
}

export const TOKEN_EXPIRY_DAYS: readonly number[] = [7, 30, 90, 180];
export const TOKEN_DEFAULT_EXPIRY_DAYS = 30;
export const TOKEN_ACTIVE_CAP = 5;

export function remainingTokenSlots(activeCount: number): number {
  return Math.max(0, TOKEN_ACTIVE_CAP - activeCount);
}

// ── 목록 표시 헬퍼 (순수 함수, 단위 테스트 대상) ─────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

/** 만료까지 이 일수 이하로 남은 활성 토큰에 "곧 만료" 경고를 붙인다. */
export const EXPIRING_SOON_DAYS = 7;

export type TokenStatus = "active" | "expired" | "revoked";
export type TokenStatusFilter = "all" | "expiring" | TokenStatus;

/** Whole days left, rounded up (a token expiring in 2h still shows D-1). Negative/zero → expired. */
export function daysRemaining(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - nowMs) / DAY_MS);
}

export type ExpiryLabel = { kind: "none" } | { kind: "expired" } | { kind: "days"; days: number };

/** What the "D-n" badge shows for a token. Revoked tokens show nothing. */
export function expiryLabel(status: TokenStatus, expiresAt: string | null | undefined, nowMs: number): ExpiryLabel {
  if (status === "revoked") return { kind: "none" };
  const d = daysRemaining(expiresAt, nowMs);
  if (d === null) return { kind: "none" };
  if (status === "expired" || d <= 0) return { kind: "expired" };
  return { kind: "days", days: d };
}

export function isExpiringSoon(status: TokenStatus, expiresAt: string | null | undefined, nowMs: number): boolean {
  if (status !== "active") return false;
  const d = daysRemaining(expiresAt, nowMs);
  return d !== null && d > 0 && d <= EXPIRING_SOON_DAYS;
}

export interface RelativeParts {
  value: number;
  unit: "minute" | "hour" | "day";
}

/** Negative `value` = in the past, for Intl.RelativeTimeFormat. Null when under a minute. */
export function relativeParts(iso: string, nowMs: number): RelativeParts | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = Math.max(0, nowMs - t);
  if (diff < 60_000) return null;
  if (diff < 3_600_000) return { value: -Math.floor(diff / 60_000), unit: "minute" };
  if (diff < DAY_MS) return { value: -Math.floor(diff / 3_600_000), unit: "hour" };
  return { value: -Math.floor(diff / DAY_MS), unit: "day" };
}

/** "active" shows live tokens; "all" shows everything; revoked/expired rows are the collapsible tail. */
export function filterTokensByStatus<T extends { status: TokenStatus; expires_at?: string | null }>(
  tokens: T[],
  filter: TokenStatusFilter,
  nowMs: number = Date.now(),
): T[] {
  if (filter === "all") return tokens;
  if (filter === "expiring") return tokens.filter((x) => isExpiringSoon(x.status, x.expires_at, nowMs));
  return tokens.filter((x) => x.status === filter);
}

export function countByStatus<T extends { status: TokenStatus }>(tokens: T[]): Record<TokenStatus, number> {
  const out: Record<TokenStatus, number> = { active: 0, expired: 0, revoked: 0 };
  for (const x of tokens) out[x.status] += 1;
  return out;
}
