import { test, expect } from "bun:test";
import {
  canIssueToken, canIssueWriteToken, writeScopeNoteKey, remainingTokenSlots,
  TOKEN_EXPIRY_DAYS, TOKEN_DEFAULT_EXPIRY_DAYS, TOKEN_ACTIVE_CAP,
} from "../../app/web-next/lib/token-issue-access.ts";
import { TOKEN_TTL_DAYS, DEFAULT_TTL_DAYS, MAX_ACTIVE_TOKENS, isAllowedTtl } from "../../db/lib/api-tokens.ts";

test("every human-session role may issue; only analyst may write scope", () => {
  for (const r of ["analyst", "viewer", "admin"]) expect(canIssueToken(r)).toBe(true);
  for (const r of [null, undefined, "x"]) expect(canIssueToken(r)).toBe(false);
  expect(canIssueWriteToken("analyst")).toBe(true);
  for (const r of ["viewer", "admin", null]) expect(canIssueWriteToken(r)).toBe(false);
});
test("write notes are role-specific", () => {
  expect(writeScopeNoteKey("viewer")).toBe("writeNoteViewer");
  expect(writeScopeNoteKey("admin")).toBe("writeNoteAdmin");
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
