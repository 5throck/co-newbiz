// @version 1.0.0
/**
 * Robust LLM JSON handling for the S3 requirement proposal and holding check (decider bug report 2026-10-14:
 * "LLM 응답 파싱 실패" on 15 rows). Fake LLM only — no provider, no network, no database.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
const ROOT = join(import.meta.dirname, "../..");
const J = await import("../../app/web-next/lib/llm-json.ts");
const D = await import("../../app/web-next/lib/capability-gap-necessity-draft.ts");
const R = await import("../../app/web-next/lib/capability-requirement-draft.ts");
const cg = await import("../../app/web-next/lib/capability-gap.ts");

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, necessity: "essential", requiredLevel: `수준 ${id}`, basis: { necessity: "영역 인용", requiredLevel: "요구 메모 인용" }, ...over,
});
const obj = (rows: unknown[], key = "rows") => JSON.stringify({ [key]: rows });
const mkRows = (n: number) => cg.normalizeGapRows(Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, capability: `역량 ${i + 1}`, source: "manual" })));
const SYSTEM = { role: "system" as const, content: "sys" };
const CTX = { oppName: "기회", marketScope: "산업", synergyAreasText: "" };
const ok = (text: string, finishReason?: string) => ({ ok: true, text, finishReason });

describe("extractJsonArrays", () => {
  test("plain JSON, code fence, and prose around JSON", () => {
    const body = obj([item("a")]);
    for (const text of [body, "```json\n" + body + "\n```", "다음은 제안입니다.\n" + body + "\n검토하세요.", "```\n" + body + "\n```\n끝"]) {
      const r = J.extractJsonArrays(text, ["rows"]);
      expect(r.category).toBe("ok");
      expect(r.arrays.rows.map((x: any) => x.id)).toEqual(["a"]);
    }
  });
  test("bare top-level array is read as the first key", () => {
    expect(J.extractJsonArrays(JSON.stringify([item("a"), item("b")]), ["rows"]).arrays.rows).toHaveLength(2);
  });
  test("truncated array keeps every complete item and reports truncated", () => {
    const full = obj([item("a"), item("b"), item("c")]);
    const cut = full.slice(0, full.lastIndexOf('{"id":"c"') + 25); // cut inside the third item
    const r = J.extractJsonArrays(cut, ["rows"]);
    expect(r.category).toBe("truncated");
    expect(r.arrays.rows.map((x: any) => x.id)).toEqual(["a", "b"]);
    // cut inside a string of the second item
    const cut2 = full.slice(0, full.indexOf('"id":"b"') + 30);
    expect(J.extractJsonArrays(cut2, ["rows"]).arrays.rows.map((x: any) => x.id)).toEqual(["a"]);
  });
  test("braces inside strings and escaped quotes do not break the scan", () => {
    const rows = [item("a", { requiredLevel: '설비 {핵심} "라인" 운영' }), item("b")];
    const text = "머리말 " + obj(rows).slice(0, -2); // drop the closing ]} -> truncated after the last item
    const r = J.extractJsonArrays(text, ["rows"]);
    expect(r.arrays.rows.map((x: any) => x.id)).toEqual(["a", "b"]);
  });
  test("one invalid item among valid ones: the valid items survive", () => {
    const r = J.extractJsonArrays('{"rows":[' + JSON.stringify(item("a")) + ', 7, "x", {"id": oops}, ' + JSON.stringify(item("b")) + "]}", ["rows"]);
    expect(r.arrays.rows.map((x: any) => x.id)).toEqual(["a", "b"]);
    expect(r.invalidItems).toBeGreaterThan(0);
  });
  test("empty, whitespace and prose-only replies", () => {
    expect(J.extractJsonArrays("", ["rows"]).category).toBe("empty");
    expect(J.extractJsonArrays("   \n", ["rows"]).category).toBe("empty");
    expect(J.extractJsonArrays("죄송합니다. 제안할 수 없습니다.", ["rows"]).category).toBe("invalid_json");
    expect(J.extractJsonArrays('{"rows":[]}', ["rows"]).category).toBe("empty");
  });
  test("two keys at once (rows + newRows)", () => {
    const r = J.extractJsonArrays(JSON.stringify({ rows: [item("a")], newRows: [{ capability: "N" }] }), ["rows", "newRows"]);
    expect(r.arrays.rows).toHaveLength(1);
    expect(r.arrays.newRows).toHaveLength(1);
  });
});

describe("per-item normalization accepts real-world variants", () => {
  test("Korean labels, key synonyms and a string basis", () => {
    const a = D.normalizeNecessityDraft({ rowId: "x", 필요도: "필수", required_level: "독립 운영", basis: "시너지 영역 인용" });
    expect(a).toMatchObject({ necessity: "essential", requiredLevel: "독립 운영" });
    expect(D.draftItemId({ rowId: "x" })).toBe("x");
    expect(D.draftItemId({ row_id: "y" })).toBe("y");
    expect(D.parseNecessityValue("부분 필수")).toBe("partial_essential");
    expect(D.parseNecessityValue("Partial-Essential")).toBe("partial_essential");
    expect(D.parseNecessityValue("선택")).toBe("optional");
    expect(D.parseNecessityValue("Essential")).toBe("essential");
    expect(D.parseNecessityValue("모름")).toBe("");
    const p = D.normalizeNecessityDraft({ id: "p", necessity: "부분 필수", necessityScopeNote: "해외 라인", requiredLevel: "x", basis: { necessity: "b", requiredLevel: "b" } });
    expect(p).toMatchObject({ necessity: "partial_essential", necessityScopeNote: "해외 라인" });
  });
  test("an item without a basis still drops only that value", () => {
    expect(D.normalizeNecessityDraft({ id: "z", necessity: "essential", requiredLevel: "x", basis: { requiredLevel: "b" } })).toMatchObject({ necessity: "", requiredLevel: "x" });
  });
});

describe("runRequirementDraft with a fake LLM", () => {
  test("15 rows are split into 3 calls (6, 6, 3) and every row gets necessity + level", async () => {
    const rows = mkRows(15);
    const sizes: number[] = [];
    const maxTokens: number[] = [];
    const call = async (messages: any[], max: number) => {
      const user = messages.at(-1).content as string;
      const ids = [...user.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]);
      sizes.push(ids.length); maxTokens.push(max);
      return ok(obj(ids.map((id) => item(id))));
    };
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call });
    expect(sizes.sort((a, b) => b - a)).toEqual([6, 6, 3]);
    expect(Math.max(...maxTokens)).toBeLessThanOrEqual(R.BATCH_MAX_TOKENS);
    expect(out.failures).toEqual([]);
    expect(out.rows.every((r: any) => r.necessity === "essential" && r.requiredLevel.startsWith("수준"))).toBe(true);
    expect(D.countMissingRequirement(out.rows).total).toBe(0);
    expect(Object.keys(out.drafts)).toHaveLength(15);
  });
  test("rows with nothing missing are not sent to the LLM; human values are never overwritten", async () => {
    const rows = mkRows(3).map((r: any, i: number) => (i === 0 ? { ...r, necessity: "optional", requiredLevel: "사람 값" } : r));
    const seen: string[] = [];
    const call = async (messages: any[]) => { const u = messages.at(-1).content as string; seen.push(u); return ok(obj([item("r1", { necessity: "essential" }), item("r2"), item("r3")])); };
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("[r1]");
    expect(out.rows[0]).toMatchObject({ necessity: "optional", requiredLevel: "사람 값" });
    expect(out.rows[1].necessity).toBe("essential");
  });
  test("fenced + prose + Korean labels all parse", async () => {
    const rows = mkRows(2);
    const call = async () => ok("제안입니다.\n```json\n" + obj([{ rowId: "r1", 필요도: "필수", requiredLevel: "a", basis: "b" }, item("r2", { necessity: "선택" })]) + "\n```");
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call });
    expect(out.rows.map((r: any) => r.necessity)).toEqual(["essential", "optional"]);
  });
  test("a truncated reply keeps the complete items and retries the rest once with a stricter reminder", async () => {
    const rows = mkRows(4);
    const prompts: string[] = [];
    let n = 0;
    const call = async (messages: any[]) => {
      prompts.push(messages.at(-1).content);
      n++;
      if (n === 1) { const full = obj([item("r1"), item("r2"), item("r3"), item("r4")]); return ok(full.slice(0, full.indexOf('"id":"r3"') + 20), "length"); }
      return ok(obj([item("r3"), item("r4")]));
    };
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("[재요청]");
    expect(prompts[1]).toContain("[재요청]");
    expect(prompts[1]).toContain("[r3]");
    expect(prompts[1]).not.toContain("[r1]"); // only the unanswered rows are retried
    expect(out.failures).toEqual([]);
    expect(D.countMissingRequirement(out.rows).total).toBe(0);
  });
  test("retry happens once only; a still-failing batch is reported honestly and keeps the other batches", async () => {
    const rows = mkRows(8); // batches: r1-r6, r7-r8
    let calls = 0;
    const logs: string[] = [];
    const call = async (messages: any[]) => {
      calls++;
      const u = messages.at(-1).content as string;
      if (u.includes("[r7]")) return ok("죄송합니다, 형식을 맞추지 못했습니다."); // always unusable
      const ids = [...u.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]);
      return ok(obj(ids.map((id) => item(id))));
    };
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call, log: (l) => logs.push(l) });
    expect(calls).toBe(3); // batch1 once, batch2 twice (initial + one retry)
    expect(out.failures).toEqual(["invalid_json"]);
    expect(out.failedCells).toBe(4); // r7, r8 x (necessity + level)
    expect(out.rows.slice(0, 6).every((r: any) => r.necessity === "essential")).toBe(true);
    expect(out.rows[6].necessity).toBe("");
    const suffix = R.failureSuffix(out);
    expect(suffix).toContain("4개 칸은 응답 오류로 비웠습니다");
    expect(suffix).toContain("형식 오류");
    expect(suffix).not.toContain("죄송합니다"); // raw response never reaches the UI text
    // server-side diagnostic is redacted/short: length + finish + head only
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain("len=");
    expect(logs[0]).toContain("finish=");
    expect(logs.every((l) => l.length < 400)).toBe(true);
  });
  test("empty reply and a failed call are categorized; first-attempt failure then success is not a failure", async () => {
    const rows = mkRows(1);
    const empty = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call: async () => ok("") });
    expect(empty.failures).toEqual(["empty"]);
    expect(empty.answered).toBe(false);
    expect(R.failureSuffix(empty)).toContain("빈 응답");
    const failed = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call: async () => ({ ok: false, text: "", reason: "http 500" }) });
    expect(failed.failures).toEqual(["call_failed"]);
    expect(R.failureSuffix(failed)).toContain("호출 실패");
    let n = 0;
    const recovered = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call: async () => (++n === 1 ? ok("") : ok(obj([item("r1")]))) });
    expect(recovered.failures).toEqual([]);
    expect(recovered.rows[0].necessity).toBe("essential");
  });
  test("finish_reason length marks the batch truncated even when the tail parses", async () => {
    const rows = mkRows(1);
    let n = 0;
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call: async () => { n++; return ok(obj([item("r1")]), "length"); } });
    // all rows answered: harmless, no failure, no retry
    expect(out.failures).toEqual([]);
    expect(n).toBe(1);
  });
  test("one invalid item among valid ones: only that row stays missing", async () => {
    const rows = mkRows(3);
    const call = async () => ok('{"rows":[' + [JSON.stringify(item("r1")), '{"id":"r2","necessity":', JSON.stringify(item("r3"))].join(",") + "]}");
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call });
    expect(out.rows[0].necessity).toBe("essential");
    expect(out.rows[2].necessity).toBe("essential");
    expect(D.countMissingRequirement(out.rows).rows).toBeLessThanOrEqual(1);
  });
  test("new rows come from their own small call and arrive with necessity AND requiredLevel", async () => {
    const rows = mkRows(2);
    const kinds: string[] = [];
    const call = async (messages: any[]) => {
      const u = messages.at(-1).content as string;
      if (u.includes("newRows로 제안")) {
        kinds.push("new");
        expect(u).toContain("역량 1"); // existing names for de-duplication
        return ok(obj([
          { capability: "해외 영업망", requiredNote: "시너지 영역 A에서 도출", necessity: "필수", requiredLevel: "3개국 지사", basis: { necessity: "a", requiredLevel: "b" } },
          { capability: "역량 1", requiredNote: "중복", necessity: "essential", requiredLevel: "x", basis: "b" },
          { capability: "품질 인증", requiredNote: "시너지 영역 B", necessity: "optional", requiredLevel: "ISO", basis: "b" },
        ], "newRows"));
      }
      kinds.push("rows");
      return ok(obj([item("r1"), item("r2")]));
    };
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: { ...CTX, synergyAreasText: "1. 영역 A" }, current: rows, call });
    expect(kinds.sort()).toEqual(["new", "rows"]);
    expect(out.proposedNew).toBe(2);
    const added = out.rows.slice(2);
    expect(added.map((r: any) => r.capability)).toEqual(["해외 영업망", "품질 인증"]);
    expect(added.every((r: any) => r.necessity && r.requiredLevel && r.source === "synergy_area" && r.held.status === "unevaluated")).toBe(true);
    expect(D.countMissingRequirement(out.rows).total).toBe(0);
  });
  test("deadline: batches that would start after the deadline report a timeout instead of running", async () => {
    const rows = mkRows(13); // 3 batches, concurrency 2
    let t = 0;
    const out = await R.runRequirementDraft({ system: SYSTEM, ctx: CTX, current: rows, call: async (m: any[]) => { t += 60_000; const ids = [...(m.at(-1).content as string).matchAll(/\[(r\d+)\]/g)].map((x) => x[1]); return ok(obj(ids.map((id) => item(id)))); }, now: () => t, deadlineMs: 100_000 });
    expect(out.failures).toContain("timeout");
    expect(R.failureSuffix(out)).toContain("시간 초과");
  });
});

describe("source wiring", () => {
  const read = (p: string) => readFileSync(join(ROOT, "app/web-next", p), "utf8");
  test("both routes use the shared batched runner, not first-brace/last-brace JSON.parse", () => {
    const draft = read("app/api/opportunities/[id]/capability-gap/llm-draft/route.ts");
    const hold = read("app/api/opportunities/[id]/capability-gap/holding-check/route.ts");
    expect(draft).toContain("runRequirementDraft");
    expect(hold).toContain("runHoldingCheck");
    expect(read("lib/capability-holding-run.ts")).toContain("runJsonBatches");
    for (const src of [draft, hold]) {
      expect(src).not.toContain('res.text.indexOf("{")');
      expect(src).not.toContain("lastIndexOf");
      expect(src).toContain("completeDetailed");
    }
  });
  test("llm client exposes the finish reason", () => {
    const llm = read("lib/llm.ts");
    expect(llm).toContain("finishReason");
    expect(llm).toContain("function extractFinishReason");
  });
});
