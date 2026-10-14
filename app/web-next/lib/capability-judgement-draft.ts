// @version 1.0.0
/**
 * ADR-0171 amendment 2026-10-15: "판정 제안 (AI)" at S5. The AI PROPOSES the judgement inputs of a required capability:
 * 해소 방식, 기대 수준, 비용(백만원), 기간(개월), 달성 가능성 and a short 근거·증빙. Proposal only: nothing is written to
 * the DB, a non-empty value is never overwritten, nothing is confirmed (boundary #1/#2). Pure helpers + an
 * orchestrator that takes an injected LLM call, so unit tests run against a fake.
 */
import type { LlmMessage } from "./llm.ts";
import {
  HELD_STATUS_LABEL, NARRATIVE_CAP, NECESSITY_LABEL, RESOLUTION_EXPECTED_LEVEL_HINT, RESOLUTION_LABEL,
  type AttainabilityGrade, type CapabilityGapRow, type GapResolution,
} from "./capability-gap.ts";
import { isStale } from "./capability-linkage.ts";
import { JUDGEMENT_FIELD_LABEL, JUDGEMENT_ROW_CAP, type JudgementField, type JudgementProposal } from "./capability-judgement-ai-merge.ts";
export { JUDGEMENT_FIELD_LABEL, JUDGEMENT_ROW_CAP, mergeJudgementProposals, type AiMarks, type JudgementField, type JudgementProposal, type PageJudgementDraft } from "./capability-judgement-ai-merge.ts";
import { chunk, FAILURE_LABEL, runJsonBatches, STRICT_JSON_REMINDER, type FailureCategory, type LlmCall } from "./llm-json.ts";

export const JUDGEMENT_BATCH_ROWS = 4;
export const RATIONALE_CAP = 600;
export const BASIS_CAP = 300;
export const COST_MAX_KRW_M = 1_000_000; // 1 trillion KRW in millions: above this is not a defensible estimate
export const MONTHS_MAX = 240;

export interface NormalizedProposal {
  proposal: JudgementProposal | null;
  /** field -> why it stayed empty (only fields the model addressed or that were dropped by validation). */
  unfilled: Partial<Record<JudgementField, string>>;
}

const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
const GRADES: AttainabilityGrade[] = ["high", "medium", "low"];

const pick = (r: Record<string, unknown>, ...names: string[]): unknown => {
  for (const n of names) if (r[n] !== undefined && r[n] !== null && r[n] !== "") return r[n];
  return undefined;
};

/** PII scrub for free text: e-mail addresses, phone numbers and resident-registration-like numbers are removed. */
export function scrubPii(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "")
    .replace(/\b\d{6}[-\s]?[1-4]\d{6}\b/g, "")
    .replace(/(?:\+?82[-\s]?)?0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? scrubPii(v.replace(/\s+/g, " ").trim()).slice(0, max) : "");
const multiline = (v: unknown, max: number): string => (typeof v === "string" ? scrubPii(v.trim()).slice(0, max) : "");

function parseResolution(v: unknown): GapResolution | null {
  const t = String(v ?? "").trim().toLowerCase().replace(/[\s_\-]+/g, "");
  if ((RESOLUTIONS as string[]).includes(t)) return t as GapResolution;
  for (const k of RESOLUTIONS) if (RESOLUTION_LABEL[k].replace(/\s/g, "") === t) return k;
  return null;
}

function parseGrade(v: unknown): AttainabilityGrade | null {
  const t = String(v ?? "").trim().toLowerCase();
  if ((GRADES as string[]).includes(t)) return t as AttainabilityGrade;
  return ({ 높음: "high", 중간: "medium", 낮음: "low" } as Record<string, AttainabilityGrade>)[t] ?? null;
}

function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

/**
 * Normalizes one raw LLM item. Valid keys only; a value without a basis is dropped (never fabricated); cost/months
 * are non-negative numbers within sane bounds; high/low grades need a rationale (else the grade is dropped and the
 * row stays unjudged for that field, with a reason). One bad item never affects another.
 */
export function normalizeJudgementProposal(raw: unknown): NormalizedProposal {
  const unfilled: NormalizedProposal["unfilled"] = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { proposal: null, unfilled };
  const r = raw as Record<string, unknown>;
  const b = pick(r, "basis", "근거");
  const basisObj = (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
  const basisStr = typeof b === "string" ? text(b, BASIS_CAP) : "";
  const basisOf = (key: string, ...alts: string[]) => text(pick(basisObj, key, ...alts) ?? pick(r, `${key}Basis`, `${key}_basis`), BASIS_CAP) || basisStr;
  const rawUnfilled = (pick(r, "unfilled", "미작성") && typeof r.unfilled === "object" && !Array.isArray(r.unfilled) ? r.unfilled : {}) as Record<string, unknown>;
  const why = (f: JudgementField, fallback: string): string => text(rawUnfilled[f] ?? rawUnfilled[JUDGEMENT_FIELD_LABEL[f]], 120) || fallback;

  let resolution = parseResolution(pick(r, "resolution", "해소 방식", "해소방식"));
  const resBasis = basisOf("resolution", "해소 방식");
  if (pick(r, "resolution", "해소 방식", "해소방식") !== undefined && !resolution) unfilled.resolution = "해소 방식 값이 올바르지 않음";
  if (resolution && !resBasis) { resolution = null; unfilled.resolution = "해소 방식의 근거가 없음"; }

  let expectedLevel = multiline(pick(r, "expectedLevel", "expected_level", "기대 수준", "기대수준"), NARRATIVE_CAP);
  const expBasis = basisOf("expectedLevel", "expected_level", "기대 수준");
  if (expectedLevel && !expBasis) { expectedLevel = ""; unfilled.expectedLevel = "기대 수준의 근거가 없음"; }

  let cost: number | null = null;
  const costRaw = pick(r, "costKrwM", "cost_krw_m", "closingCostKrwM", "cost", "비용");
  const costBasis = basisOf("cost", "비용");
  const estimate = text(pick(basisObj, "estimate", "추정", "assumption", "가정") ?? pick(r, "estimate"), BASIS_CAP);
  if (costRaw !== undefined) {
    const n = parseNumber(costRaw);
    if (n === null || n < 0 || n > COST_MAX_KRW_M) unfilled.cost = "비용 값이 허용 범위를 벗어남";
    else if (!costBasis || !estimate) unfilled.cost = "비용 추정의 근거·가정이 없음";
    else cost = Math.round(n);
  }
  let months: number | null = null;
  const monthsRaw = pick(r, "monthsToAttain", "months_to_attain", "months", "기간");
  const monthsBasis = basisOf("months", "기간");
  if (monthsRaw !== undefined) {
    const n = parseNumber(monthsRaw);
    if (n === null || n < 0 || n > MONTHS_MAX) unfilled.months = "기간 값이 허용 범위를 벗어남";
    else if (!monthsBasis || !estimate) unfilled.months = "기간 추정의 근거·가정이 없음";
    else months = Math.round(n * 10) / 10;
  }

  const rationale = multiline(pick(r, "rationale", "근거·증빙", "근거증빙", "증빙"), RATIONALE_CAP);
  let grade = parseGrade(pick(r, "grade", "달성 가능성", "달성가능성"));
  const gradeBasis = basisOf("grade", "달성 가능성");
  if (pick(r, "grade", "달성 가능성", "달성가능성") !== undefined && !grade) unfilled.grade = "달성 가능성 값이 올바르지 않음";
  if (grade && !gradeBasis && !rationale) { grade = null; unfilled.grade = "달성 가능성의 근거가 없음"; }
  if ((grade === "high" || grade === "low") && !rationale) { grade = null; unfilled.grade = "높음·낮음은 근거·증빙이 필요해 미판정으로 둠"; }

  for (const f of ["resolution", "expectedLevel", "cost", "months", "grade"] as const) {
    const v = f === "resolution" ? resolution : f === "expectedLevel" ? expectedLevel : f === "cost" ? cost : f === "months" ? months : grade;
    if (v === null || v === "") unfilled[f] = unfilled[f] ?? why(f, "근거 부족");
  }

  const conf = String(r.confidence ?? "").toLowerCase();
  const proposal: JudgementProposal = {
    resolution, expectedLevel, costKrwM: cost, monthsToAttain: months, grade, rationale,
    basis: {
      resolution: resolution ? resBasis : "", expectedLevel: expectedLevel ? expBasis : "", cost: cost !== null ? costBasis : "",
      months: months !== null ? monthsBasis : "", grade: grade ? gradeBasis || rationale.slice(0, BASIS_CAP) : "",
      ...(cost !== null || months !== null ? { estimate } : {}),
    },
    ...(conf === "low" || conf === "medium" || conf === "high" ? { confidence: conf as "low" | "medium" | "high" } : {}),
  };
  const any = resolution || expectedLevel || cost !== null || months !== null || grade || rationale;
  return { proposal: any ? proposal : null, unfilled };
}

// ── targets and fill-empty-only ─────────────────────────────────────────────

/** A row needs judgement when it is stale, unjudged, or lacks a 해소 방식 or 기대 수준. */
export function needsJudgementDraft(r: CapabilityGapRow): boolean {
  return isStale(r) || !r.attainability || r.attainability.grade === null || !r.resolution || !(r.attainability.expectedLevel ?? "").trim();
}

/** Server targets: the requested ids that exist (default: rows that need judgement), at most JUDGEMENT_ROW_CAP. */
export function selectJudgementTargets(rows: CapabilityGapRow[], rowIds?: string[]): { targets: CapabilityGapRow[]; unknown: string[]; capped: number } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unknown = rowIds ? rowIds.filter((x) => !byId.has(x)) : [];
  const picked = rowIds ? rowIds.map((x) => byId.get(x)).filter((x): x is CapabilityGapRow => !!x) : rows.filter(needsJudgementDraft);
  const dedup = [...new Map(picked.map((r) => [r.id, r])).values()];
  return { targets: dedup.slice(0, JUDGEMENT_ROW_CAP), unknown, capped: Math.max(0, dedup.length - JUDGEMENT_ROW_CAP) };
}

/** Keep only the fields that are still empty on the stored row (a non-empty human value is never replaced). */
export function emptyOnly(row: CapabilityGapRow, p: JudgementProposal): { proposal: JudgementProposal | null; kept: JudgementField[] } {
  const a = row.attainability;
  const kept: JudgementField[] = [];
  const next: JudgementProposal = { ...p, basis: { ...p.basis } };
  if (row.resolution && next.resolution) { next.resolution = null; next.basis.resolution = ""; kept.push("resolution"); }
  if ((a?.expectedLevel ?? "").trim() && next.expectedLevel) { next.expectedLevel = ""; next.basis.expectedLevel = ""; kept.push("expectedLevel"); }
  if (a?.closingCostKrwM != null && next.costKrwM !== null) { next.costKrwM = null; next.basis.cost = ""; kept.push("cost"); }
  if (a?.monthsToAttain != null && next.monthsToAttain !== null) { next.monthsToAttain = null; next.basis.months = ""; kept.push("months"); }
  if (a?.grade && next.grade) { next.grade = null; next.basis.grade = ""; kept.push("grade"); }
  if ((a?.rationale ?? "").trim() && next.rationale) { next.rationale = ""; kept.push("rationale"); }
  // A high/low grade proposed together with a rationale the stored row already has stays valid; only drop when no rationale remains anywhere.
  if ((next.grade === "high" || next.grade === "low") && !next.rationale && !(a?.rationale ?? "").trim()) { next.grade = null; next.basis.grade = ""; }
  if (next.basis.cost === "" && next.basis.months === "") delete next.basis.estimate;
  const any = next.resolution || next.expectedLevel || next.costKrwM !== null || next.monthsToAttain !== null || next.grade || next.rationale;
  return { proposal: any ? next : null, kept };
}

// ── prompt ──────────────────────────────────────────────────────────────────

const clip = (v: unknown, cap: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);

function rowBlock(r: CapabilityGapRow): string {
  const a = r.attainability;
  const existing = [
    r.resolution ? `해소 방식=${RESOLUTION_LABEL[r.resolution]}` : "",
    a?.expectedLevel ? `기대 수준="${clip(a.expectedLevel, 200)}"` : "",
    a?.closingCostKrwM != null ? `비용=${a.closingCostKrwM}백만원` : "",
    a?.monthsToAttain != null ? `기간=${a.monthsToAttain}개월` : "",
    a?.grade ? `달성 가능성=${a.grade}` : "",
    a?.rationale ? `근거="${clip(a.rationale, 200)}"` : "",
  ].filter(Boolean).join(", ");
  const stale = isStale(r) ? " [S3가 바뀌어 재판정 필요 — 이전 값은 참고용]" : "";
  return [
    `- id: ${r.id}${stale}`,
    `  역량: ${clip(r.capability, 120)}${r.requiredNote ? ` (요구 메모: ${clip(r.requiredNote, 200)})` : ""}`,
    `  필요도: ${r.necessity ? NECESSITY_LABEL[r.necessity] : "미정"}${r.necessityScopeNote ? ` (범위: ${clip(r.necessityScopeNote, 120)})` : ""}`,
    `  필요 수준: ${clip(r.requiredLevel, 400) || "(미입력)"}`,
    `  보유 판정: ${HELD_STATUS_LABEL[r.held.status]} / 보유 수준: ${clip(r.currentLevel, 400) || "(미입력)"} / 보유 근거: ${clip(r.held.evidence, 300) || "(미입력)"}`,
    `  이미 입력된 값(건드리지 말 것): ${existing || "없음"}`,
  ].join("\n");
}

export interface JudgementPromptInput {
  oppName: string;
  marketScope: string | null;
  entryStrategy?: string | null;
  contextLines?: string[];
  profileLines?: string[];
  disclosureLines?: string[];
  rows: CapabilityGapRow[];
}

export function buildJudgementPrompt(i: JudgementPromptInput): string {
  const hints = RESOLUTIONS.map((k) => `- ${k}(${RESOLUTION_LABEL[k]}): 기대 수준 작성 안내 — ${RESOLUTION_EXPECTED_LEVEL_HINT[k]}`).join("\n");
  const ctx = [
    `기회: ${clip(i.oppName, 120)}`,
    i.marketScope?.trim() ? `시장 범위: ${clip(i.marketScope, 200)}` : "",
    i.entryStrategy?.trim() ? `S5 진출 전략(Build/Partner/Hire/Invest 선호 포함, 저장된 경우): ${clip(i.entryStrategy, 400)}` : "S5 진출 전략: 저장된 내용 없음",
    ...(i.contextLines ?? []),
  ].filter(Boolean).join("\n");
  return [
    "아래 필요 역량 행마다 S5 판정 입력을 제안하세요. 보유 판정·보유 수준에서 필요도·필요 수준으로 가는 공백을 메우는 경로입니다. 제안일 뿐이며 확정·승인은 하지 않습니다.",
    "[기회 맥락]\n" + ctx,
    i.profileLines?.length ? "[그룹·계열사 프로필 근거 — [미검증] 표시 줄은 맥락일 뿐 사실로 인용하지 않음]\n" + i.profileLines.join("\n") : "[그룹·계열사 프로필 근거] 없음",
    i.disclosureLines?.length ? "[공시·재무 근거]\n" + i.disclosureLines.join("\n") : "",
    "[기대 수준 작성 안내]\n" + hints,
    "[행]\n" + i.rows.map(rowBlock).join("\n"),
    [
      "규칙:",
      "- 이미 입력된 값이 있는 칸은 제안하지 마세요(null).",
      "- resolution은 build|partner|hire|invest 중 하나, basis.resolution에 한 줄 사유.",
      "- expectedLevel: 해소 뒤 도달하는 구체적 상태(필요 수준과 같은 문체, 400자 이내), basis.expectedLevel에 근거. 필요 수준과 비교해 충족 여부를 한 문장으로 밝히세요.",
      "- costKrwM(백만원)·monthsToAttain(개월): 입력이 뒷받침하는 합리적 규모일 때만 추정치. basis.cost·basis.months에 근거, basis.estimate에 가정을 적습니다. 아니면 null. 숫자를 지어내지 마세요.",
      "- grade: high|medium|low 또는 null, basis.grade에 사유. high·low는 rationale 필수.",
      "- rationale(600자 이내): S3 항목·프로필·공시 사실을 인용하고 핵심 가정을 한 문장으로 밝힙니다. 개인정보는 쓰지 않습니다.",
      "- 근거가 없는 칸은 null로 두고 unfilled에 {필드: 사유}를 적습니다.",
      "출력(JSON만): {\"rows\":[{\"id\":\"…\",\"resolution\":null,\"expectedLevel\":\"\",\"costKrwM\":null,\"monthsToAttain\":null,\"grade\":null,\"rationale\":\"\",\"basis\":{\"resolution\":\"\",\"expectedLevel\":\"\",\"cost\":\"\",\"months\":\"\",\"grade\":\"\",\"estimate\":\"\"},\"confidence\":\"low|medium|high\",\"unfilled\":{}}]}",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

// ── orchestration ───────────────────────────────────────────────────────────

export interface JudgementRunCounts { rows: number; proposed: number; fieldsFilled: number; fieldsUnfilled: number; kept: number; failedRows: number }
export interface JudgementRunResult {
  drafts: Record<string, JudgementProposal>;
  unfilled: Record<string, string>;
  counts: JudgementRunCounts;
  source: "llm" | "synthesis";
  note: string;
}

const NO_WEB_NOTE = "외부 웹 검색은 쓰지 않았습니다(저장된 자료와 LLM만 사용).";
const FIELD_KEYS: JudgementField[] = ["resolution", "expectedLevel", "cost", "months", "grade", "rationale"];

function filledFields(p: JudgementProposal): JudgementField[] {
  return FIELD_KEYS.filter((f) => (f === "resolution" ? p.resolution : f === "expectedLevel" ? p.expectedLevel : f === "cost" ? p.costKrwM !== null : f === "months" ? p.monthsToAttain !== null : f === "grade" ? p.grade : p.rationale));
}

/** True when the stored row already has a value for this field. */
export function rowHolds(row: CapabilityGapRow, f: JudgementField): boolean {
  const a = row.attainability;
  switch (f) {
    case "resolution": return !!row.resolution;
    case "expectedLevel": return !!(a?.expectedLevel ?? "").trim();
    case "cost": return a?.closingCostKrwM != null;
    case "months": return a?.monthsToAttain != null;
    case "grade": return !!a?.grade;
    case "rationale": return !!(a?.rationale ?? "").trim();
  }
}

export function judgementNote(c: JudgementRunCounts, topReasons: string[], failureLabels: string[], extra: string[]): string {
  const parts = [`${c.proposed}개 행 제안${c.kept > 0 ? `(이미 입력된 ${c.kept}칸은 유지)` : ""}, ${c.fieldsUnfilled}개 칸은 근거 부족으로 비움${topReasons.length > 0 ? ` — 사유 ${topReasons.join(" / ")}` : ""}.`];
  if (c.failedRows > 0) parts.push(`${c.failedRows}개 행은 응답 오류로 제안하지 못했습니다(사유: ${failureLabels.join("·")}); 다시 시도하세요.`);
  parts.push(NO_WEB_NOTE, ...extra, "제안은 저장 전 초안이며 확정은 사람이 합니다.");
  return parts.join(" ");
}

export async function runJudgementDraft(opts: {
  system: LlmMessage;
  oppName: string;
  marketScope: string | null;
  entryStrategy?: string | null;
  contextLines?: string[];
  profileLines?: string[];
  disclosureLines?: string[];
  targets: CapabilityGapRow[];
  call: LlmCall;
  deadlineMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}): Promise<JudgementRunResult> {
  const { targets } = opts;
  const counts: JudgementRunCounts = { rows: targets.length, proposed: 0, fieldsFilled: 0, fieldsUnfilled: 0, kept: 0, failedRows: 0 };
  const drafts: Record<string, JudgementProposal> = {};
  const unfilled: Record<string, string> = {};
  const results = await runJsonBatches({
    call: opts.call, batches: chunk(targets, JUDGEMENT_BATCH_ROWS), arrayKeys: ["rows"], label: "capability-attainability/ai-draft",
    buildMessages: (batch, retry) => [
      opts.system,
      { role: "user" as const, content: buildJudgementPrompt({ oppName: opts.oppName, marketScope: opts.marketScope, entryStrategy: opts.entryStrategy, contextLines: opts.contextLines, profileLines: opts.profileLines, disclosureLines: opts.disclosureLines, rows: batch }) + (retry ? STRICT_JSON_REMINDER : "") },
    ],
    itemRowId: (it) => String(it.id ?? it.rowId ?? it.row_id ?? "").trim(), rowId: (r) => r.id,
    maxTokens: 3200, concurrency: 2, deadlineMs: opts.deadlineMs, now: opts.now, log: opts.log,
  });
  const byId = new Map<string, Record<string, unknown>>();
  for (const b of results) for (const it of b.arrays.rows) { const id = String(it.id ?? it.rowId ?? it.row_id ?? "").trim(); if (id && !byId.has(id)) byId.set(id, it); }
  const failures = results.filter((b) => b.failure);
  const labels = [...new Set(failures.map((b) => FAILURE_LABEL[b.failure as FailureCategory]))];
  const answered = results.some((b) => b.arrays.rows.length > 0 || !b.failure);
  if (!answered) {
    counts.failedRows = targets.length;
    return { drafts, unfilled, counts, source: "synthesis", note: `LLM 응답을 쓸 수 없어 제안하지 못했습니다(사유: ${labels.join("·")}). ${NO_WEB_NOTE} 다시 시도하세요.` };
  }
  const reasonCount = new Map<string, number>();
  for (const t of targets) {
    const raw = byId.get(t.id);
    if (!raw) { counts.failedRows++; unfilled[t.id] = "LLM 응답에 이 행이 없음"; continue; }
    const norm = normalizeJudgementProposal(raw);
    const stripped = norm.proposal ? emptyOnly(t, norm.proposal) : { proposal: null, kept: [] as JudgementField[] };
    counts.kept += stripped.kept.length;
    const reasons: string[] = [];
    for (const [f, why] of Object.entries(norm.unfilled)) {
      // A field the row already holds is not "missing".
      if (stripped.kept.includes(f as JudgementField) || rowHolds(t, f as JudgementField)) continue;
      reasons.push(`${JUDGEMENT_FIELD_LABEL[f as JudgementField]}: ${why}`);
      counts.fieldsUnfilled++;
      reasonCount.set(why, (reasonCount.get(why) ?? 0) + 1);
    }
    if (reasons.length > 0) unfilled[t.id] = reasons.join("; ").slice(0, 300);
    if (stripped.proposal) {
      drafts[t.id] = stripped.proposal;
      counts.proposed++;
      counts.fieldsFilled += filledFields(stripped.proposal).length;
    }
  }
  const top = [...reasonCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `${w}(${n}칸)`);
  return { drafts, unfilled, counts, source: "llm", note: judgementNote(counts, top, labels, []) };
}

/** Compact S5 strategy text for the prompt: entry strategy + rationale as stored (may be empty). */
export function strategyText(row: { entry_strategy?: string | null; alternatives_considered?: string | null } | null | undefined): string {
  if (!row) return "";
  return [row.entry_strategy ? `진출 전략: ${clip(row.entry_strategy, 300)}` : "", row.alternatives_considered ? `검토 대안: ${clip(row.alternatives_considered, 200)}` : ""].filter(Boolean).join(" / ");
}

// ── stored evidence (no network) ────────────────────────────────────────────

interface MemberLite { id: string; company_name: string; group_id: string; dart_corp_code?: string | null }
const MEMBER_CAP = 6;

/**
 * Group/affiliate profile + disclosure lines for the judgement prompt, from STORED data only (same scoping as the
 * S3 holding check: the latest synergy analysis target, else every registered company). Unverified profile
 * text is labelled and is context only. Never throws.
 */
export async function loadJudgementEvidence(
  db: { query: (sql: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown } },
  opportunityId: string,
): Promise<{ profileLines: string[]; disclosureLines: string[]; companyNames: string[] }> {
  const out = { profileLines: [] as string[], disclosureLines: [] as string[], companyNames: [] as string[] };
  try {
    const { loadLatestProfile } = await import("./company-profile-pipeline.ts");
    const { profileEvidence, disclosureEvidenceLines, loadDisclosureItems } = await import("./capability-holding-context.ts");
    const all = db.query("SELECT id, company_name, group_id, dart_corp_code FROM company_group_member").all() as MemberLite[];
    const syn = db.query("SELECT target_type, member_id, group_id FROM synergy_analysis WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1").get(opportunityId) as { target_type: string; member_id: string | null; group_id: string | null } | undefined;
    let scoped = all;
    if (syn?.target_type === "affiliate" && syn.member_id) scoped = all.filter((m) => m.id === syn.member_id);
    else if (syn?.target_type === "group" && syn.group_id) scoped = all.filter((m) => m.group_id === syn.group_id);
    for (const m of scoped.slice(0, MEMBER_CAP)) {
      const prof = loadLatestProfile(db as never, { kind: "member", id: m.id });
      if (!prof) continue;
      out.companyNames.push(m.company_name);
      const ev = profileEvidence(m.company_name, prof);
      out.profileLines.push(...ev.lines);
      out.disclosureLines.push(...disclosureEvidenceLines(m.company_name, loadDisclosureItems(db, m.dart_corp_code ?? prof.dartCorpCode ?? null, prof)));
    }
  } catch { /* evidence is optional context */ }
  return out;
}
