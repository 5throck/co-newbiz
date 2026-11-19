// @version 1.0.0
// Request metadata helpers for the public OAuth surface (ADR-0154; design
// 2026-11-19-oauth-manual-client-registration §3b e1/g1).
//
// - clientIp(): the rate-limit key. CF-Connecting-IP is preferred only when
//   the deployment states it sits behind Cloudflare
//   (CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare), because the header is
//   client-controlled otherwise. Without it, the rightmost X-Forwarded-For
//   entry (the one appended by our own proxy) is used, then X-Real-IP.
// - requestId(): always a server-generated UUID (an inbound value is
//   caller-controlled and must not become the correlation key);
//   clientRequestId() returns the sanitized inbound value for separate recording.
// - ipHash(): keyed pseudonym (HMAC-SHA256, CO_NEWBIZ_AUDIT_IP_HMAC_KEY) of the
//   normalized IP, truncated to 16 hex. Not reversible without the key. In
//   production without a key no hash is produced (null) rather than falling
//   back to an unkeyed hash, which would be brute-forceable over IPv4.
// - rateKey()/rateCheck(): bounded in-memory sliding-window limiter helpers.

import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";

const WARNED = Symbol.for("co-newbiz.oauth.clientIpWarned");
type WarnHolder = { [WARNED]?: boolean };

export function trustsCloudflare(): boolean {
  return (process.env.CO_NEWBIZ_TRUST_PROXY_HEADERS ?? "").trim().toLowerCase() === "cloudflare";
}

function validIp(value: string | null | undefined): string | null {
  let v = value?.trim();
  if (!v || v.length > 64) return null;
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  return isIP(v) ? v : null;
}

/** Expand an IPv6 address to its 8 hextets (null when it is not IPv6). */
function expandV6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let addr = ip.split("%")[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    addr = addr.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
  const parts = [...h, ...fill, ...t].map((x) => Number.parseInt(x, 16));
  return parts.length === 8 && parts.every((n) => Number.isFinite(n)) ? parts : null;
}

/** Canonical form: IPv4 as-is, IPv4-mapped IPv6 as IPv4, other IPv6 as full hextets. */
export function normalizeIp(ip: string): string | null {
  if (isIP(ip) === 4) return ip;
  const parts = expandV6(ip);
  if (!parts) return null;
  if (parts.slice(0, 5).every((n) => n === 0) && parts[5] === 0xffff) {
    return `${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`;
  }
  return parts.map((n) => n.toString(16)).join(":");
}

/** Rate-limit bucket: IPv4 per address, IPv6 per /64, anything else one shared "unknown" bucket. */
export function rateKey(ip: string): string {
  const n = normalizeIp(ip);
  if (!n) return "unknown";
  if (!n.includes(":")) return n;
  return `${n.split(":").slice(0, 4).join(":")}::/64`;
}

export function clientIp(request: Request): string {
  if (trustsCloudflare()) {
    const cf = validIp(request.headers.get("cf-connecting-ip"));
    if (cf) return cf;
  }
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = validIp(parts[parts.length - 1]);
    if (last) return last;
  }
  const real = validIp(request.headers.get("x-real-ip"));
  if (real) return real;
  const holder = globalThis as WarnHolder;
  if (!holder[WARNED]) {
    holder[WARNED] = true;
    console.warn("[oauth] no client IP header present; unidentified callers share one rate-limit bucket.");
  }
  return "local";
}

const HMAC_WARNED = Symbol.for("co-newbiz.oauth.ipHmacWarned");
// Clearly labelled non-production key; never used when NODE_ENV=production.
const DEV_HMAC_KEY = "co-newbiz-dev-only-ip-hmac-key-NOT-FOR-PRODUCTION";

/** Keyed 16-hex pseudonym of the normalized IP; null when no key is configured in production. */
export function ipHash(ip: string): string | null {
  let key = process.env.CO_NEWBIZ_AUDIT_IP_HMAC_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      const h = globalThis as { [HMAC_WARNED]?: boolean };
      if (!h[HMAC_WARNED]) {
        h[HMAC_WARNED] = true;
        console.warn("[oauth] CO_NEWBIZ_AUDIT_IP_HMAC_KEY is not set; audit rows carry no ip_hash.");
      }
      return null;
    }
    key = DEV_HMAC_KEY;
  }
  return createHmac("sha256", key).update(normalizeIp(ip) ?? ip).digest("hex").slice(0, 16);
}

/** Server-generated correlation id; always a fresh UUID. */
export function requestId(_request?: Request): string {
  return randomUUID();
}

/** Inbound x-request-id when short and safe (recorded separately, never trusted as the id). */
export function clientRequestId(request: Request): string | null {
  const inbound = request.headers.get("x-request-id")?.trim();
  return inbound && /^[A-Za-z0-9._-]{1,64}$/.test(inbound) ? inbound : null;
}

export const OVERFLOW_KEY = "__overflow__";
let calls = 0;

/** Drop keys whose newest hit is outside the window. */
export function sweepWindow(hits: Map<string, number[]>, now: number, windowMs: number): void {
  for (const [k, v] of hits) {
    if (v.length === 0 || now - v[v.length - 1] >= windowMs) hits.delete(k);
  }
}

/**
 * Sliding-window check with bounded memory: empty entries are deleted, a sweep
 * runs every 256 calls, and past `maxKeys` new keys share one overflow bucket.
 * Returns the bucket actually used and whether it is over the limit.
 */
export function rateCheck(
  hits: Map<string, number[]>,
  key: string,
  now: number,
  opts: { windowMs: number; max: number; maxKeys: number },
): { limited: boolean; key: string } {
  if (++calls % 256 === 0) sweepWindow(hits, now, opts.windowMs);
  let k = key;
  if (!hits.has(k) && hits.size >= opts.maxKeys) {
    sweepWindow(hits, now, opts.windowMs);
    if (!hits.has(k) && hits.size >= opts.maxKeys) k = OVERFLOW_KEY;
  }
  const recent = (hits.get(k) ?? []).filter((t) => now - t < opts.windowMs);
  if (recent.length >= opts.max) {
    hits.set(k, recent);
    return { limited: true, key: k };
  }
  recent.push(now);
  hits.set(k, recent);
  return { limited: false, key: k };
}

/** Cloudflare Ray ID when present and well-formed (joins app rows to CF Security Events). */
export function cfRay(request: Request): string | null {
  const ray = request.headers.get("cf-ray")?.trim();
  return ray && /^[A-Za-z0-9-]{1,64}$/.test(ray) ? ray : null;
}

export function withRequestId(res: Response, id: string): Response {
  res.headers.set("x-request-id", id);
  return res;
}
