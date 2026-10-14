// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (2): orchestration of the S3 "필요 역량 제안 (AI)" LLM work, kept apart from
 * the route so it can run against a fake LLM in unit tests.
 *
 * Output stays small and robust (see lib/llm-json.ts for the root cause of the 15-row "파싱 실패"):
 * rows with a missing 필요도 / 필요 수준 go to the LLM in batches of BATCH_ROWS (bounded parallelism, one overall
 * deadline, one stricter retry per failed batch); new rows from the synergy areas are a separate small call.
 * Every item is validated on its own, so one bad item never discards the others. Fill-empty-only: human values
 * are never overwritten. Proposal only — nothing is written here.
 */
import type { LlmMessage } from "./llm.ts";
import type { CapabilityGapRow } from "./capability-gap.ts";
import {
  applyNecessityDraft, draftItemId, missingRequirementCells, normalizeNecessityDraft, type DraftMark,
} from "./capability-gap-necessity-draft.ts";
import { isRequirementSourceKind, newGapRowFromSource, type RequirementSourceKind } from "./capability-requirement-sources.ts";
import { chunk, FAILURE_LABEL, runJsonBatches, STRICT_JSON_REMINDER, type FailureCategory, type LlmCall } from "./llm-json.ts";

export const BATCH_ROWS = 6;
export const BATCH_CONCURRENCY = 2;
export const BATCH_MAX_TOKENS = 2400;
export const NEW_ROWS_MAX_TOKENS = 2400;
export const MAX_NEW_ROWS = 5;

const NECESSITY_PROMPT =
  "필요도(necessity)는 필수(essential)=이 역량 없이는 사업을 진행할 수 없음, 부분 필수(partial_essential)=일부 기능·단계·지역에서만 필요(그 범위를 necessityScopeNote에 120자 이내로 기술), 선택(optional)=있으면 유리하나 필수는 아님입니다. 값은 반드시 영문 키(essential|partial_essential|optional)로 씁니다. 필요 수준(requiredLevel)은 사업을 위해 도달해야 할 구체적 상태를 1-2문장(400자 이내)으로 씁니다. 근거(basis.necessity / basis.requiredLevel)는 시너지 영역·요구 메모·프로필 근거를 인용해 100자 이내로 씁니다. 근거가 뒷받침하지 않는 칸만 비웁니다(사실을 만들지 않는다).";

const JSON_ONLY = "설명·코드펜스 없이 JSON 객체 하나만 출력합니다.";

export interface RequirementDraftContext {
  oppName: string;
  marketScope: string | null;
  synergyAreasText: string;
  /** Labelled S2-sketch / S1-factor blocks (heading + text) used when synergy areas are missing or in addition to them. */
  extraSourcesText?: string;
  /** Source kinds that have content (priority order); a proposed new row's `source` must be one of them. */
  sourceKinds?: RequirementSourceKind[];
}

/** All evidence blocks as one labelled text (synergy areas first). */
function sourcesBlock(ctx: RequirementDraftContext): string {
  return [ctx.synergyAreasText ? `[S3 연계 시너지 영역 — 선별 우선]\n${ctx.synergyAreasText}` : "", ctx.extraSourcesText ?? ""].filter(Boolean).join("\n\n");
}

function systemOf(system: LlmMessage): LlmMessage[] { return [system]; }

export function buildMissingBatchMessages(system: LlmMessage, ctx: RequirementDraftContext, rows: CapabilityGapRow[], retry: boolean): LlmMessage[] {
  const rowsText = rows
    .map((r, i) => {
      const m = missingRequirementCells(r);
      const need = [m.necessity ? "necessity" : "", m.requiredLevel ? "requiredLevel" : ""].filter(Boolean).join(",");
      return `${i + 1}. [${r.id}] ${r.capability}${r.requiredNote ? ` (${r.requiredNote.slice(0, 160)})` : ""} | 제안할 칸: ${need}`;
    })
    .join("\n");
  return [
    ...systemOf(system),
    {
      role: "user",
      content:
        `아래 필요 역량 행의 비어 있는 칸(제안할 칸)만 초안으로 제안하세요. 이미 값이 있는 칸은 제안하지 않습니다. 보유 판정·보유 수준·보유 근거는 다루지 않습니다. ${NECESSITY_PROMPT} ${JSON_ONLY}\n` +
        'JSON: {"rows":[{"id":"원본 행 id 그대로","necessity":"essential|partial_essential|optional","necessityScopeNote":"부분 필수일 때만","requiredLevel":"필요 수준","basis":{"necessity":"왜","requiredLevel":"왜"}}]}\n\n' +
        `기회명: ${ctx.oppName} / 시장: ${ctx.marketScope ?? "미정"}\n` +
        (sourcesBlock(ctx) ? `\n${sourcesBlock(ctx)}\n` : "") +
        `\n[필요 역량 행]\n${rowsText}` + (retry ? STRICT_JSON_REMINDER : ""),
    },
  ];
}

export function buildNewRowsMessages(system: LlmMessage, ctx: RequirementDraftContext, existing: CapabilityGapRow[], retry: boolean): LlmMessage[] {
  const names = existing.map((r) => r.capability).slice(0, 40).join(", ") || "(없음)";
  return [
    ...systemOf(system),
    {
      role: "user",
      content:
        `아래 근거 블록(시너지 영역·S2 스케치·S1 요인)을 채우는 데 필요한데 아래 기존 목록에 없는 역량을 newRows로 제안하세요(최대 ${MAX_NEW_ROWS}개, requiredNote에 근거 블록의 영역명·항목을 인용, 기존 역량 중복 금지). 각 새 행에 source(${(ctx.sourceKinds ?? ["synergy_area"]).join("|")} 중 근거가 된 블록)를 적습니다. 각 새 행은 necessity와 requiredLevel을 반드시 함께 채웁니다(근거가 뒷받침하지 않는 칸만 비움). ${NECESSITY_PROMPT} ${JSON_ONLY}\n` +
        'JSON: {"newRows":[{"capability":"역량명","source":"${(ctx.sourceKinds ?? ["synergy_area"])[0]}","requiredNote":"시너지 영역 X에서 도출 — 사유","necessity":"essential|partial_essential|optional","necessityScopeNote":"","requiredLevel":"필요 수준","basis":{"necessity":"왜","requiredLevel":"왜"}}]}\n\n' +
        `기회명: ${ctx.oppName} / 시장: ${ctx.marketScope ?? "미정"}\n\n${sourcesBlock(ctx)}\n\n[기존 필요 역량]\n${names}` + (retry ? STRICT_JSON_REMINDER : ""),
    },
  ];
}

export interface RequirementDraftResult {
  rows: CapabilityGapRow[];
  drafts: Record<string, DraftMark>;
  proposedNew: number;
  /** Missing cells in batches whose reply was unusable (after the retry), by failure category. */
  failedCells: number;
  failures: FailureCategory[];
  /** At least one call produced a usable answer. */
  answered: boolean;
}

const normName = (v: string) => v.replace(/\s+/g, "").toLowerCase();

export async function runRequirementDraft(opts: {
  system: LlmMessage;
  ctx: RequirementDraftContext;
  current: CapabilityGapRow[];
  call: LlmCall;
  log?: (line: string) => void;
  now?: () => number;
  deadlineMs?: number;
}): Promise<RequirementDraftResult> {
  const { system, ctx, current, call } = opts;
  const drafts: Record<string, DraftMark> = {};
  let rows: CapabilityGapRow[] = current.map((r) => ({ ...r, held: { ...r.held } }));
  const targets = current.filter((r) => { const m = missingRequirementCells(r); return m.necessity || m.requiredLevel; });
  const failures: FailureCategory[] = [];
  let failedCells = 0;
  let answered = false;

  if (targets.length > 0) {
    const results = await runJsonBatches({
      call, batches: chunk(targets, BATCH_ROWS), arrayKeys: ["rows"], label: "capability-gap/llm-draft",
      buildMessages: (batch, retry) => buildMissingBatchMessages(system, ctx, batch, retry),
      itemRowId: draftItemId, rowId: (r) => r.id,
      maxTokens: BATCH_MAX_TOKENS, concurrency: BATCH_CONCURRENCY, deadlineMs: opts.deadlineMs, now: opts.now, log: opts.log,
    });
    const byId = new Map<string, Record<string, unknown>>();
    for (const b of results) {
      if (b.arrays.rows.length > 0 || b.failure === null) answered = true;
      for (const it of b.arrays.rows) { const id = draftItemId(it); if (id && !byId.has(id)) byId.set(id, it); }
    }
    rows = rows.map((r) => {
      const item = byId.get(r.id);
      if (!item) return r;
      const nd = applyNecessityDraft(r, normalizeNecessityDraft(item));
      if (nd.mark) drafts[r.id] = nd.mark;
      return nd.row;
    });
    for (const b of results) {
      if (!b.failure) continue;
      failures.push(b.failure);
      // cells still missing in rows of this failed batch that got no usable item
      for (const r of b.rows) {
        if (byId.has(r.id)) continue;
        const m = missingRequirementCells(r);
        failedCells += (m.necessity ? 1 : 0) + (m.requiredLevel ? 1 : 0);
      }
    }
  }

  let proposedNew = 0;
  if (ctx.synergyAreasText || ctx.extraSourcesText) {
    const kinds = ctx.sourceKinds && ctx.sourceKinds.length > 0 ? ctx.sourceKinds : (["synergy_area"] as RequirementSourceKind[]);
    const [res] = await runJsonBatches({
      call, batches: [[{ id: "__new" }]], arrayKeys: ["newRows"], label: "capability-gap/llm-draft:new-rows",
      buildMessages: (_b, retry) => buildNewRowsMessages(system, ctx, rows, retry),
      itemRowId: () => "__new", rowId: (r) => r.id,
      maxTokens: NEW_ROWS_MAX_TOKENS, deadlineMs: opts.deadlineMs, now: opts.now, log: opts.log,
    });
    if (res) {
      if (res.arrays.newRows.length > 0 || res.failure === null) answered = true;
      if (res.failure) { failures.push(res.failure); }
      const existing = new Set(rows.map((r) => normName(r.capability)));
      const added: CapabilityGapRow[] = [];
      for (const n of res.arrays.newRows) {
        if (added.length >= MAX_NEW_ROWS) break;
        const capability = String(n?.capability ?? "").trim().slice(0, 200);
        if (!capability || existing.has(normName(capability))) continue;
        existing.add(normName(capability));
        const source: RequirementSourceKind = isRequirementSourceKind(n?.source) && kinds.includes(n.source) ? n.source : kinds[0];
        const base = newGapRowFromSource(source, capability, String(n?.requiredNote ?? ""), `LLM ${source === "synergy_area" ? "시너지 영역" : source === "s2_sketch" ? "S2 스케치" : "S1 요인"} 도출 초안 — 사람이 확인해 확정하세요.`);
        const nd = applyNecessityDraft(base, normalizeNecessityDraft(n));
        if (nd.mark) drafts[base.id] = nd.mark;
        added.push(nd.row);
      }
      proposedNew = added.length;
      if (added.length > 0) rows = [...rows, ...added];
    }
  }
  return { rows, drafts, proposedNew, failedCells, failures, answered };
}

/** Suffix for the note when some calls failed: honest partial-success wording, no raw response. */
export function failureSuffix(r: Pick<RequirementDraftResult, "failedCells" | "failures">): string {
  if (r.failures.length === 0) return "";
  const labels = [...new Set(r.failures.map((f) => FAILURE_LABEL[f]))].join("·");
  const cells = r.failedCells > 0 ? `${r.failedCells}개 칸은 응답 오류로 비웠습니다` : "일부 응답이 오류였습니다";
  return ` (${cells} — 사유: ${labels}; 다시 시도하면 해당 칸만 채웁니다)`;
}
