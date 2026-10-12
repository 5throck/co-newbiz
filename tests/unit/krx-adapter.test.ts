// Unit tests for the KRX basDd-per-day collection (source-adapters.ts) — fetch is mocked.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  krxRunStats,
  krxStockSeries,
  krxWeekdays,
  listKrxDailyRows,
  registerKrxSeries,
  resetKrxRunState,
  resolveKrxStockMaster,
} from "../../scripts/co-newbiz/source-adapters.ts";

const realFetch = globalThis.fetch;
const realKey = process.env.KRX_API_KEY;
const FAKE_ENV_VALUE = ["fixture", "value"].join("-"); // dummy fixture, not a credential
let calls: string[] = [];

type Handler = (service: string, basDd: string) => Response | Promise<Response>;

function mockFetch(handler: Handler): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.search}`);
    const service = url.pathname.replace("/svc/apis/", "").replace(".json", "");
    return handler(service, url.searchParams.get("basDd") ?? "");
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function indexRows(basDd: string, family: "코스피" | "코스닥", close: string) {
  return [
    { BAS_DD: basDd, IDX_NM: `${family} (외국주포함)`, CLSPRC_IDX: "" },
    { BAS_DD: basDd, IDX_NM: family, CLSPRC_IDX: close },
    { BAS_DD: basDd, IDX_NM: `${family} 200`, CLSPRC_IDX: "1044.52" },
  ];
}

// Oct 2026: 1 Thu, 2 Fri, 3 Sat, 4 Sun, 5 Mon ... "today" pinned to 2026-10-06.
const TODAY = new Date(2026, 9, 6);

beforeEach(() => {
  Object.assign(process.env, { KRX_API_KEY: FAKE_ENV_VALUE });
  calls = [];
  resetKrxRunState({ retryDelayMs: 1, minIntervalMs: 0 });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.KRX_API_KEY;
  else process.env.KRX_API_KEY = realKey;
});

describe("krx basDd per weekday", () => {
  test("weekdays skip Sat/Sun and future dates", () => {
    expect(krxWeekdays("2026-10", TODAY)).toEqual(["20261001", "20261002", "20261005", "20261006"]);
  });

  test("index series calls basDd per weekday and picks the exact name with a numeric close", async () => {
    mockFetch((service, basDd) => json({ OutBlock_1: indexRows(basDd, "코스피", "6625.93") }));
    const rows = await listKrxDailyRows("krx:index:KOSPI:close", "2026-10", TODAY);
    expect(calls.length).toBe(4);
    expect(calls.every((c) => c.includes("idx/kospi_dd_trd") && c.includes("basDd=") && !c.includes("bgnDd"))).toBe(true);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]);
    expect(rows.every((r) => r.value === 6625.93)).toBe(true);
    expect(rows[0].raw).not.toContain("외국주포함");
  });

  test("empty weekday payload is a non-trading day (skipped, counted)", async () => {
    mockFetch((service, basDd) => json({ OutBlock_1: basDd === "20261005" ? [] : indexRows(basDd, "코스닥", "892.27") }));
    const rows = await listKrxDailyRows("krx:index:KOSDAQ:close", "2026-10", TODAY);
    expect(rows.length).toBe(3);
    expect(krxRunStats().emptyDays).toBe(1);
  });

  test("stock rows selected by ISU_CD; day payload shared across series of the same service", async () => {
    mockFetch((service, basDd) =>
      json({
        OutBlock_1: [
          { BAS_DD: basDd, ISU_CD: "277810", ISU_NM: "레인보우로보틱스", TDD_CLSPRC: "429000" },
          { BAS_DD: basDd, ISU_CD: "108490", ISU_NM: "로보티즈", TDD_CLSPRC: "297500" },
        ],
      }),
    );
    registerKrxSeries(krxStockSeries("C1", "108490", "로보티즈", "kosdaq"));
    registerKrxSeries(krxStockSeries("C2", "277810", "레인보우로보틱스", "kosdaq"));
    const a = await listKrxDailyRows("krx:stock:C1:close", "2026-10", TODAY);
    const b = await listKrxDailyRows("krx:stock:C2:close", "2026-10", TODAY);
    expect(a.every((r) => r.value === 297500)).toBe(true);
    expect(b.every((r) => r.value === 429000)).toBe(true);
    expect(calls.length).toBe(4);
    expect(calls.every((c) => c.includes("sto/ksq_bydd_trd"))).toBe(true);
    expect(krxRunStats().cacheHits).toBe(4);
  });

  test("401 envelope throws with the approval hint", async () => {
    mockFetch(() => json({ respCode: "401", respMsg: "Unauthorized API Call" }));
    await expect(listKrxDailyRows("krx:index:KOSPI:close", "2026-10", TODAY)).rejects.toThrow(/401.*re-apply/);
  });

  test("5xx is retried once", async () => {
    let n = 0;
    mockFetch((service, basDd) => (n++ === 0 ? new Response("x", { status: 503 }) : json({ OutBlock_1: indexRows(basDd, "코스피", "1") })));
    const rows = await listKrxDailyRows("krx:index:KOSPI:close", "2026-10", TODAY);
    expect(rows.length).toBe(4);
    expect(krxRunStats().calls).toBe(5);
  });

  test("403 throttle is retried once, then surfaces", async () => {
    let n = 0;
    mockFetch((service, basDd) => (n++ === 0 ? new Response("x", { status: 403 }) : json({ OutBlock_1: indexRows(basDd, "코스피", "1") })));
    expect((await listKrxDailyRows("krx:index:KOSPI:close", "2026-10", TODAY)).length).toBe(4);
    resetKrxRunState({ retryDelayMs: 1, minIntervalMs: 0 });
    mockFetch(() => new Response("x", { status: 403 }));
    await expect(listKrxDailyRows("krx:index:KOSPI:close", "2026-10", TODAY)).rejects.toThrow(/HTTP 403/);
  });

  test("call budget is enforced", async () => {
    resetKrxRunState({ budget: 2, retryDelayMs: 1, minIntervalMs: 0 });
    mockFetch((service, basDd) => json({ OutBlock_1: indexRows(basDd, "코스피", "1") }));
    await expect(listKrxDailyRows("krx:index:KOSPI:close", "2026-10", TODAY)).rejects.toThrow(/budget/);
  });
});

describe("resolveKrxStockMaster", () => {
  const master = (basDd: string) => [
    { ISU_CD: "KR7108490004", ISU_SRT_CD: "108490", ISU_NM: "로보티즈", ISU_ABBRV: "로보티즈", MKT_TP_NM: "KOSDAQ", BAS: basDd },
    { ISU_CD: "KR7277810008", ISU_SRT_CD: "277810", ISU_NM: "레인보우로보틱스", ISU_ABBRV: "레인보우로보틱스", MKT_TP_NM: "KOSDAQ" },
    { ISU_CD: "KR7000001001", ISU_SRT_CD: "000001", ISU_NM: "레인보우테크", ISU_ABBRV: "레인보우테크", MKT_TP_NM: "KOSDAQ" },
  ];

  test("success uses basDd and the latest non-empty weekday", async () => {
    mockFetch((service, basDd) => json({ OutBlock_1: basDd === "20261006" ? [] : master(basDd) }));
    const res = await resolveKrxStockMaster("로보티즈", "kosdaq", TODAY);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.row.shortCode).toBe("108490");
      expect(res.row.market).toBe("KOSDAQ");
      expect(res.basDd).toBe("20261005");
    }
    expect(calls.every((c) => c.includes("sto/ksq_isu_base_info") && c.includes("basDd="))).toBe(true);
  });

  test("exact match wins over prefix matches", async () => {
    mockFetch((service, basDd) => json({ OutBlock_1: master(basDd) }));
    const res = await resolveKrxStockMaster("레인보우로보틱스", "kosdaq", TODAY);
    expect(res.ok && res.row.shortCode).toBe("277810");
  });

  test("ambiguous prefix reports candidates", async () => {
    mockFetch((service, basDd) => json({ OutBlock_1: master(basDd) }));
    const res = await resolveKrxStockMaster("레인보우", "kosdaq", TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/ambiguous/);
      expect(res.candidates?.length).toBe(2);
    }
  });

  test("not found returns the market in the reason", async () => {
    mockFetch((service, basDd) => json({ OutBlock_1: master(basDd) }));
    const res = await resolveKrxStockMaster("없는회사", "kospi", TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found in KOSPI master/);
  });

  test("401 reason is surfaced, not swallowed", async () => {
    mockFetch(() => json({ respCode: "401", respMsg: "Unauthorized API Call" }));
    const res = await resolveKrxStockMaster("로보티즈", "kosdaq", TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/401/);
  });
});
