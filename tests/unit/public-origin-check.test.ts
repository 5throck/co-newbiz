import { describe, expect, test } from "bun:test";
import { checkPublicOrigin } from "../../app/web-next/lib/public-origin-check.ts";

const prod = (v?: string) => ({ NODE_ENV: "production", CO_NEWBIZ_PUBLIC_ORIGIN: v });

describe("checkPublicOrigin", () => {
  test("unset warns about Host spoofing", () => {
    const w = checkPublicOrigin(prod(undefined));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("Host");
  });
  test("blank warns", () => {
    expect(checkPublicOrigin(prod("   "))).toHaveLength(1);
  });
  test("valid origin passes", () => {
    expect(checkPublicOrigin(prod("https://newbiz.bizknights.org"))).toEqual([]);
    expect(checkPublicOrigin(prod("http://localhost:7749"))).toEqual([]);
  });
  test("trailing slash is ok", () => {
    expect(checkPublicOrigin(prod("https://newbiz.bizknights.org/"))).toEqual([]);
  });
  test("missing scheme warns and echoes only the value", () => {
    const w = checkPublicOrigin(prod("newbiz.bizknights.org"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("newbiz.bizknights.org");
  });
  test("path warns", () => {
    expect(checkPublicOrigin(prod("https://newbiz.bizknights.org/app"))).toHaveLength(1);
  });
  test("non-http scheme warns", () => {
    expect(checkPublicOrigin(prod("ftp://newbiz.bizknights.org"))).toHaveLength(1);
  });
  test("non-production never warns", () => {
    expect(checkPublicOrigin({ NODE_ENV: "development" })).toEqual([]);
    expect(checkPublicOrigin({ NODE_ENV: "development", CO_NEWBIZ_PUBLIC_ORIGIN: "bad" })).toEqual([]);
    expect(checkPublicOrigin({})).toEqual([]);
  });
});
