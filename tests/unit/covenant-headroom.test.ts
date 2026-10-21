// covenant-headroom (2026-10-21 S10 "커버넌트 여력", fin-03 / ADR-0122 #2 heatmap input)
// — direction parsing across the /debt page's covenant_json forms and the
// signed headroom arithmetic. DB path is covered in s9-depth-routes.test.ts.
import { describe, expect, test } from "bun:test";
import { headroomPct, parseCovenantDirections, TIGHT_HEADROOM_PCT } from "../../app/web-next/lib/covenant-headroom.ts";

describe("parseCovenantDirections", () => {
  test("JSON number form with _min/_max suffixes registers both the raw and the stripped key", () => {
    const d = parseCovenantDirections(JSON.stringify({ DSCR_min: 1.3, NetLev_max: 3.5 }));
    expect(d.dscr_min).toBe("min");
    expect(d.dscr).toBe("min");
    expect(d.netlev_max).toBe("max");
    expect(d.netlev).toBe("max");
  });

  test("text form (the /debt page summary) maps >= to min and <= to max", () => {
    const d = parseCovenantDirections("DSCR >= 1.3 · NetLev <= 3.5x");
    expect(d.dscr).toBe("min");
    expect(d.netlev).toBe("max");
  });

  test("object spec and array spec forms", () => {
    expect(parseCovenantDirections(JSON.stringify({ icr: { direction: "min" }, lev: { max: 4 } }))).toMatchObject({ icr: "min", lev: "max" });
    expect(parseCovenantDirections(JSON.stringify([{ key: "DSCR", direction: "min" }]))).toMatchObject({ dscr: "min" });
  });

  test("empty, null and junk yield no directions (never a guessed sign)", () => {
    expect(parseCovenantDirections(null)).toEqual({});
    expect(parseCovenantDirections("   ")).toEqual({});
    expect(parseCovenantDirections("free text without an operator")).toEqual({});
    expect(parseCovenantDirections(JSON.stringify({ note: "unknown" }))).toEqual({});
  });
});

describe("headroomPct", () => {
  test("ceiling (max): room is threshold − projected; floor (min): projected − threshold", () => {
    expect(headroomPct("max", 3.5, 3.0)).toBeCloseTo(0.1429, 3);
    expect(headroomPct("max", 3.5, 3.6)).toBeLessThan(0);
    expect(headroomPct("min", 1.3, 1.5)).toBeCloseTo(0.1538, 3);
    expect(headroomPct("min", 1.3, 1.2)).toBeLessThan(0);
  });

  test("unknown direction or a zero threshold yields null", () => {
    expect(headroomPct("unknown", 1.3, 1.5)).toBeNull();
    expect(headroomPct("max", 0, 1)).toBeNull();
  });

  test("tight threshold is 10%", () => {
    expect(TIGHT_HEADROOM_PCT).toBe(0.1);
  });
});
