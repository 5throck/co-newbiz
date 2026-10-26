// L1: self-registration throttle trusts only CF-Connecting-IP and stays bounded.
import { describe, expect, test } from "bun:test";
import {
  SHARED_BUCKET,
  allowRegisterAttempt,
  trustedClientAddress,
  type AttemptMap,
} from "../../app/web-next/lib/register-rate-limit.ts";

const req = (headers: Record<string, string>) => new Request("http://x/api/auth/register", { headers });

describe("register rate limit (L1)", () => {
  test("uses CF-Connecting-IP and ignores a spoofed X-Forwarded-For", () => {
    expect(trustedClientAddress(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.9");
    expect(trustedClientAddress(req({ "x-forwarded-for": "1.2.3.4" }))).toBe(SHARED_BUCKET);
  });

  test("missing or oversized trusted header falls back to the shared bucket", () => {
    expect(trustedClientAddress(req({}))).toBe(SHARED_BUCKET);
    expect(trustedClientAddress(req({ "cf-connecting-ip": "a".repeat(200) }))).toBe(SHARED_BUCKET);
  });

  test("rotating X-Forwarded-For cannot dodge the limit", () => {
    const m: AttemptMap = new Map();
    const results = Array.from({ length: 7 }, (_, i) =>
      allowRegisterAttempt(m, trustedClientAddress(req({ "x-forwarded-for": `10.0.0.${i}` })), 1000 + i),
    );
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });

  test("window expiry re-admits an address", () => {
    const m: AttemptMap = new Map();
    for (let i = 0; i < 5; i++) allowRegisterAttempt(m, "a", 0);
    expect(allowRegisterAttempt(m, "a", 1)).toBe(false);
    expect(allowRegisterAttempt(m, "a", 16 * 60_000)).toBe(true);
  });

  test("the map is bounded by a size cap with eviction", () => {
    const m: AttemptMap = new Map();
    for (let i = 0; i < 50; i++) allowRegisterAttempt(m, `ip-${i}`, 100 + i, { maxTracked: 10 });
    expect(m.size).toBeLessThanOrEqual(10);
    expect(m.has("ip-49")).toBe(true);
    expect(m.has("ip-0")).toBe(false);
  });
});
