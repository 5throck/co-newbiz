// Self-registration throttle (review L1). The client address comes ONLY from
// CF-Connecting-IP, which the Cloudflare tunnel sets; X-Forwarded-For is
// client-spoofable and ignored. Requests without the trusted header (direct
// access on the dev port) share one bucket. The map is bounded: expired
// entries are swept and, past the cap, the oldest entry is evicted.

export const REGISTER_WINDOW_MS = 15 * 60_000;
export const REGISTER_MAX = 5;
export const REGISTER_MAX_TRACKED_ADDRESSES = 5_000;
export const SHARED_BUCKET = "untrusted-direct";

export type AttemptMap = Map<string, number[]>;

export function trustedClientAddress(request: Request): string {
  const raw = request.headers.get("cf-connecting-ip")?.trim();
  // Header values are bounded; anything oversized is treated as untrusted.
  return raw && raw.length <= 64 ? raw : SHARED_BUCKET;
}

/** Record an attempt; returns false when the address is over the limit. */
export function allowRegisterAttempt(
  attempts: AttemptMap,
  address: string,
  now: number,
  opts: { windowMs?: number; max?: number; maxTracked?: number } = {},
): boolean {
  const windowMs = opts.windowMs ?? REGISTER_WINDOW_MS;
  const max = opts.max ?? REGISTER_MAX;
  const maxTracked = opts.maxTracked ?? REGISTER_MAX_TRACKED_ADDRESSES;
  if (attempts.size >= maxTracked) {
    for (const [key, times] of attempts) {
      if (times.every((t) => now - t >= windowMs)) attempts.delete(key);
    }
    // Still full after the sweep: evict the oldest insertion (Map keeps insertion order).
    while (attempts.size >= maxTracked) {
      const oldest = attempts.keys().next().value;
      if (oldest === undefined) break;
      attempts.delete(oldest);
    }
  }
  const recent = (attempts.get(address) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    attempts.delete(address);
    attempts.set(address, recent); // re-insert so active offenders are evicted last
    return false;
  }
  recent.push(now);
  attempts.delete(address);
  attempts.set(address, recent);
  return true;
}
