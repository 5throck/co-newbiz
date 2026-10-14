// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (2): orchestration of the S3 "보유 판정 확인 (AI)" LLM work, apart from the
 * route so it can run against a fake LLM / fake search results in unit tests.
 *
 * Batched (6 rows per call), per-item validated, one stricter retry per failed batch (lib/llm-json.ts). A judged
 * status survives only with a profile basis OR a cited source; every dropped row gets a specific reason so the
 * note can say why ("nothing happened" is never silent). Fill-empty-only; proposal only, nothing is written.
 */
import type { LlmMessage } from "./llm.ts";
import type { CapabilityGapRow } from "./capability-gap.ts";
import { applyHeldDraft, draftItemId, judgeCitedHeldDraft, type DraftMark } from "./capability-gap-necessity-draft.ts";
import { buildHoldingPrompt, holdingNote, type HoldingCounts, type HoldingSearchResult } from "./capability-holding-check.ts";
import { chunk, FAILURE_LABEL, runJsonBatches, STRICT_JSON_REMINDER, type FailureCategory, type LlmCall } from "./llm-json.ts";

export const HOLDING_BATCH_ROWS = 6;

export interface HoldingRunResult {
  rows: CapabilityGapRow[];
  drafts: Record<string, DraftMark>;
  counts: HoldingCounts;
  source: "llm" | "synthesis";
  note: string;
}

export async function runHoldingCheck(opts: {
  system: LlmMessage;
  oppName: string;
  marketScope: string | null;
  current: CapabilityGapRow[];
  targets: CapabilityGapRow[];
  profileLines: string[];
  profileNames: string[];
  search: HoldingSearchResult;
  profileScope: string;
  scopeNote: string;
  webEnabled: boolean;
  call: LlmCall;
  log?: (line: string) => void;
}): Promise<HoldingRunResult> {
  const { targets, search, profileNames } = opts;
  const counts: HoldingCounts = { proposed: 0, insufficient: 0, profile: 0, web: 0, kept: 0, reasons: {} };
  const drafts: Record<string, DraftMark> = {};
  const rows = opts.current.map((r) => ({ ...r, held: { ...r.held } }));
  const results = await runJsonBatches({
    call: opts.call, batches: chunk(targets, HOLDING_BATCH_ROWS), arrayKeys: ["rows"], label: "capability-gap/holding-check",
    buildMessages: (batch, retry) => [
      opts.system,
      { role: "user" as const, content: buildHoldingPrompt({ oppName: opts.oppName, marketScope: opts.marketScope, rows: batch, profileLines: opts.profileLines, search }) + (retry ? STRICT_JSON_REMINDER : "") },
    ],
    itemRowId: draftItemId, rowId: (r) => r.id, maxTokens: 2800, concurrency: 2, log: opts.log,
  });
  const byId = new Map<string, Record<string, unknown>>();
  for (const b of results) for (const it of b.arrays.rows) { const id = draftItemId(it); if (id && !byId.has(id)) byId.set(id, it); }
  const failures = results.filter((b) => b.failure);
  const labels = () => [...new Set(failures.map((b) => FAILURE_LABEL[b.failure as FailureCategory]))].join("·");
  const answered = results.some((b) => b.arrays.rows.length > 0 || !b.failure);
  if (!answered) {
    return { rows, drafts, counts, source: "synthesis", note: `LLM 응답을 쓸 수 없어 행은 변경되지 않았습니다(사유: ${labels()}). 다시 시도하세요.` };
  }
  for (const t of targets) {
    const { cited, reason } = judgeCitedHeldDraft(byId.get(t.id), { allowedSources: search.perRow[t.id] ?? [], sources: search.sources, profileNames });
    if (!cited) { counts.insufficient++; if (reason) counts.reasons![reason] = (counts.reasons![reason] ?? 0) + 1; continue; }
    const idx = rows.findIndex((r) => r.id === t.id);
    const ap = applyHeldDraft(rows[idx], cited, null);
    if (!ap.mark) { counts.kept!++; continue; } // a person already filled these cells; nothing to apply
    counts.proposed++;
    if (cited.origins.includes("profile")) counts.profile++;
    counts.web += cited.web.length;
    rows[idx] = ap.row;
    drafts[t.id] = ap.mark;
  }
  let note = `${opts.profileScope}. ${opts.scopeNote ? `${opts.scopeNote} ` : ""}` + holdingNote({ counts, search, webEnabled: opts.webEnabled, targeted: targets.length });
  if (failures.length > 0) {
    const lost = failures.reduce((n, b) => n + b.rows.filter((r) => !byId.has(r.id)).length, 0);
    note += ` — ${lost}개 행은 응답 오류로 확인하지 못했습니다(사유: ${labels()}); 다시 시도하세요.`;
  }
  return { rows, drafts, counts, source: "llm", note };
}
