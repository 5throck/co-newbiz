// Login failed-attempt throttle (design 2026-11-11-admin-security-and-board-fixes
// §6, item SR3-min). The throttle key is the RIGHTMOST non-empty entry of
// X-Forwarded-For — the hop appended by the trusted edge proxy. Client-injected
// entries sit LEFT of it, so a client can prepend arbitrary values without
// shifting its own bucket (the previous leftmost keying let a spoofed entry
// mint a fresh bucket per request). The login route must also serve behind
// non-Cloudflare proxies where only XFF exists, so it keys on XFF and does NOT
// use CF-Connecting-IP — a divergence from lib/register-rate-limit.ts, which
// keys on CF-Connecting-IP and ignores XFF entirely; both sides carry a note.
//
// Accepted-for-now (design §6 / DEC-20261111-02 follow-up): the map is
// in-memory and resets on server restart — a restart clears an offender's
// window. The durable-store swap is the §13 follow-up ADR item, to land for
// the login and register throttles together.
//
// The map is bounded: expired entries are swept and, past the cap, the oldest
// entry is evicted (same discipline as allowRegisterAttempt).

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_MAX_TRACKED_ADDRESSES = 5_000;
/** Shared bucket for requests with no usable X-Forwarded-For (dev-direct). */
export const LOGIN_DIRECT_BUCKET = "direct";

const failedLoginsByAddress = new Map<string, number[]>();

/**
 * The trusted per-IP throttle key: the LAST non-empty comma-separated entry
 * of x-forwarded-for (proxy-authored hop), trimmed. Absent/empty header →
 * the shared "direct" bucket. A single oversized entry (>64 chars, mirroring
 * register-rate-limit.ts's header bound) is treated as untrusted garbage and
 * also falls into the shared bucket.
 */
export function trustedLoginAddress(request: Request): string {
  const segments = (request.headers.get("x-forwarded-for") ?? "").split(",");
  for (let i = segments.length - 1; i >= 0; i--) {
    const entry = segments[i].trim();
    if (!entry) continue;
    return entry.length <= 64 ? entry : LOGIN_DIRECT_BUCKET;
  }
  return LOGIN_DIRECT_BUCKET;
}

/** Sweep/evict so the map can never grow past LOGIN_MAX_TRACKED_ADDRESSES. */
function boundMap(now: number): void {
  if (failedLoginsByAddress.size < LOGIN_MAX_TRACKED_ADDRESSES) return;
  for (const [key, times] of failedLoginsByAddress) {
    if (times.every((t) => now - t >= LOGIN_WINDOW_MS)) failedLoginsByAddress.delete(key);
  }
  // Still full after the sweep: evict the oldest insertion (Map keeps insertion order).
  while (failedLoginsByAddress.size >= LOGIN_MAX_TRACKED_ADDRESSES) {
    const oldest = failedLoginsByAddress.keys().next().value;
    if (oldest === undefined) break;
    failedLoginsByAddress.delete(oldest);
  }
}

/** True when `address` already has LOGIN_MAX_FAILURES failures inside the window. */
export function loginThrottled(address: string, now: number = Date.now()): boolean {
  const recent = (failedLoginsByAddress.get(address) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (recent.length > 0) {
    failedLoginsByAddress.set(address, recent);
  }
  return recent.length >= LOGIN_MAX_FAILURES;
}

/** Record one failed login for `address` (called after a non-throttled failure). */
export function recordLoginFailure(address: string, now: number = Date.now()): void {
  boundMap(now);
  const recent = (failedLoginsByAddress.get(address) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  recent.push(now);
  failedLoginsByAddress.delete(address);
  failedLoginsByAddress.set(address, recent); // re-insert so active offenders are evicted last
}
