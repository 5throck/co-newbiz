// @version 1.0.0
/**
 * Minimal ULID generator — 26-char Crockford base32, 48-bit timestamp + 80-bit randomness.
 * Used for every table's primary key per ADR-0002 (no AUTOINCREMENT, no implicit ROWID
 * dependence) — see docs/architecture/db-schema.md §12.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I/L/O/U

function encodeTime(time: number, len: number): string {
  let out = "";
  for (let i = len - 1; i >= 0; i--) {
    out = ENCODING[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function encodeRandom(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ENCODING[Math.floor(Math.random() * 32)];
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now, 10) + encodeRandom(16);
}
