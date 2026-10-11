import { describe, expect, test } from "bun:test";
import { noteNumber, parseSimNote } from "../../app/web-next/lib/sim-note.ts";
import { crossCheckOfNote } from "../../app/web-next/lib/business-case-generator.ts";

describe("noteNumber", () => {
  test.each([
    ["3.00x", 3],
    ["3.0", 3],
    ["0.1", 0.1],
    ["null", null],
    ["", null],
    ["abc", null],
    [undefined, null],
    [null, null],
  ])("%p -> %p", (v, want) => expect(noteNumber(v as string | null | undefined)).toBe(want));
});

describe("parseSimNote", () => {
  const note = "acq_ev=3.00x; exit_ev=3.00x; wacc=0.1; xcheck_fade_npv=null";
  test("parses a real note", () => {
    const n = parseSimNote(note);
    expect(noteNumber(n.acq_ev)).toBe(3);
    expect(noteNumber(n.exit_ev)).toBe(3);
    expect(noteNumber(n.wacc)).toBe(0.1);
    expect(noteNumber(n.xcheck_fade_npv)).toBeNull();
    expect(noteNumber(n.missing)).toBeNull();
  });
  test("accepts ';' without space and empty input", () => {
    expect(parseSimNote("a=1;b=2")).toEqual({ a: "1", b: "2" });
    expect(parseSimNote(null)).toEqual({});
  });
  test("crossCheckOfNote shares the grammar", () => {
    expect(crossCheckOfNote(note)).toEqual({ fadeNpv: null, fadeIrr: null, acqEvRevenue: 3 });
    expect(crossCheckOfNote("xcheck_fade_npv=120.5;xcheck_fade_irr=0.2;acq_ev=2.5x")).toEqual({ fadeNpv: 120.5, fadeIrr: 0.2, acqEvRevenue: 2.5 });
    expect(crossCheckOfNote(null)).toEqual({ fadeNpv: null, fadeIrr: null, acqEvRevenue: null });
  });
});
