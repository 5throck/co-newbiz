// UI mirror of POST /api/tokens role rules (server stays authoritative):
// every signed-in human-session role may issue read tokens; only analyst may
// add the write scope (viewer/admin lose 'write' at issue and at validation).
// Constants mirror db/lib/api-tokens.ts (that module pulls node:crypto, so it
// is not importable from a client bundle); a unit test pins the parity.

export type TokenIssueRole = "analyst" | "viewer" | "admin";

export function canIssueToken(role: string | null | undefined): boolean {
  return role === "analyst" || role === "viewer" || role === "admin";
}

export function canIssueWriteToken(role: string | null | undefined): boolean {
  return role === "analyst";
}

/** Catalog key (pages.connectedApps.*) for the role-correct write-scope explanation, or null. */
export function writeScopeNoteKey(role: string | null | undefined): "writeNoteViewer" | "writeNoteAdmin" | null {
  if (role === "viewer") return "writeNoteViewer";
  if (role === "admin") return "writeNoteAdmin";
  return null;
}

export const TOKEN_EXPIRY_DAYS: readonly number[] = [7, 30, 90];
export const TOKEN_DEFAULT_EXPIRY_DAYS = 30;
export const TOKEN_ACTIVE_CAP = 5;

export function remainingTokenSlots(activeCount: number): number {
  return Math.max(0, TOKEN_ACTIVE_CAP - activeCount);
}
