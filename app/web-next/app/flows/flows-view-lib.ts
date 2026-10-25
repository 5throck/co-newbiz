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
  /** 스펙 한국어 단계명 — design 2026-10-25 §6.1부터 /api/flows의 SPEC_STAGES 직접 투영.
   *  표시 라벨은 이 데이터를 쓴다(과거 클라이언트 단계명 사본은 소멸 — 구현 편차 #1 해소). */
  name: string;
  applicableTracks: string[];
  activities: BlueprintActivity[];
}
/** 전문가 마커(§11.4) — SPECIALIST_TRACK_AFFINITY(DEC-20261025-02)의 API 사상.
 *  표시·인지 전용이다: 필터·게이트·디스패치에 영향이 없다. */
export interface SpecialistMarker {
  stageId: string;
  activityId: string;
  kind: "affinity" | "scoped" | "override";
  note: string;
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
  /** 전문가 마커(§11.4) — SVG 흐름 그래프와 활동 표가 소비한다(표시 전용). */
  specialistMarkers: SpecialistMarker[];
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
  /** 단계 id → 최근 오류 카운트(API 집계값 — 2026-10-23 단계 요약 그리드 제거로
   *  UI 소비처는 없으며, Row 3 API 계약 유지를 위해 타이핑만 남는다). */
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

// ── 단계명 ───────────────────────────────────────────────────────────────
// process/flow.spec.yaml의 stages[].name은 /api/flows가 SPEC_STAGES 직접 투영으로
// 서빙한다(design 2026-10-25-agent-assignment-prompt-standard §6.1). 과거의 클라이언트
// 단계명 사본(구현 편차 #1)은 소멸했다 — 단계명 변경 PR이 이 파일을 고칠 이유가 없다.
// 남는 것은 이름 결측 시의 방어적 id 폴백뿐이다(로직 분기 금지는 유지).
export function stageDisplayName(stage: Pick<BlueprintStage, "id" | "name">): string {
  return stage.name && stage.name.length > 0 ? stage.name : stage.id;
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

/** 요약 카드 "기준 창" 표기 — API window 토큰("24h"/"7d"/"30d")을 ledger 카탈로그
 *  키로 방출한다(2026-10-23 사용자 보고: 원문 토큰 "7d"가 그대로 노출되었다).
 *  화면에서 t(key)로 풀어 쓰며, 미지 토큰은 null — 호출부가 원문 폴백을 담당한다. */
export function windowTokenKey(window: string | null | undefined): "window24h" | "window7d" | "window30d" | null {
  if (window === "24h") return "window24h";
  if (window === "7d") return "window7d";
  if (window === "30d") return "window30d";
  return null;
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

/** 런 레저 차트 주축(호출 수) 상한 — 스택 최댓값에서 결정적으로 유도한다(2026-10-25
 *  사용자 보고: 막대가 축 전체 높이를 덮어 규모를 왜곡해 보였다). ECharts 자동
 *  스케일은 최대 버킷이 보기 좋은 눈금(예: 25)과 정확히 일치하면 상한을 그 값에
 *  맞춰버려 여유가 0 — 최고 막대가 그리드 꼭대기까지 100% 채워진다. 화면이
 *  1/2/5×10^k 사다리 간격의 정수 배수 상한(약 15%·최소 1 단위 여유)을 직접 계산해
 *  max로 고정한다. 0 이하·비정상 입력은 빈/전-0 상태 — 축이 쓰러지지 않게 최소
 *  정수 눈금 1을 반환한다(minInterval 1과 짝). 순수 함수라 단위 테스트가 2–2000
 *  범위의 불변식(정수·데이터 엄격 초과·여유 ≤1.5배)까지 직접 검증한다. */
export function countAxisMax(maxStacked: number): number {
  const m = Number.isFinite(maxStacked) ? Math.ceil(Math.max(0, maxStacked)) : 0;
  if (m === 0) return 1;
  // 목표 틱 간격(≈ m/5) 이상의 최소 사다리 값 — 정수 하한 1(호출 수는 셈).
  const pow = 10 ** Math.floor(Math.log10(m / 5));
  const ladder = [1, 2, 5, 10].map((k) => k * pow);
  let step = Math.max(1, ladder.find((s) => s >= m / 5) ?? ladder[3]!);
  let n = Math.ceil((m * 1.15) / step) * step;
  if (n > m * 1.5) {
    // 사다리 갭(예: 5→10배)에서 올림 폭이 커져 여유가 과해지면 한 단계 가는
    // 간격으로 다시 올린다 — 상한은 데이터의 1.5배를 넘지 않는다(축 낭비 방지).
    step = Math.max(1, ladder.filter((s) => s < step).pop() ?? 1);
    n = Math.ceil((m * 1.15) / step) * step;
  }
  return n;
}

// ── SVG 텍스트 근사 계측 (flow-graph — 2026-10-23 사용자 보고: 카드 폭 초과 텍스트가
// 인접 카드와 겹쳤다) ────────────────────────────────────────────────────────
// SVG <text>는 CSS처럼 자동 축약(ellipsis)이 없어 화면이 직접 너비를 재고 잘라야
// 한다. 실제 글리프 계측(캔버스 measureText)은 클라이언트 렌더 시점에만 가능해
// 렌더러 내부에서도 결정적으로 쓸 수 있는 근사식을 둔다: 한글 음절·CJK·전각
// 구간은 fontSize(전각 폭), 라틴·숫자 등 반각은 0.55×fontSize로 잰다(플랫폼별
// 글꼴 편차를 흡수할 상한 여백은 호출부 계산에 둔다). 순수 함수라 단위 테스트가
// 직접 검증한다(flows-console-view.test.ts).

/** 전각(한글 음절·호환 자모·CJK·전각 기호/문장부호··) 글리프 판정. */
function isWideGlyph(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
    (code >= 0xac00 && code <= 0xd7a3) || // 한글 음절
    (code >= 0x3000 && code <= 0x9fff) || // CJK 기호·한자·가나
    (code >= 0xff00 && code <= 0xff60) // 전각 형식
  );
}

/** 텍스트 근사 폭(px) — 전각 글리프는 fontSize, 반각은 0.55×fontSize. */
export function approxTextWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) {
    w += isWideGlyph(ch.codePointAt(0) ?? 0) ? fontSize : fontSize * 0.55;
  }
  return w;
}

/** maxWidth 내로 축약(초과 시 …). 원문은 SVG <title> 폴백이 담당하므로 여기선
 *  표시 문자열만 반환한다. */
export function truncateToWidth(s: string, fontSize: number, maxWidth: number): string {
  if (approxTextWidth(s, fontSize) <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && approxTextWidth(`${out}…`, fontSize) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

// ── 상태 칩 (A5: 색 단독 금지 — 아이콘+텍스트 병기) ───────────────────────
// i18n (design 2026-10-23-i18n-ui-adoption): 칩 문구는 catalog 키로 방출하고
// 화면에서 tr(key)로 풀어 쓴다. 미지 값은 key=null + label=원문 폴백.
export interface ChipView { key: string | null; label: string; cls: string }

export const RUN_STATUS_OK = new Set(["succeeded", "completed", "complete", "ok", "running", "in_progress", "pending"]);

export function runStatusChip(status: string): ChipView {
  if (status === "failed") return { key: "pages.flows.chips.runFailed", label: "", cls: "status-chip status-rejected" };
  if (RUN_STATUS_OK.has(status)) return { key: "pages.flows.chips.runSuccess", label: "", cls: "status-chip status-approved" };
  return { key: null, label: status, cls: "status-chip status-not-started" };
}

/** 근거 칩(classifiedBy 유도) — Row 3가 catalogMatched 불리언 + source만 노출하므로
 *  3값(카탈로그/규칙/AI 폴백) 구분은 불가능하다(구현 편차 #4): synthesis=결정론,
 *  llm+matched=카탈로그, llm+unmatched=카탈로그 외. */
export function classifiedByChip(row: Pick<LlmCallRow, "source" | "catalogMatched">): { key: string; cls: string } {
  if (row.source === "synthesis") return { key: "pages.flows.chips.deterministic", cls: "status-chip status-not-started" };
  if (row.catalogMatched) return { key: "pages.flows.chips.catalog", cls: "status-chip status-not-started" };
  return { key: "pages.flows.chips.offCatalog", cls: "status-chip status-in-progress" };
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

/** 실행 전 확인 대화상자 공개 문구 — execute 응답 meta.note와 동일 문장(§6.2).
 *  i18n: ko 원문은 locales/ko.json pages.flows.dryRunSession.disclosure 마스터 값. */
export const DRY_RUN_DISCLOSURE_KEY = "pages.flows.dryRunSession.disclosure";

/** 세션 상태 칩 — active는 아직 실행 전이라 "편집 중"(§6.1 상태 칩 어휘). */
export function sessionStatusChip(status: string): ChipView {
  if (status === "active") return { key: "pages.flows.chips.sessionEditing", label: "", cls: "status-chip status-in-progress" };
  if (status === "closed") return { key: "pages.flows.chips.sessionDone", label: "", cls: "status-chip status-approved" };
  return { key: null, label: status, cls: "status-chip status-not-started" };
}

/** A/B 등급 필(벤치 A3-2 채택 — 색+텍스트 병기, A5). 선호 방향에서 유도한다:
 *  override 선호 = 개선, base 선호 = 악화, tie = 동률, 미기록 = 미판정. */
export function gradeFromPreference(p: DryRunPreference | null | undefined): { key: string; cls: string } {
  if (p === "override") return { key: "pages.flows.chips.gradeImproved", cls: "status-chip status-approved" };
  if (p === "base") return { key: "pages.flows.chips.gradeRegressed", cls: "status-chip status-rejected" };
  if (p === "tie") return { key: "pages.flows.chips.gradeTie", cls: "status-chip status-not-started" };
  return { key: "pages.flows.chips.gradeUnjudged", cls: "status-chip status-not-started" };
}

/** 세션 목록용 선호 라벨(등급 필과 별개의 데이터 표기) — catalog 키 방출,
 *  미기록은 null(화면에서 "—" 폴백). */
export function preferenceLabelKey(p: DryRunPreference | null | undefined): string | null {
  if (p === "override") return "pages.flows.chips.prefOverride";
  if (p === "base") return "pages.flows.chips.prefBase";
  if (p === "tie") return "pages.flows.chips.prefTie";
  return null;
}

/** 다리 출처 칩 — A/B 비교 열의 AI/결정론 구분(아이콘+텍스트, A5). */
export function sourceChip(source: string | null | undefined): { key: string; cls: string } {
  if (source === "llm") return { key: "pages.flows.chips.sourceAi", cls: "status-chip status-in-progress" };
  return { key: "pages.flows.chips.deterministic", cls: "status-chip status-not-started" };
}

/** TTL 만료 임박 칩(화면 설계 §13-3 권장 반영) — 만료 72시간 이내에만 노출.
 *  nowMs를 주입받아 단위 테스트 가능. 칩 문구와 title 문구 모두 catalog 키 방출. */
export function expiryChip(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): { key: string; cls: string; titleKey: string; titleParams: Record<string, string> } | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  const hours = (t - nowMs) / 3600_000;
  if (hours > 72) return null;
  if (hours <= 0) {
    return { key: "pages.flows.chips.expired", cls: "status-chip status-rejected", titleKey: "pages.flows.chips.expiredTitle", titleParams: { p1: fmtDateTime(expiresAt) } };
  }
  return { key: "pages.flows.chips.expiringSoon", cls: "status-chip status-amber", titleKey: "pages.flows.chips.expiringSoonTitle", titleParams: { p1: fmtDateTime(expiresAt) } };
}

/** 실행 전 비용 확인용 추정(화면 설계 §6.2). Row 5 API는 실행 시점 재조회용
 *  estimate 엔드포인트가 없어(구현 편차 #A) 세션 누계 장부에서 유도한다:
 *  llm 호출 실측이 있으면 measured(회당 평균), 없으면 unknown(토큰 상한 안내).
 *  i18n: 안내 문구는 catalog 키 + params 방출 — 화면에서 tr(noteKey, noteParams). */
export interface SessionCostEstimate {
  basis: "measured" | "unknown";
  costUsd: number | null;
  noteKey: string;
  noteParams: Record<string, string>;
}

export function estimateFromLedger(ledger: DryRunLedger): SessionCostEstimate {
  if (ledger.llmCalls > 0 && ledger.costUsd !== null) {
    const perCall = ledger.costUsd / Math.max(ledger.llmCalls, 1);
    return {
      basis: "measured",
      costUsd: perCall,
      noteKey: "pages.flows.chips.costMeasuredNote",
      noteParams: { p1: fmtUsd(ledger.costUsd), p2: fmtInt(ledger.llmCalls), p3: fmtUsd(perCall) },
    };
  }
  return {
    basis: "unknown",
    costUsd: null,
    noteKey: "pages.flows.chips.costUnknownNote",
    noteParams: { p1: fmtInt(DRY_RUN_MAX_TOKENS_UI) },
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
