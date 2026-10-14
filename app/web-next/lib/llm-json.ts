// @version 1.0.0
/**
 * Robust JSON-array extraction + batched LLM calls for draft routes (S3 requirement proposal, holding check).
 *
 * Root cause this fixes (decider report 2026-10-14, "LLM 응답 파싱 실패" on a 15-row register): the routes sent ONE
 * call for every row with a 1600-token output cap and parsed with `text.indexOf("{")` .. `lastIndexOf("}")` +
 * `JSON.parse`, all-or-nothing. Long Korean output is cut off mid-array (truncated JSON), or arrives wrapped in a
 * code fence / prose, and ONE bad character discarded every row. Here: tolerate fences and prose, salvage the
 * complete items of a truncated array, validate per item, split the work into small batches, retry a failed batch
 * once with a stricter "JSON only" reminder, and report the failure category honestly (never the raw response).
 */
import type { LlmMessage } from "./llm.ts";

export type ParseCategory = "ok" | "empty" | "invalid_json" | "truncated";
export type JsonItem = Record<string, unknown>;

export interface ExtractedArrays {
  /** key -> complete, plain-object items (invalid items are skipped, not fatal). */
  arrays: Record<string, JsonItem[]>;
  /** What went wrong, if anything: items are still returned whenever some were salvageable. */
  category: ParseCategory;
  /** Items that were present but not usable objects / not parseable. */
  invalidItems: number;
}

const stripFences = (s: string): string => s.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");

/** String-aware scan from an opening bracket; returns the index of its matching close, or -1 when unbalanced (truncated). */
function matchingClose(text: string, open: number): number {
  const stack: string[] = [];
  let inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function collectItems(list: unknown[], into: JsonItem[]): number {
  let invalid = 0;
  for (const it of list) {
    if (it && typeof it === "object" && !Array.isArray(it)) into.push(it as JsonItem);
    else invalid++;
  }
  return invalid;
}

/** Walk the elements of the array whose "[" is at `open`; keep every COMPLETE top-level object. */
function salvageArray(text: string, open: number): { items: JsonItem[]; invalid: number; closed: boolean } {
  const items: JsonItem[] = [];
  let invalid = 0;
  let i = open + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "]") return { items, invalid, closed: true };
    if (c === "{") {
      const end = matchingClose(text, i);
      if (end === -1) return { items, invalid, closed: false }; // cut off inside this object
      try {
        const v = JSON.parse(text.slice(i, end + 1));
        if (v && typeof v === "object" && !Array.isArray(v)) items.push(v as JsonItem); else invalid++;
      } catch {
        // A malformed item can swallow the items after it in the brace match; resume at the next element start
        // (an "{" right after "," or "[") so the following valid items are still recovered.
        invalid++;
        const rest = text.slice(i + 1);
        const nxt = rest.search(/[,[]\s*\{/);
        if (nxt < 0) return { items, invalid, closed: false };
        i = i + 1 + nxt;
        while (text[i] !== "{") i++;
        continue;
      }
      i = end + 1;
      continue;
    }
    i++;
  }
  return { items, invalid, closed: false };
}

/**
 * Pull the named arrays out of an LLM reply. Handles code fences, leading/trailing prose, a bare top-level
 * array (taken as the first key), and truncated output (all complete items are kept).
 */
export function extractJsonArrays(raw: string, keys: string[]): ExtractedArrays {
  const text = stripFences(String(raw ?? "")).trim();
  const out: ExtractedArrays = { arrays: Object.fromEntries(keys.map((k) => [k, [] as JsonItem[]])), category: "ok", invalidItems: 0 };
  if (!text) return { ...out, category: "empty" };

  // 1) A fully parseable JSON value somewhere in the text (prose before it is skipped).
  for (let from = 0, tries = 0; tries < 6; tries++) {
    const idx = text.slice(from).search(/[{[]/);
    if (idx < 0) break;
    const start = from + idx;
    const end = matchingClose(text, start);
    if (end === -1) { from = start + 1; continue; } // unbalanced (truncated): look inside for balanced candidates
    let found = false;
    try {
      const v = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(v)) {
        // A bare array counts only as the reply's top-level value (the first bracket) or when it holds objects;
        // otherwise it is a nested scalar array such as "sources":[1].
        if (tries === 0 || v.some((x) => x && typeof x === "object" && !Array.isArray(x))) {
          found = true;
          out.invalidItems += collectItems(v, out.arrays[keys[0]]);
        }
      } else if (v && typeof v === "object") {
        for (const k of keys) {
          const arr = (v as Record<string, unknown>)[k];
          if (Array.isArray(arr)) { found = true; out.invalidItems += collectItems(arr, out.arrays[k]); }
        }
      }
    } catch { /* not JSON: skip this span */ }
    if (found) {
      const total = keys.reduce((n, k) => n + out.arrays[k].length, 0);
      return { ...out, category: total === 0 && out.invalidItems === 0 ? "empty" : "ok" };
    }
    from = end + 1; // skip the whole balanced span, never its nested pieces
  }

  // 2) Salvage: find each `"key": [` and keep the complete items (truncated output, stray characters).
  let anyArray = false;
  let truncated = false;
  for (const k of keys) {
    const m = text.match(new RegExp(`"${k}"\\s*:\\s*\\[`));
    if (!m || m.index === undefined) continue;
    anyArray = true;
    const s = salvageArray(text, m.index + m[0].length - 1);
    out.arrays[k].push(...s.items);
    out.invalidItems += s.invalid;
    if (!s.closed) truncated = true;
  }
  if (!anyArray) {
    const bare = text.indexOf("[");
    if (bare >= 0 && text.slice(0, bare).replace(/[\s:]/g, "") === "") {
      const s = salvageArray(text, bare);
      out.arrays[keys[0]].push(...s.items);
      out.invalidItems += s.invalid;
      anyArray = true;
      truncated = !s.closed;
    }
  }
  const total = keys.reduce((n, k) => n + out.arrays[k].length, 0);
  if (!anyArray) return { ...out, category: "invalid_json" };
  return { ...out, category: truncated ? "truncated" : total === 0 ? "invalid_json" : "ok" };
}

// ── batched calls ───────────────────────────────────────────────────────────

export interface LlmCallResult {
  ok: boolean;
  text: string;
  finishReason?: string;
  /** Short category when !ok ("not_configured" | "call_failed"). */
  reason?: string;
}
/** Injected LLM client — the route wires completeDetailed; tests pass a fake. */
export type LlmCall = (messages: LlmMessage[], maxTokens: number) => Promise<LlmCallResult>;

export type FailureCategory = "truncated" | "invalid_json" | "empty" | "call_failed" | "timeout";
export const FAILURE_LABEL: Record<FailureCategory, string> = {
  truncated: "응답 잘림", invalid_json: "형식 오류", empty: "빈 응답", call_failed: "호출 실패", timeout: "시간 초과",
};

export interface BatchResult<R> {
  index: number;
  rows: R[];
  arrays: Record<string, JsonItem[]>;
  /** null = the batch produced a usable answer; otherwise why its last attempt did not. */
  failure: FailureCategory | null;
  attempts: number;
}

export interface RunBatchesOptions<R> {
  call: LlmCall;
  batches: R[][];
  arrayKeys: string[];
  /** Builds the messages for one batch; `retry` is true on the single stricter retry. */
  buildMessages: (rows: R[], retry: boolean) => LlmMessage[];
  /** Id of the row an item answers (first array key) — used to find rows still unanswered before the retry. */
  itemRowId: (item: JsonItem) => string;
  rowId: (row: R) => string;
  maxTokens: number;
  concurrency?: number;
  deadlineMs?: number;
  now?: () => number;
  label: string;
  /** Server-side diagnostics sink (redacted). Defaults to console.error. */
  log?: (line: string) => void;
}

export const STRICT_JSON_REMINDER =
  "\n\n[재요청] 직전 응답을 JSON으로 읽지 못했습니다. 설명·머리말·코드펜스 없이 JSON 객체 하나만 출력하세요. 각 행은 간결하게(근거 문장은 100자 이내), 위에 나열된 id의 행만 포함합니다.";

/** Redacted one-line diagnostic: length, finish reason, first 200 characters with whitespace collapsed. */
export function redactedDiagnostic(label: string, category: string, res: LlmCallResult): string {
  const head = String(res.text ?? "").replace(/\s+/g, " ").slice(0, 200);
  return `[${label}] ${category} len=${(res.text ?? "").length} finish=${res.finishReason ?? "n/a"} head=${JSON.stringify(head)}`;
}

/**
 * Run the batches with bounded parallelism and one overall deadline. A batch whose reply is unusable (call
 * failure, empty, invalid JSON, truncated) is retried ONCE with a stricter reminder for just the rows that
 * got no item. Items from a truncated reply are kept. Never throws.
 */
export async function runJsonBatches<R>(opts: RunBatchesOptions<R>): Promise<BatchResult<R>[]> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((l: string) => console.error(l));
  const deadline = now() + (opts.deadlineMs ?? 100_000);
  const results: BatchResult<R>[] = new Array(opts.batches.length);
  const emptyArrays = () => Object.fromEntries(opts.arrayKeys.map((k) => [k, [] as JsonItem[]]));
  const key0 = opts.arrayKeys[0];

  const attempt = async (rows: R[], retry: boolean): Promise<{ arrays: Record<string, JsonItem[]>; failure: FailureCategory | null }> => {
    const res = await opts.call(opts.buildMessages(rows, retry), opts.maxTokens);
    if (!res.ok) {
      log(redactedDiagnostic(opts.label, res.reason ?? "call_failed", res));
      return { arrays: emptyArrays(), failure: "call_failed" };
    }
    const parsed = extractJsonArrays(res.text, opts.arrayKeys);
    const total = opts.arrayKeys.reduce((n, k) => n + parsed.arrays[k].length, 0);
    let category: ParseCategory = parsed.category;
    if (category === "ok" && total === 0) category = "empty";
    if (category !== "ok") {
      log(redactedDiagnostic(opts.label, category, res));
    } else if (/length|max_tokens/i.test(res.finishReason ?? "")) {
      // The provider says the output was cut off even though the tail happened to parse.
      category = "truncated";
      log(redactedDiagnostic(opts.label, "truncated(finish_reason)", res));
    }
    return { arrays: parsed.arrays, failure: category === "ok" ? null : category };
  };

  const runOne = async (bi: number) => {
    const rows = opts.batches[bi];
    if (now() > deadline) { results[bi] = { index: bi, rows, arrays: emptyArrays(), failure: "timeout", attempts: 0 }; return; }
    const first = await attempt(rows, false);
    const arrays = first.arrays;
    let failure = first.failure;
    let attempts = 1;
    if (failure) {
      const answered = new Set(arrays[key0].map(opts.itemRowId));
      const pending = rows.filter((r) => !answered.has(opts.rowId(r)));
      if (pending.length > 0 && now() <= deadline) {
        const again = await attempt(pending, true);
        attempts = 2;
        for (const k of opts.arrayKeys) arrays[k] = [...arrays[k], ...again.arrays[k]];
        failure = again.failure;
      } else if (pending.length === 0) {
        failure = null; // every row already has an item (e.g. a harmless trailing cut-off)
      }
    }
    results[bi] = { index: bi, rows, arrays, failure, attempts };
  };

  const conc = Math.max(1, opts.concurrency ?? 2);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(conc, opts.batches.length) }, async () => {
    for (;;) {
      const bi = next++;
      if (bi >= opts.batches.length) return;
      try { await runOne(bi); } catch { results[bi] = { index: bi, rows: opts.batches[bi], arrays: emptyArrays(), failure: "call_failed", attempts: 1 }; }
    }
  }));
  return results;
}

export const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
