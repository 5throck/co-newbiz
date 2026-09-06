// @version 1.1.0
/**
 * Minimal ULID generator — 26-char Crockford base32, 48-bit timestamp + 80-bit randomness.
 * Used for every table's primary key per ADR-0002 (no AUTOINCREMENT, no implicit ROWID
 * dependence) — see docs/architecture/db-schema.md §12.
 *
 * v1.1.0: monotonic within the same millisecond (standard ULID monotonic-creator
 * behavior). The first id in a new millisecond seeds full 80-bit randomness (unique
 * across runs, same as v1.0.0); subsequent calls in the SAME millisecond increment
 * the randomness instead of re-randomizing, so ids are strictly increasing. This
 * fixes recency tiebreaks ordered by `decided_at DESC, id DESC` (portfolio
 * scorecard): two decisions in the same millisecond previously raced on the random
 * suffix and an earlier decision could surface as "latest".
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I/L/O/U
const RAND_BITS = 80n;
const RAND_MAX = 1n << RAND_BITS;

function encodeTime(time: number, len: number): string {
  let out = "";
  for (let i = len - 1; i >= 0; i--) {
    out = ENCODING[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function random80(): bigint {
  // two draws: 53-bit + 27-bit → full 80-bit entropy
  return (BigInt(Math.floor(Math.random() * 2 ** 53)) << 27n)
    | BigInt(Math.floor(Math.random() * 2 ** 27));
}

function randomToCrockford(value: bigint, len: number): string {
  let out = "";
  let v = value;
  for (let i = 0; i < len; i++) {
    out += ENCODING[Number(v % 32n)];
    v = v / 32n;
  }
  return out.split("").reverse().join("");
}

/** Monotonicity state: last emitted (timestamp, randomness) pair. */
let lastTime = -1;
let lastRand = 0n;

export function ulid(now: number = Date.now()): string {
  if (now !== lastTime) {
    // new millisecond: seed full randomness (unique across runs, as in v1.0.0)
    lastTime = now;
    lastRand = random80();
  } else {
    // same millisecond: increment, carrying into the next millisecond on overflow
    lastRand += 1n;
    if (lastRand >= RAND_MAX) {
      lastRand -= RAND_MAX;
      lastTime += 1;
    }
  }
  return encodeTime(lastTime, 10) + randomToCrockford(lastRand, 16);
}
