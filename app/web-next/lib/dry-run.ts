// 2026-09-15-runtime-pm-agent-orchestration §6.6 (D5 드라이런 실험 레인) —
// 세션 스코프 오버라이드 저장소 + 실코드 경로 실행 라이브러리.
//
// 불변식(§6.6, 테스트가 증명한다):
//  1. SSOT 불변 — 이 모듈은 prompts.json / flow.spec.yaml / agents/*.md 을
//     절대 쓰지 않는다. 오버라이드는 dry_run_session 행으로만 존재하고,
//     영구 반영의 유일한 경로는 제안 패키지 → 저장소 PR(Design Gate)이다.
//  2. 비즈니스 테이블 무기록 — execute는 dry_run_session + llm_call_log
//     (is_dry_run=1)만 쓴다. opportunity/project/factor/score 등 어떤
//     비즈니스 테이블에도 기록하지 않는다(ADR-0016 계열 데이터 신뢰도 경계).
//  3. 운영 경로 재사용 — 실행은 completeOrFallback(운영 진입점) + dryRun
//     컨텍스트로만 이루어진다. 실험 전용 복제 경로를 만들지 않는다.
//     agentOverride도 PM 관문(requireAgentMeta 로스터 검증)을 통과한다.
//
// 비용 산출 근거(화면 설계 2026-10-24 §13-2 해소): 첫 실행은 직전 측정값이
// 없으므로 "unknown, confirm to proceed" — max_tokens 상한(DRY_RUN_MAX_TOKENS)
// 만 안내하고 확인을 요구한다. 측정값이 있으면 동일 agent_key+purpose의 최근
// 성공 llm 호출 실측 비용을 근거로 제시한다.
//
// TTL(§6.8): expires_at 이 지난 세션의 정리는 v1에서 읽기/실행 경로의
// 소거(purgeExpiredDryRunSessions)로 수행한다 — 운영 컨테이너에는 의도적으로
// 스케줄러가 없고(operations-manual §3, OS 레벨 watch 파이프라인만 존재)
// 이번 로우에서 호스트 작업을 추가하지 않는다(후속 infra 과제).
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { CATALOG_VERSION, SPEC_VERSION, PM_CATALOG, type PmCatalogEntry } from "./pm-catalog.generated.ts";
import { PROMPTS, type PromptKey } from "./prompts.generated.ts";
import { z } from "zod";
import { completeOrFallback, completeStructured, type DryRunContext, type LlmSource } from "./llm.ts";

export const DRY_RUN_MAX_TOKENS = 1500;
/** 세션 TTL(일) — 만료 세션은 읽기/실행 경로에서 소거된다(§6.8). */
export const DRY_RUN_SESSION_TTL_DAYS = 14;

export interface DryRunSessionRow {
  id: string;
  status: "active" | "closed" | "expired";
  prompt_key: string;
  activity_id: string | null;
  base_agent_key: string;
  override_agent_key: string | null;
  override_system: string | null;
  preference: "base" | "override" | "tie" | null;
  preference_note: string | null;
  base_output: string | null;
  override_output: string | null;
  base_output_source: LlmSource | null;
  override_output_source: LlmSource | null;
  base_run_call_id: string | null;
  override_run_call_id: string | null;
  cost_usd: number | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  finished_at: string | null;
}

// ── 프롬프트 검증 ────────────────────────────────────────────────────────────

export type DryRunnableCheck =
  | { ok: true; entry: PmCatalogEntry; agentKey: string }
  | { ok: false; code: "unknown_prompt" | "dynamic_prompt"; reason: string };

/** 드라이런 대상 프롬프트 검증 — 카탈로그 존재 + 정적 에이전트 소유.
 * 동적 프롬프트(agent=null: s8.business_case_prose, committee.position)는
 * 호출 시점 에이전트 키가 호출부 소유라 v1 드라이런 대상에서 제외한다(§6.10). */
export function dryRunnablePromptCheck(promptKey: string): DryRunnableCheck {
  const entry = (PM_CATALOG as Record<string, PmCatalogEntry | undefined>)[promptKey];
  if (!entry) return { ok: false, code: "unknown_prompt", reason: `프롬프트 '${promptKey}'가 카탈로그에 없습니다.` };
  if (entry.agentKey === null) {
    return {
      ok: false,
      code: "dynamic_prompt",
      reason: `프롬프트 '${promptKey}'는 동적 에이전트 프롬프트(호출 시점 에이전트 선언)라 v1 드라이런 대상이 아닙니다 — 재배정 기준이 되는 카탈로그 에이전트가 없습니다.`,
    };
  }
  return { ok: true, entry, agentKey: entry.agentKey };
}

// ── 비용 산출 ────────────────────────────────────────────────────────────────

export interface DryRunCostEstimate {
  basis: "measured" | "unknown";
  costUsd: number | null;
  measuredAt: string | null;
  agentKey: string;
  purpose: string;
  maxTokens: number;
  note: string;
}

/** 실행 전 비용 추정(§6.2 확인 대화상자용) — 최근 동일 agent_key+purpose 성공
 * llm 호출의 실측 비용, 없으면 "unknown, confirm to proceed"(토큰 상한 안내). */
export function estimateDryRunCost(agentKey: string, purpose: string): DryRunCostEstimate {
  const row = getDb()
    .query(
      `SELECT cost_usd, created_at FROM llm_call_log
       WHERE agent_key = ? AND purpose = ? AND source = 'llm' AND ok = 1 AND cost_usd IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(agentKey, purpose) as { cost_usd: number; created_at: string } | null;
  if (row) {
    return {
      basis: "measured",
      costUsd: row.cost_usd,
      measuredAt: row.created_at,
      agentKey,
      purpose,
      maxTokens: DRY_RUN_MAX_TOKENS,
      note: "직전 동일 에이전트·목적 호출의 실측 비용 기준(1회 호출 상한 추정) — 실제 비용은 모델·입력 길이에 따라 달라질 수 있습니다.",
    };
  }
  return {
    basis: "unknown",
    costUsd: null,
    measuredAt: null,
    agentKey,
    purpose,
    maxTokens: DRY_RUN_MAX_TOKENS,
    note: "측정된 비용 기록이 없습니다(첫 실행) — 토큰 상한 " + DRY_RUN_MAX_TOKENS + " 기준 보수적 추정만 가능합니다. 실행 전 확인하세요.",
  };
}

// ── 세션 CRUD ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function sessionRow(id: string): DryRunSessionRow | null {
  return (getDb().query("SELECT * FROM dry_run_session WHERE id = ?").get(id) ?? null) as DryRunSessionRow | null;
}

export interface CreateDryRunSessionInput {
  promptKey: string;
  overrideSystem?: string | null;
  overrideAgentKey?: string | null;
  createdBy: string;
}

export type CreateDryRunSessionResult =
  | { ok: true; session: DryRunSessionRow; estimate: DryRunCostEstimate }
  | { ok: false; code: "unknown_prompt" | "dynamic_prompt" | "unknown_agent" | "empty_override_system"; reason: string };

/** 세션 생성 — 검증만 하고 실행하지 않는다(§6.2: 실행은 별도 확인 단계).
 * 오버라이드 없는(편집 전) 세션 생성도 허용한다 — 편집기 시작점. */
export function createDryRunSession(input: CreateDryRunSessionInput): CreateDryRunSessionResult {
  const check = dryRunnablePromptCheck(input.promptKey);
  if (!check.ok) return check;
  if (input.overrideAgentKey) {
    if (!AGENT_KEYS.has(input.overrideAgentKey)) {
      return { ok: false, code: "unknown_agent", reason: `에이전트 키 '${input.overrideAgentKey}'가 agents/ 로스터에 없습니다.` };
    }
  }
  const overrideSystem = input.overrideSystem?.trim() || null;
  if (input.overrideSystem !== undefined && input.overrideSystem !== null && input.overrideSystem.trim() === "") {
    return { ok: false, code: "empty_override_system", reason: "override_system 은 비어 있을 수 없습니다 — 프롬프트 축을 취소하려면 필드를 생략하세요." };
  }
  const db = getDb();
  const id = `dr_${ulid()}`;
  const now = nowIso();
  const expires = new Date(Date.now() + DRY_RUN_SESSION_TTL_DAYS * 86400_000).toISOString();
  db.run(
    `INSERT INTO dry_run_session (id, status, prompt_key, activity_id, base_agent_key, override_agent_key, override_system,
                                  created_by, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, "active", input.promptKey, check.entry.activityId, check.agentKey, input.overrideAgentKey ?? null, overrideSystem,
      input.createdBy, now, expires],
  );
  return { ok: true, session: sessionRow(id)!, estimate: estimateDryRunCost(check.agentKey, check.entry.purpose) };
}

/** TTL 소거(§6.8) — expires_at 이 지난 세션 행 삭제. 런 장부(llm_call_log)의
 * is_dry_run 행은 append-only로 남는다. v1은 읽기/실행 경로에서 호출한다. */
export function purgeExpiredDryRunSessions(): number {
  const r = getDb().run("DELETE FROM dry_run_session WHERE expires_at < ?", [nowIso()]);
  return r.changes;
}

export interface DryRunSessionDetail extends DryRunSessionRow {
  purpose: string;
  base_system: string;
  /** 세션 누계(dry_run_group_id = 세션 id 인 런 장부 행 집계). */
  ledger: { runs: number; llmCalls: number; costUsd: number | null; lastRunAt: string | null };
}

export function getDryRunSessionDetail(id: string): DryRunSessionDetail | null {
  const s = sessionRow(id);
  if (!s) return null;
  const ledger = getDb()
    .query(
      `SELECT COUNT(*) AS runs, SUM(CASE WHEN source = 'llm' THEN 1 ELSE 0 END) AS llm_calls,
              SUM(cost_usd) AS cost_usd, MAX(created_at) AS last_run_at
       FROM llm_call_log WHERE dry_run_group_id = ?`,
    )
    .get(id) as { runs: number; llm_calls: number; cost_usd: number | null; last_run_at: string | null };
  return {
    ...s,
    purpose: PROMPTS[s.prompt_key as PromptKey]?.purpose ?? s.prompt_key,
    base_system: PROMPTS[s.prompt_key as PromptKey]?.system ?? "",
    ledger: { runs: ledger.runs, llmCalls: ledger.llm_calls, costUsd: ledger.cost_usd, lastRunAt: ledger.last_run_at },
  };
}

export function listDryRunSessions(opts: { createdBy?: string | null; limit?: number } = {}): DryRunSessionDetail[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where = opts.createdBy ? "WHERE s.created_by = ?" : "";
  const params: (string | number)[] = opts.createdBy ? [opts.createdBy, limit] : [limit];
  const rows = getDb()
    .query(
      `SELECT s.* FROM dry_run_session s ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
    )
    .all(...params) as DryRunSessionRow[];
  return rows.map((s) => getDryRunSessionDetail(s.id)!).filter(Boolean);
}

// ── 실행(§6.6 (2)) ───────────────────────────────────────────────────────────

export interface DryRunLegResult {
  text: string;
  source: LlmSource;
  provider: string;
  callId: string | null;
  costUsd: number | null;
}

export interface DryRunExecutionResult {
  session: DryRunSessionDetail;
  base: DryRunLegResult;
  override: DryRunLegResult;
}

export type ExecuteDryRunResult =
  | { ok: true; result: DryRunExecutionResult }
  | { ok: false; code: "not_found" | "no_override" | "expired" | "unknown_prompt"; reason: string };

/** 실행 후 그룹의 최근 런 장부 행(방금 기록된 호출) — call id·비용 회수용. */
function latestGroupCall(groupId: string): { id: string; cost_usd: number | null; source: string } | null {
  return (getDb()
    .query(
      `SELECT id, cost_usd, source FROM llm_call_log WHERE dry_run_group_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(groupId) ?? null) as { id: string; cost_usd: number | null; source: string } | null;
}

function sessionCost(groupId: string): number | null {
  const r = getDb().query("SELECT SUM(cost_usd) AS c FROM llm_call_log WHERE dry_run_group_id = ?").get(groupId) as { c: number | null };
  return r.c;
}

/**
 * 드라이런 실행 — base(카탈로그 원본)와 override(세션 오버라이드) 두 호출을
 * 모두 운영 진입점 completeOrFallback으로 수행한다. base 호출에도 dryRun
 * 컨텍스트(groupId)를 붙여 is_dry_run=1로 장부화한다. LLM 미구성이면 두 다리
 * 모두 결정론 폴백 텍스트(source=synthesis)로 반환하고 오류내지 않는다.
 * 재실행은 기존 결과를 덮지 않고 런 장부에 새 행으로 적재된다(벤치 A3-3u) —
 * 세션의 *_output 열은 "최근 실행" 뷰이고 전체 이력은 dry_run_group_id로
 * llm_call_log에서 조회한다.
 */
export async function executeDryRun(sessionId: string, opts: { user?: string | null } = {}): Promise<ExecuteDryRunResult> {
  const s = sessionRow(sessionId);
  if (!s) return { ok: false, code: "not_found", reason: "드라이런 세션을 찾을 수 없습니다." };
  if (s.expires_at < nowIso()) {
    purgeExpiredDryRunSessions();
    return { ok: false, code: "expired", reason: "세션 TTL이 만료되어 삭제되었습니다 — 새 세션을 만드세요." };
  }
  if (!s.override_system && !s.override_agent_key) {
    return { ok: false, code: "no_override", reason: "오버라이드가 없는 실행은 base와 동일합니다 — 프롬프트 또는 에이전트 축을 오버라이드한 뒤 실행하세요." };
  }
  const check = dryRunnablePromptCheck(s.prompt_key);
  if (!check.ok) return { ok: false, code: "unknown_prompt", reason: check.reason };

  const entry = check.entry;
  const baseSystem = PROMPTS[s.prompt_key as PromptKey].system;
  const overrideSystem = s.override_system ?? baseSystem;
  const userText = opts.user?.trim() || `드라이런 샘플 입력 — 활동 목적: ${entry.purpose}`;
  const fallbackText = () =>
    `[결정론 폴백 — 드라이런] LLM이 구성되지 않았거나 호출에 실패했습니다. 이 텍스트는 템플릿 출력이며 모델 산출물이 아닙니다.`;
  const groupId = sessionId; // dry_run_group_id = 세션 id — 세션 비용·이력 조인 키(0171)

  // base 다리 — 오버라이드 없음, 장부 플래그만.
  const baseRes = await completeOrFallback(
    [{ role: "system", content: baseSystem }, { role: "user", content: userText }],
    fallbackText,
    { agent: { key: check.agentKey, purpose: entry.purpose }, maxTokens: DRY_RUN_MAX_TOKENS, dryRun: { groupId } },
  );
  const baseCall = latestGroupCall(groupId);

  // override 다리 — promptOverride는 미오버라이드 시 원본과 동일한 값을 명시 전달해
  // 두 다리의 유일한 차이가 오버라이드가 되도록 한다.
  const overrideDry: DryRunContext = { groupId, promptOverride: overrideSystem };
  if (s.override_agent_key) overrideDry.agentOverride = s.override_agent_key;
  const overrideRes = await completeOrFallback(
    [{ role: "system", content: baseSystem }, { role: "user", content: userText }],
    fallbackText,
    { agent: { key: s.override_agent_key ?? check.agentKey, purpose: entry.purpose }, maxTokens: DRY_RUN_MAX_TOKENS, dryRun: overrideDry },
  );
  const overrideCall = latestGroupCall(groupId);

  const now = nowIso();
  getDb().run(
    `UPDATE dry_run_session SET base_output = ?, override_output = ?, base_output_source = ?, override_output_source = ?,
            base_run_call_id = ?, override_run_call_id = ?, cost_usd = ?, status = 'closed', finished_at = ?
     WHERE id = ?`,
    [baseRes.text, overrideRes.text, baseRes.source, overrideRes.source,
      baseCall?.id ?? null, overrideCall?.id ?? null, sessionCost(groupId), now, sessionId],
  );
  const callCost = (id: string | null) =>
    id ? ((getDb().query("SELECT cost_usd FROM llm_call_log WHERE id = ?").get(id) as { cost_usd: number | null } | null)?.cost_usd ?? null) : null;
  return {
    ok: true,
    result: {
      session: getDryRunSessionDetail(sessionId)!,
      base: { text: baseRes.text, source: baseRes.source, provider: baseRes.provider, callId: baseCall?.id ?? null, costUsd: callCost(baseCall?.id ?? null) },
      override: { text: overrideRes.text, source: overrideRes.source, provider: overrideRes.provider, callId: overrideCall?.id ?? null, costUsd: callCost(overrideCall?.id ?? null) },
    },
  };
}

// ── 선호 기록(§6.6 (3) 골든셋 시드) ─────────────────────────────────────────

export type RecordPreferenceResult =
  | { ok: true; session: DryRunSessionRow }
  | { ok: false; code: "not_found" | "invalid_preference" | "not_executed" | "invalid_note"; reason: string };

/** 3상(base|override|tie) + 비고 1줄 — 화면 설계 §13-5 스키마. 실행 전 기록 불가. */
export function recordPreference(sessionId: string, preference: string, note?: string | null): RecordPreferenceResult {
  const s = sessionRow(sessionId);
  if (!s) return { ok: false, code: "not_found", reason: "드라이런 세션을 찾을 수 없습니다." };
  if (preference !== "base" && preference !== "override" && preference !== "tie") {
    return { ok: false, code: "invalid_preference", reason: "preference 는 base, override, tie 중 하나여야 합니다." };
  }
  if (note !== undefined && note !== null && note.length > 500) {
    return { ok: false, code: "invalid_note", reason: "비고는 500자 이내 한 줄로 남기세요." };
  }
  if (s.base_output === null) {
    return { ok: false, code: "not_executed", reason: "드라이런 실행 전에는 선호를 기록할 수 없습니다." };
  }
  getDb().run("UPDATE dry_run_session SET preference = ?, preference_note = ? WHERE id = ?", [
    preference, note?.trim() || null, sessionId,
  ]);
  return { ok: true, session: sessionRow(sessionId)! };
}

// ── 제안 패키지(§6.6 (4)) ────────────────────────────────────────────────────

export interface DryRunExportPackage {
  sessionId: string;
  promptKey: string;
  activityId: string | null;
  stageId: string | null;
  purpose: string;
  catalogVersion: string;
  specVersion: string;
  baseAgentKey: string;
  overrideAgentKey: string | null;
  baseSystem: string;
  /** 세션이 명시한 오버라이드 원문(미설정 null — 실행 시 base 원본 사용). */
  overrideSystemProvided: string | null;
  /** 실행 시 적용된 오버라이드 시스템 프롬프트(override ?? base). */
  effectiveOverrideSystem: string;
  diff: { addedLines: number; removedLines: number; changed: boolean };
  preference: "base" | "override" | "tie" | null;
  preferenceNote: string | null;
  evidence: {
    baseOutput: string | null;
    overrideOutput: string | null;
    baseSource: LlmSource | null;
    overrideSource: LlmSource | null;
    baseRunCallId: string | null;
    overrideRunCallId: string | null;
    costUsd: number | null;
    ledgerRuns: number;
    ledgerLlmCalls: number;
    lastRunAt: string | null;
  };
  createdBy: string;
  generatedAt: string;
  /** 제안 전용 선언 — 이 패키지의 유일한 착지 경로는 저장소 PR(Design Gate)이다. */
  proposalOnly: true;
}

/** 줄 단위 규모 요약(multiset 라인 비교 — v1 휴리스틱) — 패키지 독자는 diff 본문을
 * baseSystem/overrideSystem 원문 비교로 확인한다. */
function diffSummary(base: string, override: string): DryRunExportPackage["diff"] {
  const baseLines = base.split("\n");
  const overrideLines = override.split("\n");
  const baseSet = new Map<string, number>();
  for (const l of baseLines) baseSet.set(l, (baseSet.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of overrideLines) {
    const remaining = baseSet.get(l) ?? 0;
    if (remaining > 0) baseSet.set(l, remaining - 1);
    else added += 1;
  }
  let removed = 0;
  for (const c of baseSet.values()) if (c > 0) removed += c;
  return { addedLines: added, removedLines: removed, changed: added + removed > 0 };
}

export function buildExportPackage(sessionId: string): { ok: true; pkg: DryRunExportPackage } | { ok: false; code: "not_found" | "not_executed"; reason: string } {
  const d = getDryRunSessionDetail(sessionId);
  if (!d) return { ok: false, code: "not_found", reason: "드라이런 세션을 찾을 수 없습니다." };
  if (d.base_output === null) return { ok: false, code: "not_executed", reason: "실행 이력이 없는 세션은 내보낼 수 없습니다." };
  const entry = (PM_CATALOG as Record<string, PmCatalogEntry | undefined>)[d.prompt_key];
  const effective = d.override_system ?? d.base_system;
  return {
    ok: true,
    pkg: {
      sessionId: d.id,
      promptKey: d.prompt_key,
      activityId: d.activity_id,
      stageId: entry?.stageId ?? null,
      purpose: d.purpose,
      catalogVersion: CATALOG_VERSION,
      specVersion: SPEC_VERSION,
      baseAgentKey: d.base_agent_key,
      overrideAgentKey: d.override_agent_key,
      baseSystem: d.base_system,
      overrideSystemProvided: d.override_system,
      effectiveOverrideSystem: effective,
      diff: diffSummary(d.base_system, effective),
      preference: d.preference,
      preferenceNote: d.preference_note,
      evidence: {
        baseOutput: d.base_output,
        overrideOutput: d.override_output,
        baseSource: d.base_output_source,
        overrideSource: d.override_output_source,
        baseRunCallId: d.base_run_call_id,
        overrideRunCallId: d.override_run_call_id,
        costUsd: d.ledger.costUsd,
        ledgerRuns: d.ledger.runs,
        ledgerLlmCalls: d.ledger.llmCalls,
        lastRunAt: d.ledger.lastRunAt,
      },
      createdBy: d.created_by,
      generatedAt: nowIso(),
      proposalOnly: true,
    },
  };
}

/** 제안 패키지를 markdown 문서로 렌더 — Design Gate PR 본문의 재료다. */
export function renderExportMarkdown(pkg: DryRunExportPackage): string {
  const lines: string[] = [
    "# 드라이런 제안 패키지 (proposal-only)",
    "",
    `> **제안 전용** — 이 문서는 게이트 결정이 아니다. 착지 경로는 저장소 PR(Design Gate)뿐이다.`,
    "",
    `| 항목 | 값 |`,
    `|---|---|`,
    `| 세션 | \`${pkg.sessionId}\` |`,
    `| 프롬프트 키 | \`${pkg.promptKey}\` |`,
    `| 활동 | ${pkg.activityId ? `\`${pkg.stageId}.${pkg.activityId}\`` : "(미매핑)"} |`,
    `| 목적 | ${pkg.purpose} |`,
    `| base 에이전트 | \`${pkg.baseAgentKey}\` |`,
    `| override 에이전트 | ${pkg.overrideAgentKey ? `\`${pkg.overrideAgentKey}\`` : "(미변경)"} |`,
    `| 카탈로그 버전 | ${pkg.catalogVersion} (spec ${pkg.specVersion}) |`,
    `| diff | +${pkg.diff.addedLines} / -${pkg.diff.removedLines} 줄 |`,
    `| 선호 | ${pkg.preference ?? "(미판정)"}${pkg.preferenceNote ? ` — ${pkg.preferenceNote}` : ""} |`,
    `| 세션 비용 | ${pkg.evidence.costUsd === null ? "미측정" : `$${pkg.evidence.costUsd.toFixed(6)}`} (${pkg.evidence.ledgerLlmCalls} llm / ${pkg.evidence.ledgerRuns} runs) |`,
    `| 생성 | ${pkg.generatedAt} by ${pkg.createdBy} |`,
    "",
    "## base 시스템 프롬프트 (카탈로그 원본)",
    "",
    "```",
    pkg.baseSystem,
    "```",
    "",
    "## override 시스템 프롬프트 (세션 오버라이드)",
    "",
    "```",
    pkg.effectiveOverrideSystem,
    "```",
    "",
    "## 드라이런 증거",
    "",
    `### base 산출물 (${pkg.evidence.baseSource ?? "?"})`,
    "",
    "```",
    pkg.evidence.baseOutput ?? "(없음)",
    "```",
    "",
    `### override 산출물 (${pkg.evidence.overrideSource ?? "?"})`,
    "",
    "```",
    pkg.evidence.overrideOutput ?? "(없음)",
    "```",
    "",
    `런 장부 참조: base \`${pkg.evidence.baseRunCallId ?? "-"}\` / override \`${pkg.evidence.overrideRunCallId ?? "-"}\` (llm_call_log, is_dry_run=1)`,
    "",
  ];
  return lines.join("\n");
}

// ── AI 개선 제안(§6.7 D6) ───────────────────────────────────────────────────

const SUGGEST_MAX_FAILURES = 5;

export interface DryRunSuggestion {
  proposalOnly: true;
  available: boolean;
  reason: string | null;
  promptKey: string;
  proposal: {
    type: "prompt_improvement" | "agent_reassignment";
    improvedSystem: string | null;
    candidateAgents: Array<{ key: string; rationale: string }>;
    rationale: string;
  } | null;
  evidence: {
    recentFailures: number;
    failures: Array<{ createdAt: string; error: string }>;
    note: string | null;
  };
}

export type SuggestDryRunResult =
  | { ok: true; suggestion: DryRunSuggestion }
  | { ok: false; code: "unknown_prompt" | "dynamic_prompt"; reason: string };

/**
 * §6.7 제안 전용 — pm.flow_suggest 카탈로그 활동으로 제안을 생성한다.
 * 제안 호출 자체도 PM 관문 + 런 장부를 통과한다(dry-run 플래그 없음 —
 * 드라이런 세션이 아니라 실제 콘솔 호출이다). LLM 미구성·검증 실패 시
 * 가짜 제안을 만들지 않고 available=false + 사유를 반환한다.
 */
export async function suggestDryRunImprovement(
  promptKey: string,
  evidence?: { recentFailures?: number; note?: string | null },
): Promise<SuggestDryRunResult> {
  const check = dryRunnablePromptCheck(promptKey);
  if (!check.ok) return check;
  const entry = check.entry;
  const db = getDb();
  const failureRows = db
    .query(
      `SELECT created_at, error FROM llm_call_log
       WHERE agent_key = ? AND purpose = ? AND ok = 0 AND source = 'llm'
       ORDER BY created_at DESC, id DESC LIMIT ${SUGGEST_MAX_FAILURES}`,
    )
    .all(entry.agentKey, entry.purpose) as Array<{ created_at: string; error: string | null }>;
  const failures = failureRows.map((r) => ({ createdAt: r.created_at, error: (r.error ?? "").slice(0, 300) }));

  const unavailable = (reason: string): SuggestDryRunResult => ({
    ok: true,
    suggestion: {
      proposalOnly: true,
      available: false,
      reason,
      promptKey,
      proposal: null,
      evidence: { recentFailures: failures.length, failures, note: evidence?.note ?? null },
    },
  });

  // 제안 생성 자체는 zod로 검증 — 형태가 틀린 제안은 제안이 아니다.
  const Schema = z.object({
    type: z.enum(["prompt_improvement", "agent_reassignment"]),
    improvedSystem: z.string().optional(),
    rationale: z.string().min(1),
    candidateAgents: z.array(z.object({ key: z.string(), rationale: z.string() })).max(3).optional(),
  });
  const suggestSystem = PROMPTS["pm.flow_suggest"].system;
  const payload = {
    promptKey,
    purpose: entry.purpose,
    currentSystem: PROMPTS[promptKey as PromptKey].system,
    recentFailures: failures,
    note: evidence?.note ?? null,
  };
  const r = await completeStructured({
    messages: [
      { role: "system", content: suggestSystem },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
    schema: Schema,
    schemaName: "flow_suggest",
    agent: { key: PM_CATALOG["pm.flow_suggest"].agentKey as string, purpose: PM_CATALOG["pm.flow_suggest"].purpose },
    maxTokens: DRY_RUN_MAX_TOKENS,
    temperature: 0,
  });
  if (r.source !== "llm") {
    return unavailable(`제안 생성 불가 — LLM 미구성 또는 응답 검증 실패(${(r as { reason?: string }).reason ?? "unknown"}). 결정론 폴백으로 가짜 제안을 만들지 않습니다.`);
  }
  // 재배정 후보는 로스터에 존재하는 키만 남긴다(관문과 동일 어휘).
  const candidates = (r.value.candidateAgents ?? []).filter((c) => AGENT_KEYS.has(c.key));
  const proposal = {
    type: r.value.type,
    improvedSystem: r.value.type === "prompt_improvement" ? (r.value.improvedSystem ?? null) : null,
    candidateAgents: r.value.type === "agent_reassignment" ? candidates : [],
    rationale: r.value.rationale,
  };
  return {
    ok: true,
    suggestion: {
      proposalOnly: true,
      available: true,
      reason: null,
      promptKey,
      proposal,
      evidence: { recentFailures: failures.length, failures, note: evidence?.note ?? null },
    },
  };
}
