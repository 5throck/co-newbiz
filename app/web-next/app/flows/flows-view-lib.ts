// 플로우 콘솔 화면 공용 — 타입·포맷터·상수 (화면 설계 2026-10-24 §3, §4, §5).
// Row 3 API 계약(app/api/flows, app/api/flows/runs)의 응답 형태를 그대로 타이핑한다.
// 로직 없음 — 훅도 JSX도 없는 순수 모듈이라 단위 테스트에서 직접 import 된다.

// ── GET /api/flows 블루프린트 ────────────────────────────────────────────
export interface BlueprintPrompt {
  key: string;
  /** null = 동적 항목 — 호출 시점 에이전트 선언으로 귀속(§6.2). */
  agentKey: string | null;
  purpose: string | null;
  trackScope: string[];
}
export interface BlueprintActivity {
  id: string;
  agent: string;
  skills: string[];
  procedure: string[];
  prompts: BlueprintPrompt[];
}
export interface BlueprintStage {
  id: string;
  applicableTracks: string[];
  activities: BlueprintActivity[];
}
export interface BlueprintPromptFull {
  key: string;
  agentKey: string | null;
  activityId: string | null;
  stageId: string | null;
  purpose: string | null;
  trackScope: string[];
  system: string | null;
}
export interface BlueprintAgent {
  key: string;
  name: string;
  role: string | null;
  domain: string | null;
}
export interface FlowsBlueprint {
  llmConfigured: boolean;
  specVersion: string;
  catalogVersion: string;
  sources: Record<string, string>;
  stages: BlueprintStage[];
  prompts: BlueprintPromptFull[];
  agents: BlueprintAgent[];
}

// ── GET /api/flows/runs 런 장부 ──────────────────────────────────────────
export interface AgentRunRow {
  id: string;
  process_run_id: string;
  activity_id: string;
  agent_key: string;
  status: string;
  source: string | null;
  started_at: string | null;
  finished_at: string | null;
}
export interface ActivityRunRow extends Omit<AgentRunRow, "agent_key"> {
  agent_key?: never;
  agentRuns: AgentRunRow[];
}
export interface ProcessRunRow {
  id: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  spec_version: string;
  stage: string;
  status: string;
  source: string | null;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  activities: ActivityRunRow[];
}
export interface LlmCallRow {
  id: string;
  agent_key: string | null;
  purpose: string | null;
  context_type: string | null;
  context_id: string | null;
  source: string | null; // "llm" | "synthesis"
  provider: string | null;
  model: string | null;
  ok: number; // SQLite 0/1
  error: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  usage_estimated: number | null;
  function_name: string | null;
  prompt_hash: string | null;
  created_at: string;
  /** Row 3 유도값 — purpose가 카탈로그 목적 문자열과 정확히 일치. */
  catalogMatched: boolean;
  /** Row 5 — includeDryRun=1 로 조회할 때만 채워지는 드라이런 플래그(0171).
   *  dry_run_group_id = 드라이런 세션 id(세션 상세 딥링크 키). */
  is_dry_run?: number;
  dry_run_group_id?: string | null;
}
export interface RunsSummary {
  window: string;
  calls: number;
  llmCalls: number;
  errors: number;
  errorRate: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  unpricedCalls: number;
  estimatedCalls: number;
  /** 단계 id → 최근 오류 카운트(블루프린트 단계 요약 카드 소비). */
  errorsByStage: Record<string, number>;
  unmappedErrors: number;
}
export interface RunsPayload {
  llmConfigured: boolean;
  processRuns: ProcessRunRow[];
  llmCalls: LlmCallRow[];
  summary: RunsSummary;
}
export interface RunsMeta {
  limit?: number;
  includeDryRun?: boolean;
  includeDryRunNote?: string;
  counts?: { processRuns: number; llmCalls: number };
  nextBefore?: { processRuns: string | null; llmCalls: string | null };
}

// ── 단계 한글명 ──────────────────────────────────────────────────────────
// process/flow.spec.yaml의 stages[].name 사본이다. /api/flows가 단계 id만
// 돌려주므로(§6.2 프러젝션에 name 미포함) 화면 라벨로만 쓴다 — 로직 분기에
// 사용 금지. 드리프트는 pm-catalog/spec-activities 생성 검사 체인에서
// 감지되지 않으므로, 단계명 변경 PR은 이 상수를 함께 고친다(구현 편차 #1).
export const STAGE_NAMES: Record<string, string> = {
  S1: "시장분석",
  S2: "기회 발굴",
  S3: "시너지·전략적 적합성",
  S4: "진출방식 결정",
  S5: "자체 진출",
  S6: "대상 후보 발굴",
  S7: "대상 선정",
  S8: "사업성 분석",
  S9: "실사·검증",
  S10: "투자구조 설계",
  S11: "투자심사·실행",
  S12: "사후 관리",
};

export function stageName(id: string): string {
  return STAGE_NAMES[id] ?? id;
}

// ── 포맷터 (ADR-0088 숫자 우측·tabular, keep-all 셀 규약) ────────────────
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ko-KR");
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** ISO → "MM-DD HH:mm" (장부 시각은 표기 용도가 전부 — 연도는 창(24h/30d)이 대신한다). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** 토큰 합계 — input+output+cache_read+cache_write (llm-rollup TOKENS_TOTAL 규약). */
export function totalTokens(row: Pick<LlmCallRow, "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens">): number {
  return (row.input_tokens ?? 0) + (row.output_tokens ?? 0) + (row.cache_read_tokens ?? 0) + (row.cache_write_tokens ?? 0);
}

/** EChart 타임라인 버킷 — 불러온 llmCalls 행을 일(day) 단위로 묶는다.
 *  API가 시계열 집계를 돌려주지 않아(Row 3 계약) 화면이 불러온 행(커서 한도)만
 *  반영한다 — 차트 캡션에 한도 사실을 명시한다(구현 편차 #3). */
export interface DayBucket {
  day: string; // MM-DD
  ok: number;
  failed: number;
  costUsd: number;
}

export function bucketLlmCallsByDay(rows: LlmCallRow[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const r of rows) {
    const d = new Date(r.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const b = map.get(key) ?? { day: key, ok: 0, failed: 0, costUsd: 0 };
    if (r.ok === 1) b.ok += 1;
    else b.failed += 1;
    b.costUsd += r.cost_usd ?? 0;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day)).map((b) => ({ ...b, day: b.day.slice(5) }));
}

// ── 상태 칩 (A5: 색 단독 금지 — 아이콘+텍스트 병기) ───────────────────────
export const RUN_STATUS_OK = new Set(["succeeded", "completed", "complete", "ok", "running", "in_progress", "pending"]);

export function runStatusChip(status: string): { label: string; cls: string } {
  if (status === "failed") return { label: "✕ 실패", cls: "status-chip status-rejected" };
  if (RUN_STATUS_OK.has(status)) return { label: "✓ 성공", cls: "status-chip status-approved" };
  return { label: status, cls: "status-chip status-not-started" };
}

/** 근거 칩(classifiedBy 유도) — Row 3가 catalogMatched 불리언 + source만 노출하므로
 *  3값(카탈로그/규칙/AI 폴백) 구분은 불가능하다(구현 편차 #4): synthesis=결정론,
 *  llm+matched=카탈로그, llm+unmatched=카탈로그 외. */
export function classifiedByChip(row: Pick<LlmCallRow, "source" | "catalogMatched">): { label: string; cls: string } {
  if (row.source === "synthesis") return { label: "결정론", cls: "status-chip status-not-started" };
  if (row.catalogMatched) return { label: "카탈로그", cls: "status-chip status-not-started" };
  return { label: "카탈로그 외", cls: "status-chip status-in-progress" };
}

// ── 드라이런 세션 (Row 5 API 계약 /api/flows/dry-run — 화면 설계 2026-10-24 §6·§7) ──
// 서버 lib/dry-run.ts의 응답 형태를 클라이언트에서 그대로 타이핑한다. 서버 모듈은
// db/client.ts를 import하므로 클라이언트 번들이 절대 가져오지 않는다 — 사본 상수만 둔다.

export type DryRunPreference = "base" | "override" | "tie";

export interface DryRunLegResult {
  text: string;
  source: string; // "llm" | "synthesis"
  provider: string;
  callId: string | null;
  costUsd: number | null;
}

export interface DryRunLedger {
  runs: number;
  llmCalls: number;
  costUsd: number | null;
  lastRunAt: string | null;
}

/** GET /api/flows/dry-run/sessions(/[id]) 행 — 서버 DryRunSessionDetail 미러. */
export interface DryRunSessionDetail {
  id: string;
  status: string; // "active" | "closed" | "expired"
  prompt_key: string;
  activity_id: string | null;
  base_agent_key: string;
  override_agent_key: string | null;
  override_system: string | null;
  preference: DryRunPreference | null;
  preference_note: string | null;
  base_output: string | null;
  override_output: string | null;
  base_output_source: string | null;
  override_output_source: string | null;
  base_run_call_id: string | null;
  override_run_call_id: string | null;
  cost_usd: number | null;
  created_by: string;
  created_at: string;
  /** TTL 14일(§6.8) — 임박 시 "만료 예정" 칩(expiryChip). */
  expires_at: string;
  finished_at: string | null;
  purpose: string;
  base_system: string;
  ledger: DryRunLedger;
}

/** POST .../execute 응답 — {session, base, override}. */
export interface DryRunExecutePayload {
  session: DryRunSessionDetail;
  base: DryRunLegResult;
  override: DryRunLegResult;
}

/** POST /api/flows/dry-run/suggest 응답 — 제안 전용(경계 #2). */
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

/** lib/dry-run.ts DRY_RUN_MAX_TOKENS 사본 — 클라이언트는 db 모듈을 import할 수
 *  없으므로 비용 확인 문구용 상수만 복사한다(드리프트 시 dry-run.test.ts가 감지). */
export const DRY_RUN_MAX_TOKENS_UI = 1500;

/** 실행 전 확인 대화상자 공개 문구 — execute 응답 meta.note와 동일 문장(§6.2). */
export const DRY_RUN_DISCLOSURE = "드라이런 호출은 런 장부에 is_dry_run 플래그로 기록되며 운영 대시보드 기본 집계에서 제외됩니다.";

/** 세션 상태 칩 — active는 아직 실행 전이라 "편집 중"(§6.1 상태 칩 어휘). */
export function sessionStatusChip(status: string): { label: string; cls: string } {
  if (status === "active") return { label: "편집 중", cls: "status-chip status-in-progress" };
  if (status === "closed") return { label: "완료", cls: "status-chip status-approved" };
  return { label: status, cls: "status-chip status-not-started" };
}

/** A/B 등급 필(벤치 A3-2 채택 — 색+텍스트 병기, A5). 선호 방향에서 유도한다:
 *  override 선호 = 개선, base 선호 = 악화, tie = 동률, 미기록 = 미판정. */
export function gradeFromPreference(p: DryRunPreference | null | undefined): { label: string; cls: string } {
  if (p === "override") return { label: "개선", cls: "status-chip status-approved" };
  if (p === "base") return { label: "악화", cls: "status-chip status-rejected" };
  if (p === "tie") return { label: "동률", cls: "status-chip status-not-started" };
  return { label: "미판정", cls: "status-chip status-not-started" };
}

/** 세션 목록용 선호 라벨(등급 필과 별개의 데이터 표기). */
export function preferenceLabel(p: DryRunPreference | null | undefined): string {
  if (p === "override") return "override 선호";
  if (p === "base") return "base 선호";
  if (p === "tie") return "동률";
  return "—";
}

/** 다리 출처 칩 — A/B 비교 열의 AI/결정론 구분(아이콘+텍스트, A5). */
export function sourceChip(source: string | null | undefined): { label: string; cls: string } {
  if (source === "llm") return { label: "AI", cls: "status-chip status-in-progress" };
  return { label: "결정론", cls: "status-chip status-not-started" };
}

/** TTL 만료 임박 칩(화면 설계 §13-3 권장 반영) — 만료 72시간 이내에만 노출.
 *  nowMs를 주입받아 단위 테스트 가능. */
export function expiryChip(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): { label: string; cls: string; title: string } | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  const hours = (t - nowMs) / 3600_000;
  if (hours > 72) return null;
  if (hours <= 0) {
    return { label: "만료됨", cls: "status-chip status-rejected", title: `세션 TTL이 만료되었습니다(${fmtDateTime(expiresAt)}) — 읽기·실행 경로에서 소거됩니다(§6.8).` };
  }
  return { label: "만료 예정", cls: "status-chip status-amber", title: `TTL 만료 임박(${fmtDateTime(expiresAt)}) — 만료 세션은 읽기·실행 경로에서 소거됩니다(§6.8).` };
}

/** 실행 전 비용 확인용 추정(화면 설계 §6.2). Row 5 API는 실행 시점 재조회용
 *  estimate 엔드포인트가 없어(구현 편차 #A) 세션 누계 장부에서 유도한다:
 *  llm 호출 실측이 있으면 measured(회당 평균), 없으면 unknown(토큰 상한 안내). */
export interface SessionCostEstimate {
  basis: "measured" | "unknown";
  costUsd: number | null;
  note: string;
}

export function estimateFromLedger(ledger: DryRunLedger): SessionCostEstimate {
  if (ledger.llmCalls > 0 && ledger.costUsd !== null) {
    const perCall = ledger.costUsd / Math.max(ledger.llmCalls, 1);
    return {
      basis: "measured",
      costUsd: perCall,
      note: `직전 실행 실측 기준 — 누계 ${fmtUsd(ledger.costUsd)} / ${fmtInt(ledger.llmCalls)}회 llm 호출(회당 ${fmtUsd(perCall)}). 실제 비용은 모델·입력 길이에 따라 달라질 수 있습니다.`,
    };
  }
  return {
    basis: "unknown",
    costUsd: null,
    note: `측정된 비용 기록이 없습니다(첫 실행) — 토큰 상한 ${fmtInt(DRY_RUN_MAX_TOKENS_UI)} 기준 보수적 추정만 가능합니다. 실행 전 확인하세요.`,
  };
}

/** A/B 비교의 줄 단위 규모 요약(multiset 라인 비교 — lib/dry-run.ts diffSummary와
 *  동일 휴리스틱의 클라이언트 사본; 본문 diff는 두 <pre> 원문 나란히로 대신한다). */
export function lineDiffSummary(base: string, override: string): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const l of base.split("\n")) counts.set(l, (counts.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of override.split("\n")) {
    const remaining = counts.get(l) ?? 0;
    if (remaining > 0) counts.set(l, remaining - 1);
    else added += 1;
  }
  let removed = 0;
  for (const c of counts.values()) removed += c;
  return { added, removed };
}

/** 런 레저 행이 드라이런인지(includeDryRun=1 조회 시 채워짐) + 세션 딥링크. */
export function dryRunGroupOf(row: Pick<LlmCallRow, "is_dry_run" | "dry_run_group_id">): string | null {
  return row.is_dry_run === 1 && row.dry_run_group_id ? row.dry_run_group_id : null;
}
