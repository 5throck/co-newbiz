// @version 1.0.0
/**
 * ADR-0171 amendment 2026-10-15 (2): "진출전략 제안 (AI)" at S5. The AI PROPOSES the entry-strategy modes (one main), the
 * rationale and the considered-but-rejected alternatives from STORED evidence only (S3 register, S4 decision record,
 * opportunity context, company profile/disclosure). Proposal only: nothing is written, human-entered values are never
 * overwritten (client fill-empty-only merge), nothing is decided (boundary #2). Pure helpers + an orchestrator with an
 * injected LLM call so unit tests run against a fake.
 */
import type { LlmMessage } from "./llm.ts";
import { HELD_STATUS_LABEL, NECESSITY_LABEL, type CapabilityGapRow } from "./capability-gap.ts";
import { scrubPii } from "./capability-judgement-draft.ts";
import { ENTRY_ALTERNATIVES_CAP, ENTRY_MODES, ENTRY_MODE_LABEL, ENTRY_RATIONALE_CAP, normalizeModes, type EntryMode, type EntryStrategyProposal } from "./greenfield-entry-strategy.ts";
import { FAILURE_LABEL, runJsonBatches, STRICT_JSON_REMINDER, type FailureCategory, type LlmCall } from "./llm-json.ts";

export const ENTRY_BASIS_CAP = 300;
export const ENTRY_REASON_CAP = 200;
const NO_WEB_NOTE = "외부 웹 검색은 쓰지 않았습니다(저장된 자료와 LLM만 사용).";

const pick = (r: Record<string, unknown>, ...names: string[]): unknown => {
  for (const n of names) if (r[n] !== undefined && r[n] !== null && r[n] !== "") return r[n];
  return undefined;
};
const text = (v: unknown, max: number): string => (typeof v === "string" ? scrubPii(v.replace(/\s+/g, " ").trim()).slice(0, max) : "");
const multiline = (v: unknown, max: number): string => (typeof v === "string" ? scrubPii(v.trim()).slice(0, max) : "");
const clip = (v: unknown, cap: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);

function parseMode(v: unknown): EntryMode | null {
  const t = String(v ?? "").trim().toLowerCase().replace(/[\s_\-*]+/g, "");
  if ((ENTRY_MODES as string[]).includes(t)) return t as EntryMode;
  for (const k of ENTRY_MODES) if (ENTRY_MODE_LABEL[k].replace(/\s/g, "") === t) return k;
  return t === "영입" ? "hire" : null;
}

/** Normalizes one raw item: valid unique modes only, exactly one main, caps, PII scrub, a mode without a reason is dropped. */
export function normalizeEntryProposal(raw: unknown): EntryStrategyProposal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const rawModes = pick(r, "modes", "진출방식");
  const seen = new Set<EntryMode>();
  const modes: EntryStrategyProposal["modes"] = [];
  let mainAsked: EntryMode | null = null;
  for (const it of Array.isArray(rawModes) ? rawModes : []) {
    const o = (typeof it === "string" ? { mode: it } : it) as Record<string, unknown> | null;
    if (!o || typeof o !== "object") continue;
    const mode = parseMode(o.mode ?? o.key ?? o.name);
    const reason = text(o.reason ?? o.사유 ?? o.basis, ENTRY_REASON_CAP);
    if (!mode || seen.has(mode) || !reason) continue; // a mode without a reason is never fabricated into a proposal
    seen.add(mode);
    modes.push({ mode, main: false, reason });
    if (o.main === true || String(o.main).toLowerCase() === "true") mainAsked ??= mode;
  }
  const norm = normalizeModes(modes.map((m) => m.mode), mainAsked);
  const finalModes = norm.modes.map((mode) => ({ ...modes.find((m) => m.mode === mode)!, main: mode === norm.main }));
  const b = pick(r, "basis", "근거출처");
  const bo = (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
  const bs = typeof b === "string" ? text(b, ENTRY_BASIS_CAP) : "";
  const cautionsRaw = pick(r, "cautions", "주의");
  const cautions = (Array.isArray(cautionsRaw) ? cautionsRaw : []).map((c) => text(c, 200)).filter(Boolean).slice(0, 5);
  const conf = String(r.confidence ?? "").toLowerCase();
  const proposal: EntryStrategyProposal = {
    modes: finalModes,
    rationale: multiline(pick(r, "rationale", "선택 근거", "근거"), ENTRY_RATIONALE_CAP),
    alternatives: multiline(pick(r, "alternatives", "대안", "검토 대안"), ENTRY_ALTERNATIVES_CAP),
    basis: {
      modes: text(bo.modes, ENTRY_BASIS_CAP) || (finalModes.length > 0 ? bs : "") || undefined,
      rationale: text(bo.rationale, ENTRY_BASIS_CAP) || undefined,
      alternatives: text(bo.alternatives, ENTRY_BASIS_CAP) || undefined,
      assumption: text(bo.assumption ?? bo.estimate ?? bo.가정, ENTRY_BASIS_CAP) || undefined,
    },
    cautions,
    ...(conf === "low" || conf === "medium" || conf === "high" ? { confidence: conf as "low" | "medium" | "high" } : {}),
  };
  // Strip undefined basis keys for stable JSON.
  proposal.basis = Object.fromEntries(Object.entries(proposal.basis).filter(([, v]) => v)) as EntryStrategyProposal["basis"];
  if (proposal.modes.length === 0 && !proposal.rationale && !proposal.alternatives) return null;
  return proposal;
}

// ── evidence (stored data only) ──────────────────────────────────────────────

/** S3 register lines: 필수 capabilities with a held gap come first and are marked. */
export function capabilityEvidenceLines(rows: readonly CapabilityGapRow[], cap = 20): string[] {
  const gap = (r: CapabilityGapRow) => r.necessity === "essential" && r.held.status !== "leading" && r.held.status !== "average";
  const sorted = [...rows].sort((a, b) => Number(gap(b)) - Number(gap(a)));
  return sorted.slice(0, cap).map((r) => {
    const a = r.attainability;
    return `- ${gap(r) ? "[핵심 격차] " : ""}${clip(r.capability, 100)} · 필요도 ${r.necessity ? NECESSITY_LABEL[r.necessity] : "미정"} · 필요 수준 ${clip(r.requiredLevel, 160) || "(미입력)"} · 보유 판정 ${HELD_STATUS_LABEL[r.held.status]} · 보유 수준 ${clip(r.currentLevel, 160) || "(미입력)"}${a?.expectedLevel ? ` · 기대 수준 ${clip(a.expectedLevel, 120)}` : ""}`;
  });
}

/** S4 route decision record (latest final), if stored. Never throws. */
export function routeDecisionLines(db: { query: (sql: string) => { get: (...a: unknown[]) => unknown } }, opportunityId: string): string[] {
  try {
    const d = db.query("SELECT track, sub_track, rationale, alternatives_considered FROM route_decision WHERE opportunity_id = ? AND status = 'final' ORDER BY decided_at DESC, id DESC LIMIT 1").get(opportunityId) as
      { track: string; sub_track: string | null; rationale: string | null; alternatives_considered: string | null } | undefined;
    if (!d) return [];
    return [
      `S4 진출 경로 결정: ${d.track}${d.sub_track ? ` / ${d.sub_track}` : ""}`,
      d.rationale ? `S4 결정 근거: ${clip(d.rationale, 400)}` : "",
      d.alternatives_considered ? `S4 검토 대안: ${clip(d.alternatives_considered, 300)}` : "",
    ].filter(Boolean);
  } catch { return []; }
}

// ── prompt and orchestration ─────────────────────────────────────────────────

export interface EntryPromptInput {
  oppName: string;
  marketScope: string | null;
  valueChainNode?: string | null;
  capabilityLines: string[];
  routeLines?: string[];
  contextLines?: string[];
  profileLines?: string[];
  disclosureLines?: string[];
}

export function buildEntryPrompt(i: EntryPromptInput): string {
  const ctx = [
    `기회: ${clip(i.oppName, 120)}`,
    i.marketScope?.trim() ? `시장 범위: ${clip(i.marketScope, 200)}` : "",
    i.valueChainNode?.trim() ? `밸류체인 위치: ${clip(i.valueChainNode, 120)}` : "",
    ...(i.contextLines ?? []),
  ].filter(Boolean).join("\n");
  return [
    "S5 진출전략(직접 구축 build / 전략 제휴 partner / 인력 영입 hire / 지분 투자 invest, 복수 선택 가능·주된 방식 1개)을 제안하세요. 제안일 뿐이며 결정·승인은 하지 않습니다.",
    "[기회 맥락]\n" + ctx,
    "[S3 필요 역량 레지스터 — [핵심 격차]는 필수 역량 중 부분 보유·미보유·미판정]\n" + (i.capabilityLines.length ? i.capabilityLines.join("\n") : "(없음)"),
    i.routeLines?.length ? "[S4 결정 기록]\n" + i.routeLines.join("\n") : "[S4 결정 기록] 저장된 내용 없음",
    i.profileLines?.length ? "[그룹·계열사 프로필 근거 — [미검증] 표시 줄은 맥락일 뿐 사실로 인용하지 않음]\n" + i.profileLines.join("\n") : "[그룹·계열사 프로필 근거] 없음",
    i.disclosureLines?.length ? "[공시·재무 근거]\n" + i.disclosureLines.join("\n") : "",
    [
      "규칙:",
      "- modes: build|partner|hire|invest 중 근거가 뒷받침하는 것만(invest는 공급·제휴·기술 기업의 소수·전략 지분 취득이며 사업 전체 인수·M&A 관점으로는 제안하지 않음), 각각 reason 한 줄. 정확히 하나만 main=true.",
      "- rationale(600자 이내): 선택한 방식이 S3 격차를 어떻게 해소하는지 격차·사실을 인용하고 핵심 가정을 한 문장으로 밝힙니다.",
      "- alternatives(600자 이내): 검토했으나 선택하지 않은 방식과 사유.",
      "- basis: {modes, rationale, alternatives, assumption} 각 한 줄 근거(어떤 자료에서 왔는지).",
      "- cautions: 근거 부족·상충 등 주의 사항(없으면 빈 배열). 근거가 없으면 modes를 비우세요. 사실을 지어내지 마세요. 개인정보는 쓰지 않습니다.",
      "출력(JSON만): {\"proposals\":[{\"id\":\"entry\",\"modes\":[{\"mode\":\"partner\",\"main\":true,\"reason\":\"\"}],\"rationale\":\"\",\"alternatives\":\"\",\"basis\":{\"modes\":\"\",\"rationale\":\"\",\"alternatives\":\"\",\"assumption\":\"\"},\"cautions\":[],\"confidence\":\"low|medium|high\"}]}",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

export interface EntryRunResult {
  proposal: EntryStrategyProposal | null;
  source: "llm" | "synthesis";
  note: string;
}

export async function runEntryStrategyDraft(opts: EntryPromptInput & {
  system: LlmMessage;
  call: LlmCall;
  deadlineMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}): Promise<EntryRunResult> {
  const results = await runJsonBatches({
    call: opts.call, batches: [[{ id: "entry" }]], arrayKeys: ["proposals"], label: "greenfield/entry-strategy-draft",
    buildMessages: (_rows, retry) => [opts.system, { role: "user" as const, content: buildEntryPrompt(opts) + (retry ? STRICT_JSON_REMINDER : "") }],
    itemRowId: () => "entry", rowId: (r) => r.id, maxTokens: 2400, concurrency: 1, deadlineMs: opts.deadlineMs, now: opts.now, log: opts.log,
  });
  const b = results[0];
  const item = b?.arrays.proposals[0];
  if (!item) {
    const label = b?.failure ? FAILURE_LABEL[b.failure as FailureCategory] : "응답 없음";
    return { proposal: null, source: "synthesis", note: `LLM 응답을 쓸 수 없어 제안하지 못했습니다(사유: ${label}). ${NO_WEB_NOTE} 다시 시도하세요.` };
  }
  const proposal = normalizeEntryProposal(item);
  if (!proposal) return { proposal: null, source: "llm", note: `근거가 부족해 제안하지 않았습니다. ${NO_WEB_NOTE} 사람이 직접 선택하세요.` };
  return { proposal, source: "llm", note: `진출전략을 제안했습니다 — 비어 있는 칸만 채우며 저장·결정은 사람이 합니다. ${NO_WEB_NOTE}` };
}
