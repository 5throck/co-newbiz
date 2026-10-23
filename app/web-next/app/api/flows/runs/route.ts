// 2026-09-15-runtime-pm-agent-orchestration-design §6.5 (D4 플로우 콘솔) —
// GET /api/flows/runs: 전역 런 장부. 한 응답에 3개 섹션 —
//   processRuns : process_run → activity_run → agent_run 3단 확장(화면 설계 §5.3),
//   llmCalls    : llm_call_log 평면 행(0092 + 0130 사용량 열),
//   summary     : 필터 집합 + 기간 창에 대한 집계 카드(lib/llm-rollup.ts 재사용).
// 커서 페이지네이션은 admin audit-log의 limit+before 패턴
// (app/api/admin/audit-log/route.ts:12-24)을 따른다. 읽기 전용 — appendAudit
// 은 쓰기 경로 전용이다(기존 GET 라우트 선례).
//
// 가시성(ADR-0091/0146 계열): 프로젝트 엔터티는 agent-runs 라우트와 동일한
// 접근 모델(멤버십 + wall_group, visibleProject→getProjectIfVisible)을
// SQL 서브쿼리로 인라인한다 — op-portunity는 proposals.ts 선례대로 비관리자
// 비즈니스 액터에게 전체 공개. 관리자는 라우트 게이트에서 이미 차단.
// dry-run 필터(§6.6): includeDryRun=1 이 없으면 llm_call_log.is_dry_run=1 행을
// 목록(llmCalls)과 요약(summary) 양쪽에서 제외한다 — 0171 마이그레이션으로 활성.
import { getDb } from "../../../../../../db/client.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";
import { isLlmConfigured } from "../../../../lib/llm.ts";
import { llmUsageAggregate } from "../../../../lib/llm-rollup.ts";
import { route } from "../../../../lib/route.ts";
import { PM_CATALOG } from "../../../../lib/pm-catalog.generated.ts";

// visibleProject의 접근 모델(agent-runs 라우트와 동일: 멤버십 + wall_group,
// includeClosed/includeDeleted 허용, MNPI 제외 없음)을 집합 서브쿼리로.
const VISIBLE_PROJECT_SUBQUERY = `SELECT p.id FROM md_project p
   JOIN project_member m ON m.project_id = p.id
   LEFT JOIN project_classification c ON c.project_id = p.id
   LEFT JOIN app_user u ON u.user_id = m.user_id
   WHERE m.user_id = ? AND m.revoked_at IS NULL
     AND (c.wall_group IS NULL OR u.wall_group IS NULL OR c.wall_group != u.wall_group)`;

function parseFilters(url: URL, callerId: string) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
  const before = url.searchParams.get("before")?.trim() || null;
  const agentKey = url.searchParams.get("agentKey")?.trim() || null;
  const entityType = url.searchParams.get("entityType")?.trim() || null;
  const entityId = url.searchParams.get("entityId")?.trim() || null;
  const okParam = url.searchParams.get("ok")?.trim() || null;
  const source = url.searchParams.get("source")?.trim() || null;
  const includeDryRun = url.searchParams.get("includeDryRun")?.trim() === "1";
  // 요약 카드 기간 창(화면 설계 §5.1) — 목록 커서와 독립.
  const windowParam = url.searchParams.get("window")?.trim() || "7d";

  if (okParam !== null && okParam !== "0" && okParam !== "1") return { error: "ok 는 0 또는 1 이어야 합니다." } as const;
  if (source !== null && source !== "llm" && source !== "synthesis") return { error: "source 는 llm 또는 synthesis 이어야 합니다." } as const;
  if ((entityType === null) !== (entityId === null)) return { error: "entityType 과 entityId 는 함께 지정해야 합니다." } as const;
  if (entityType !== null && entityType !== "opportunity" && entityType !== "project") {
    return { error: "entityType 은 opportunity 또는 project 이어야 합니다." } as const;
  }
  const windowMs = windowParam === "24h" ? 24 * 3600_000 : windowParam === "30d" ? 30 * 86400_000 : windowParam === "7d" ? 7 * 86400_000 : null;
  if (windowMs === null) return { error: "window 는 24h, 7d, 30d 중 하나여야 합니다." } as const;
  const windowStart = new Date(Date.now() - windowMs).toISOString();

  // 프로세스 런 가시성: opportunity는 전체 공개, project는 멤버십 서브쿼리.
  const runVisibility = `(r.entity_type = 'opportunity' OR r.entity_id IN (${VISIBLE_PROJECT_SUBQUERY}))`;
  // llm_call_log 가시성: 프로젝트 컨텍스트(project_id 또는 context_type='project')만
  // 멤버십 검사, opportunity·무컨텍스트(시스템 단발) 행은 공개.
  const llmVisibility = `(l.project_id IS NULL OR l.project_id IN (${VISIBLE_PROJECT_SUBQUERY}))
     AND (l.context_type IS NULL OR l.context_type != 'project' OR l.context_id IN (${VISIBLE_PROJECT_SUBQUERY}))`;

  const runConds = [runVisibility];
  const runParams: SQLQueryBindings[] = [callerId]; // 서브쿼리 내 m.user_id 1곳
  const llmConds = [llmVisibility];
  const llmParams: SQLQueryBindings[] = [callerId, callerId]; // project_id·context_id 서브쿼리 각 1곳

  if (before) {
    runConds.push("r.started_at < ?");
    runParams.push(before);
    llmConds.push("l.created_at < ?");
    llmParams.push(before);
  }
  if (agentKey) {
    runConds.push("EXISTS (SELECT 1 FROM agent_run ar WHERE ar.process_run_id = r.id AND ar.agent_key = ?)");
    runParams.push(agentKey);
    llmConds.push("l.agent_key = ?");
    llmParams.push(agentKey);
  }
  if (entityType && entityId) {
    runConds.push("r.entity_type = ? AND r.entity_id = ?");
    runParams.push(entityType, entityId);
    // llm_call_log는 0130 project_id 호환 열이 있어 프로젝트 컨텍스트는 어느 쪽이든 매칭.
    if (entityType === "project") {
      llmConds.push(`((l.context_type = ? AND l.context_id = ?) OR (l.context_type IS NULL AND l.project_id = ?))`);
      llmParams.push(entityType, entityId, entityId);
    } else {
      llmConds.push("(l.context_type = ? AND l.context_id = ?)");
      llmParams.push(entityType, entityId);
    }
  }
  if (okParam !== null) {
    // 런 상태로의 사상: ok=1 → failed가 아닌 런, ok=0 → failed 런.
    runConds.push(okParam === "1" ? "r.status != 'failed'" : "r.status = 'failed'");
    llmConds.push("l.ok = ?");
    llmParams.push(Number(okParam));
  }
  // source 필터는 llm_call_log 전용이다 — agent_run.source(web|agent|human…,
  // 0045)는 llm|synthesis와 다른 판별자라 런 섹션에는 적용하지 않는다.
  if (source) {
    llmConds.push("l.source = ?");
    llmParams.push(source);
  }
  // §6.6 "운영 대시보드는 기본적으로 제외" — includeDryRun=1 일 때만
  // is_dry_run=1 행(0171, dry_run_group_id = 드라이런 세션 id)이 목록·요약에
  // 들어간다. summary는 llmWhere를 재사용하므로 같은 필터가 적용된다.
  if (!includeDryRun) {
    llmConds.push("l.is_dry_run = 0");
  }

  return {
    limit,
    before,
    includeDryRun,
    windowParam,
    windowStart,
    runWhere: runConds.join(" AND "),
    runParams,
    llmWhere: llmConds.join(" AND ").replace(/\s+/g, " "),
    llmParams,
  } as const;
}

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "read");
  if (guard) return guard;

  const parsed = parseFilters(new URL(request.url), auth.auth.userId);
  if ("error" in parsed && parsed.error) return badRequest("invalid_filter", parsed.error);
  const { limit, before, includeDryRun, windowStart, runWhere, runParams, llmWhere, llmParams } = parsed;
  const db = getDb();

  // ── processRuns: 런 → 활동 → 에이전트 3단 확장 ──────────────────────────
  const runs = db
    .query(
      `SELECT r.id, r.entity_type, r.entity_id, r.spec_version, r.stage, r.status, r.source, r.started_by, r.started_at, r.finished_at
       FROM process_run r WHERE ${runWhere} ORDER BY r.started_at DESC LIMIT ?`,
    )
    .all(...runParams, limit) as Array<Record<string, unknown>>;
  const runIds = runs.map((r) => r.id as string);
  const inRunIds = () => runIds.map(() => "?").join(",");
  const activities = runIds.length
    ? (db
        .query(
          `SELECT id, process_run_id, activity_id, status, source, started_at, finished_at
           FROM activity_run WHERE process_run_id IN (${inRunIds()}) ORDER BY started_at, id`,
        )
        .all(...runIds) as Array<Record<string, unknown>>)
    : [];
  const agentRuns = runIds.length
    ? (db
        .query(
          `SELECT id, process_run_id, activity_id, agent_key, status, source, started_at, finished_at
           FROM agent_run WHERE process_run_id IN (${inRunIds()}) ORDER BY started_at, id`,
        )
        .all(...runIds) as Array<Record<string, unknown>>)
    : [];
  // output_md/summary_md 본문은 실어 보내지 않는다 — 관찰 가능성 화면에는
  // 메타(상태·시각·에이전트)로 충분하고, 본문 열람은 per-deal 표면에 남는다.
  const activitiesByRun = new Map<string, Array<Record<string, unknown>>>();
  const agentsByRunActivity = new Map<string, Array<Record<string, unknown>>>();
  for (const a of activities) {
    const runId = a.process_run_id as string;
    const list = activitiesByRun.get(runId) ?? [];
    list.push(a);
    activitiesByRun.set(runId, list);
  }
  for (const ar of agentRuns) {
    const key = `${ar.process_run_id}:${ar.activity_id}`;
    const list = agentsByRunActivity.get(key) ?? [];
    list.push(ar);
    agentsByRunActivity.set(key, list);
  }
  const processRuns = runs.map((r) => {
    const runActivities = (activitiesByRun.get(r.id as string) ?? []).map((a) => ({
      ...a,
      agentRuns: agentsByRunActivity.get(`${r.id}:${a.activity_id}`) ?? [],
    }));
    return { ...r, activities: runActivities };
  });

  // ── llmCalls: llm_call_log 평면 행 ──────────────────────────────────────
  // 근거 칩(classifiedBy)은 런타임 분류 결과가 장부에 저장되지 않으므로
  //(pm-router는 분류 시점에만 보유) purpose가 카탈로그 목적 문자열과 일치하는지로
  // 유도한다 — 정확히 카탈로그 귀속임이 검증된 행만 catalogMatched=true.
  const catalogPurposes = new Set(Object.values(PM_CATALOG).map((e) => e.purpose));
  const llmRows = db
    .query(
      `SELECT l.id, l.agent_key, l.purpose, l.context_type, l.context_id, l.source, l.provider, l.model,
              l.ok, l.error, l.latency_ms, l.input_tokens, l.output_tokens, l.cache_read_tokens, l.cache_write_tokens,
              l.cost_usd, l.usage_estimated, l.function_name, l.prompt_hash, l.created_at,
              l.is_dry_run, l.dry_run_group_id
       FROM llm_call_log l WHERE ${llmWhere} ORDER BY l.created_at DESC LIMIT ?`,
    )
    .all(...llmParams, limit) as Array<Record<string, unknown>>;
  const llmCalls = llmRows.map((row) => ({
    ...row,
    ok: Number(row.ok),
    is_dry_run: Number(row.is_dry_run),
    catalogMatched: catalogPurposes.has(row.purpose as string),
  }));

  // ── summary: 필터 집합 + 기간 창 집계(카드 4장 + 단계별 오류 카운트) ────────
  // 목록 커서와 독립: 기간 창(window)만 적용한다 — 카드는 "선택 기간 기준"
  // (화면 설계 §5.2)이고 커서는 목록 스크롤 수단이기 때문.
  const summaryWhere = `${llmWhere} AND l.created_at >= ?`;
  const summaryParams = [...llmParams, windowStart];
  const agg = llmUsageAggregate(db, summaryWhere, summaryParams);
  const errorRate = agg.llm_calls > 0 ? agg.errors / agg.llm_calls : null;
  // 단계별 오류 카운트(블루프린트 단계 요약의 "최근 7일 오류") — 목적 문자열을
  // 카탈로그로 단계 귀속. 미매핑 목적은 stageId null로 집계에 남긴다.
  const purposeToStage = new Map<string, string | null>();
  for (const entry of Object.values(PM_CATALOG)) purposeToStage.set(entry.purpose, entry.stageId);
  const errorRows = db
    .query(
      `SELECT l.purpose, COUNT(*) AS errors FROM llm_call_log l
       WHERE ${summaryWhere} AND l.source = 'llm' AND l.ok = 0 GROUP BY l.purpose`,
    )
    .all(...summaryParams) as Array<{ purpose: string; errors: number }>;
  const errorsByStage = new Map<string, number>();
  let unmappedErrors = 0;
  for (const row of errorRows) {
    const stageId = purposeToStage.get(row.purpose) ?? null;
    if (stageId) errorsByStage.set(stageId, (errorsByStage.get(stageId) ?? 0) + row.errors);
    else unmappedErrors += row.errors;
  }

  return ok(
    {
      llmConfigured: isLlmConfigured(),
      processRuns,
      llmCalls,
      summary: {
        window: parsed.windowParam,
        calls: agg.calls,
        llmCalls: agg.llm_calls,
        errors: agg.errors,
        errorRate,
        inputTokens: agg.input_tokens,
        outputTokens: agg.output_tokens,
        cacheReadTokens: agg.cache_read_tokens,
        cacheWriteTokens: agg.cache_write_tokens,
        costUsd: agg.cost_usd,
        unpricedCalls: agg.unpriced_calls,
        estimatedCalls: agg.estimated_calls,
        errorsByStage: Object.fromEntries([...errorsByStage.entries()].sort()),
        unmappedErrors,
      },
    },
    200,
    {
      limit,
      before,
      includeDryRun,
      // §6.6 — 드라이런 행은 기본 제외다. 파라미터가 꺼져 있을 때만 note를
      // 남긴다(켜져 있으면 필터가 실제로 작동하므로 안내가 필요 없다).
      ...(includeDryRun ? {} : { includeDryRunNote: "드라이런 런(is_dry_run=1)은 기본 제외입니다 — includeDryRun=1 로 포함하세요." }),
      counts: { processRuns: processRuns.length, llmCalls: llmCalls.length },
      nextBefore: {
        processRuns: (processRuns.at(-1) as Record<string, unknown> | undefined)?.started_at as string | undefined ?? null,
        llmCalls: (llmCalls.at(-1) as Record<string, unknown> | undefined)?.created_at as string | undefined ?? null,
      },
    },
  );
});
