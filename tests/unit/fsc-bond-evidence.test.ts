// @version 1.0.0
/**
 * ADR-0208 slice 4 - the FSC bond cross-check: parsers (db/lib/fsc-bond-evidence.ts) over recorded live answers (fixtures
 * tests/fixtures/fsc-bond/*.json, read 2026-11-27 with the repo key) and the client (app/web-next/lib/fsc-bond-client.ts)
 * over an injected transport, so NO live network. Covers: the Encoding-form key handling, portal error classification (key not
 * registered / quota / expired / no service), item shapes (array, single object, empty string), the issuer-by-name rule
 * (other issuers dropped, several crno = ambiguous), the outstanding filter, KRW-million conversion (ADR-0061), the latest
 * price day, graceful 'unavailable' on a not-yet-propagated key, the missing key, the call shape (price window, at most five
 * price lookups) and the 15-minute cache.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FSC_ATTRIBUTION,
  FSC_BASIC_ENDPOINT,
  FSC_PRICE_ENDPOINT,
  assembleBondEvidence,
  classifyFscResponse,
  isFscError,
  latestPrice,
  normalizeIssuerName,
  normalizeServiceKey,
  parseBondBasic,
  parseFscPage,
  priceWindowStart,
} from "../../db/lib/fsc-bond-evidence.ts";
import {
  FscKeyMissingError,
  fetchBondEvidence,
  resetFscBondCacheForTests,
  type FscBondDeps,
} from "../../app/web-next/lib/fsc-bond-client.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "fsc-bond", name), "utf8");
const BASIC = fx("basic-info.json");
const PRICE = fx("price-info.json");
const NOT_REGISTERED = fx("error-key-not-registered.json");
const NOW = new Date("2026-11-27T03:00:00Z");

describe("service key", () => {
  test("an Encoding-form key (percent escapes) is decoded once; a Decoding-form key is kept", () => {
    expect(normalizeServiceKey("ab%2Bcd%2Fef%3D%3D")).toBe("ab+cd/ef==");
    expect(normalizeServiceKey("ab+cd/ef==")).toBe("ab+cd/ef==");
    expect(normalizeServiceKey("  plain  ")).toBe("plain");
    expect(normalizeServiceKey("bad%ZZ")).toBe("bad%ZZ");
  });
});

describe("portal errors", () => {
  test("SERVICE_KEY_IS_NOT_REGISTERED (HTTP 403, JSON) -> service_key_not_registered", () => {
    expect(classifyFscResponse(403, NOT_REGISTERED)).toEqual({
      code: "service_key_not_registered",
      reason_code: "30",
      message: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
    });
  });
  test("the same error as XML is recognised too", () => {
    const xml =
      "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
    expect(classifyFscResponse(403, xml)?.code).toBe("service_key_not_registered");
  });
  test("quota, expiry, no service, other HTTP errors", () => {
    const body = (msg: string, code: string) =>
      JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: msg, returnReasonCode: code } } });
    expect(classifyFscResponse(200, body("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR", "22"))?.code).toBe(
      "quota_exceeded",
    );
    expect(classifyFscResponse(200, body("DEADLINE_HAS_EXPIRED_ERROR", "31"))?.code).toBe("service_expired");
    expect(classifyFscResponse(400, body("NO_OPENAPI_SERVICE_ERROR", "12"))?.code).toBe("no_service");
    expect(classifyFscResponse(500, "oops")?.code).toBe("service_error");
    expect(classifyFscResponse(200, BASIC)).toBeNull();
  });
  test("a service-level resultCode other than 00 is an error; non-JSON is invalid_response", () => {
    const bad = JSON.stringify({ response: { header: { resultCode: "99", resultMsg: "BAD" }, body: {} } });
    expect(parseFscPage(bad)).toMatchObject({ code: "service_error", reason_code: "99" });
    expect(parseFscPage("<html>")).toMatchObject({ code: "invalid_response" });
  });
});

describe("items", () => {
  test("basic info page: three items, total 7 (the live answer)", () => {
    const page = parseFscPage(BASIC);
    if (isFscError(page)) throw new Error("unexpected error");
    expect(page.totalCount).toBe(7);
    expect(page.items).toHaveLength(3);
  });
  test("empty result (items is an empty string) and a single object item are both handled", () => {
    const empty = JSON.stringify({
      response: { header: { resultCode: "00" }, body: { totalCount: 0, items: "" } },
    });
    expect(parseFscPage(empty)).toEqual({ totalCount: 0, items: [] });
    const single = JSON.stringify({
      response: {
        header: { resultCode: "00" },
        body: { totalCount: 1, items: { item: { isinCd: "KR1", basDt: "20261126" } } },
      },
    });
    const page = parseFscPage(single);
    if (isFscError(page)) throw new Error("unexpected error");
    expect(page.items).toHaveLength(1);
  });
  test("parseBondBasic: names, dates, coupon as published, KRW converted to INTEGER millions", () => {
    const page = parseFscPage(BASIC);
    if (isFscError(page)) throw new Error("unexpected error");
    const b = parseBondBasic(page.items[1]);
    expect(b).toMatchObject({
      isin: "KR6009832C14",
      issuer_name: "한화솔루션",
      crno: "1101110360935",
      issued_on: "2022-01-24",
      matures_on: "2027-01-22",
      coupon_pct: 3.029,
      balance_krw_million: 105000,
      issue_amount_krw_million: 105000,
      seniority: "선순위",
      guarantee: "무보증",
      offering: "공모",
      basis_date: "2026-11-26",
    });
    expect(Number.isInteger(b?.balance_krw_million)).toBe(true);
    expect(parseBondBasic({ isinCd: "", bondIsurNm: "x" })).toBeNull();
  });
  test("latestPrice picks the greatest trading day whatever the order, yield as published", () => {
    const page = parseFscPage(PRICE);
    if (isFscError(page)) throw new Error("unexpected error");
    expect(latestPrice(page.items)).toEqual({ as_of: "2022-04-14", yield_pct: 3.997, close_price: 9648 });
    expect(latestPrice([...page.items].reverse())?.as_of).toBe("2022-04-14");
    expect(latestPrice([])).toBeNull();
  });
  test("priceWindowStart", () => {
    expect(priceWindowStart("2026-11-27", 12)).toBe("20251127");
    expect(priceWindowStart("2026-03-31", 12)).toBe("20250331");
  });
});

describe("assembleBondEvidence", () => {
  const rows = () => {
    const page = parseFscPage(BASIC);
    if (isFscError(page)) throw new Error("unexpected error");
    return page.items;
  };
  test("outstanding bonds, largest balance first; name match ignores company-form words and spaces", () => {
    const ev = assembleBondEvidence("(주) 한화솔루션", rows(), 3, "2026-11-27", NOW);
    expect(ev).toMatchObject({
      cross_check_only: true,
      status: "ok",
      issuer: { matched_name: "한화솔루션", crno: "1101110360935", match_basis: "name" },
      basis_date: "2026-11-26",
      truncated: false,
    });
    expect(ev.bonds.map((b) => b.isin)).toEqual(["KR6009831E88", "KR6009832F29", "KR6009832C14"]);
    expect(ev.bonds.every((b) => b.price_status === "not_looked_up" && b.last_price === null)).toBe(true);
    expect(ev.attribution).toBe(FSC_ATTRIBUTION);
  });
  test("a matured bond and a zero balance are not outstanding; nothing outstanding -> no_bonds with a reason code", () => {
    const matured = rows().map((r) => ({ ...r, bondExprDt: "20260101" }));
    expect(assembleBondEvidence("한화솔루션", matured, 3, "2026-11-27", NOW)).toMatchObject({
      status: "no_bonds",
      reason_code: "no_outstanding_bonds",
      bonds: [],
    });
    const zero = rows().map((r) => ({ ...r, bondBal: "0" }));
    expect(assembleBondEvidence("한화솔루션", zero, 3, "2026-11-27", NOW).bonds).toEqual([]);
  });
  test("rows of other issuers are dropped (the search is not guaranteed exact)", () => {
    const mixed = [...rows(), { ...rows()[0], isinCd: "KR9", bondIsurNm: "한화솔루션케미칼", crno: "999" }];
    const ev = assembleBondEvidence("한화솔루션", mixed, 4, "2026-11-27", NOW);
    expect(ev.bonds).toHaveLength(3);
    expect(ev.issuer.crno).toBe("1101110360935");
    expect(assembleBondEvidence("전혀다른회사", rows(), 3, "2026-11-27", NOW)).toMatchObject({
      status: "no_bonds",
      reason_code: "no_issuer_match",
    });
  });
  test("one name, several corporate registration numbers -> ambiguous_issuer, nothing shown", () => {
    const other = { ...rows()[0], isinCd: "KR9", crno: "2222222222222" };
    const ev = assembleBondEvidence("한화솔루션", [...rows(), other], 4, "2026-11-27", NOW);
    expect(ev).toMatchObject({ status: "ambiguous_issuer", bonds: [] });
    expect(ev.issuer.crno).toBeNull();
  });
  test("truncated when the register holds more rows than were read", () => {
    expect(assembleBondEvidence("한화솔루션", rows(), 7, "2026-11-27", NOW).truncated).toBe(true);
  });
  test("normalizeIssuerName", () => {
    expect(normalizeIssuerName("주식회사 한화 솔루션")).toBe("한화솔루션");
    expect(normalizeIssuerName("㈜한화솔루션")).toBe("한화솔루션");
  });
});

describe("terms notice", () => {
  test("KOGL type 2 (basic info) and type 4 (price info, no modification) are carried", () => {
    expect(FSC_ATTRIBUTION.basic.license).toBe("공공누리 제2유형");
    expect(FSC_ATTRIBUTION.basic.terms).toBe("attribution_required_no_commercial_use");
    expect(FSC_ATTRIBUTION.price.license).toBe("공공누리 제4유형");
    expect(FSC_ATTRIBUTION.price.terms).toBe("attribution_required_no_commercial_use_no_modification");
  });
});

describe("client", () => {
  const KEY_ENV = "DATA_GO_KR_API_KEY";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY_ENV];
    resetFscBondCacheForTests();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = saved;
  });

  function transport(handler: (url: URL) => { status: number; text: string }) {
    const calls: URL[] = [];
    const deps: FscBondDeps = {
      async get(url) {
        const u = new URL(url);
        calls.push(u);
        return handler(u);
      },
    };
    return { calls, deps };
  }
  const happy = (u: URL) =>
    u.pathname.endsWith("getBondBasiInfo_V2") ? { status: 200, text: BASIC } : { status: 200, text: PRICE };

  test("missing key -> FscKeyMissingError (the route answers 503); nothing is called", async () => {
    delete process.env[KEY_ENV];
    // the .env loader must not refill it in this process: an explicit empty value counts as missing
    process.env[KEY_ENV] = "  ";
    const t = transport(happy);
    await expect(fetchBondEvidence("한화솔루션", NOW, t.deps)).rejects.toBeInstanceOf(FscKeyMissingError);
    expect(t.calls).toHaveLength(0);
  });

  test("happy path: one basic-info call by issuer name, one price lookup per bond with the 12-month window; Encoding key sent once-escaped", async () => {
    process.env[KEY_ENV] = "ab%2Bcd%2Fef%3D%3D"; // Encoding form, as in the repo's .env
    const t = transport(happy);
    const ev = await fetchBondEvidence("한화솔루션", NOW, t.deps);
    expect(ev.status).toBe("ok");
    const basic = t.calls.filter((u) => u.pathname.endsWith("getBondBasiInfo_V2"));
    const price = t.calls.filter((u) => u.pathname.endsWith("getBondPriceInfo_V2"));
    expect(basic).toHaveLength(1);
    expect(basic[0].host + basic[0].pathname).toBe(FSC_BASIC_ENDPOINT);
    expect(basic[0].searchParams.get("bondIsurNm")).toBe("한화솔루션");
    expect(basic[0].searchParams.get("resultType")).toBe("json");
    expect(basic[0].searchParams.get("serviceKey")).toBe("ab+cd/ef=="); // decoded once, escaped once on the wire
    expect(basic[0].search).toContain("serviceKey=ab%2Bcd%2Fef%3D%3D");
    expect(price).toHaveLength(3);
    expect(price[0].host + price[0].pathname).toBe(FSC_PRICE_ENDPOINT);
    expect(price[0].searchParams.get("beginBasDt")).toBe("20251127");
    expect(ev.bonds.every((b) => b.price_status === "traded" && b.last_price?.yield_pct === 3.997)).toBe(true);
    // KOGL 4: the yield is passed through exactly as published
    expect(ev.bonds[0].last_price).toEqual({ as_of: "2022-04-14", yield_pct: 3.997, close_price: 9648 });
    expect(ev.truncated).toBe(true); // the fixture page holds 3 of 7 rows
  });

  test("at most five price lookups, largest balance first; the rest are 'not_looked_up'", async () => {
    process.env[KEY_ENV] = "k";
    const base = JSON.parse(BASIC);
    const item = base.response.body.items.item[0];
    base.response.body.items.item = Array.from({ length: 8 }, (_, i) => ({
      ...item,
      isinCd: `KR000000000${i}`,
      bondBal: String((i + 1) * 10_000_000_000),
    }));
    base.response.body.totalCount = 8;
    const t = transport((u) =>
      u.pathname.endsWith("getBondBasiInfo_V2")
        ? { status: 200, text: JSON.stringify(base) }
        : {
            status: 200,
            text: JSON.stringify({ response: { header: { resultCode: "00" }, body: { totalCount: 0, items: "" } } }),
          },
    );
    const ev = await fetchBondEvidence("한화솔루션", NOW, t.deps);
    expect(t.calls.filter((u) => u.pathname.endsWith("getBondPriceInfo_V2"))).toHaveLength(5);
    expect(ev.bonds.map((b) => b.price_status)).toEqual([
      "not_traded_in_window",
      "not_traded_in_window",
      "not_traded_in_window",
      "not_traded_in_window",
      "not_traded_in_window",
      "not_looked_up",
      "not_looked_up",
      "not_looked_up",
    ]);
    expect(ev.bonds[0].balance_krw_million).toBe(80_000); // largest first
  });

  test("key not yet registered (approval propagation): graceful 'unavailable', no exception, not cached", async () => {
    process.env[KEY_ENV] = "k";
    const t = transport(() => ({ status: 403, text: NOT_REGISTERED }));
    const ev = await fetchBondEvidence("한화솔루션", NOW, t.deps);
    expect(ev).toMatchObject({
      status: "unavailable",
      reason_code: "service_key_not_registered",
      bonds: [],
      cross_check_only: true,
    });
    expect(ev.reason).toContain("propagate");
    expect(JSON.stringify(ev)).not.toContain("serviceKey");
    // not cached: the next call goes to the portal again
    const again = transport(happy);
    expect((await fetchBondEvidence("한화솔루션", NOW, again.deps)).status).toBe("ok");
    expect(again.calls.length).toBeGreaterThan(0);
  });

  test("a transport failure is 'unavailable' too (never thrown)", async () => {
    process.env[KEY_ENV] = "k";
    const deps: FscBondDeps = {
      async get() {
        throw new Error("socket hang up https://apis.data.go.kr/?serviceKey=SECRET");
      },
    };
    const ev = await fetchBondEvidence("한화솔루션", NOW, deps);
    expect(ev.status).toBe("unavailable");
    expect(JSON.stringify(ev)).not.toContain("SECRET");
  });

  test("a price lookup that fails on the key stops the price pass; the bonds stay listed", async () => {
    process.env[KEY_ENV] = "k";
    const t = transport((u) =>
      u.pathname.endsWith("getBondBasiInfo_V2") ? { status: 200, text: BASIC } : { status: 403, text: NOT_REGISTERED },
    );
    const ev = await fetchBondEvidence("한화솔루션", NOW, t.deps);
    expect(ev.status).toBe("ok");
    expect(ev.bonds).toHaveLength(3);
    expect(ev.bonds[0].price_status).toBe("lookup_failed");
    expect(ev.bonds[1].price_status).toBe("not_looked_up");
    expect(t.calls.filter((u) => u.pathname.endsWith("getBondPriceInfo_V2"))).toHaveLength(1);
  });

  test("results are cached per normalised issuer name for 15 minutes", async () => {
    process.env[KEY_ENV] = "k";
    const t = transport(happy);
    await fetchBondEvidence("한화솔루션", NOW, t.deps);
    const n = t.calls.length;
    await fetchBondEvidence("(주)한화솔루션", new Date(NOW.getTime() + 5 * 60_000), t.deps);
    expect(t.calls.length).toBe(n);
    await fetchBondEvidence("한화솔루션", new Date(NOW.getTime() + 16 * 60_000), t.deps);
    expect(t.calls.length).toBeGreaterThan(n);
  });
});
