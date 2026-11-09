// dd-checklist-tailor — S9 industry-tailored DD checklist proposals (ADR-0099
// §2). Per domain the S9 activity owner proposes 5–10 industry-tailored
// ADDITIONAL checklist items through the ADR-0096 runActivityChain engine —
// one process_run (entity = project, stage s9_dd_checklist_tailoring), one
// activity_run/agent_run per domain, so generation is auditable end to end
// exactly like S8 case generation.
//
//   commercial → commercial-dd-agent     technical → technical-dd-agent
//   legal      → legal-counsel
//
// Honesty constraint (ADR-0099 §6, binding): the DETERMINISTIC default
// executor derives items from the project's bound industry profile and MUST
// set source_url = null and source_reliability = 'C' — visibly unsourced,
// visibly lowest-confidence. It never fabricates a plausible-looking URL or
// grade; an unsourced proposal renders as unsourced in the UI and can still
// be approved by a human who judges it worthwhile on its own terms — it can
// never APPEAR sourced. The CO_NEWBIZ_DD_TAILOR_AGENTS=llm seam
// (setDdTailorExecutorFactory) is the documented insertion point for a
// WebSearch-backed implementation that upgrades provenance without changing
// any table, route, or predicate.
//
// Boundary #2 (design, non-negotiable): this engine writes PROPOSALS only —
// every item lands in status 'proposed' with no project_checklist_item_state
// row. Approval (which moves the item into the gate-relevant judgment set) is
// the human review path in reviewDdCustomItem(); the engine can never promote
// its own proposal, and an unapproved proposal cannot block a gate.

import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { runActivityChain, type ActivitySpec, type EntityRef } from "./agent-orchestrator.ts";
import { specAgentFor } from "./spec-activities.ts";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";
import { evaluateValidatorCompleteness } from "../../../db/lib/validator-completeness.ts";
import {
  DD_WORKSPACE_CHECKLISTS,
  SUB_TRACK_DD_CHECKLISTS,
  scopedSubTrackDdChecklists,
  getChecklistItems,
  type ChecklistItemDef,
} from "./library.ts";
import { WAVE_F_PREDICATE_DATE } from "./wave-f-date.ts";
import { KO_DATA } from "./ko-data-values.ts";
import {
  greenfieldSelection,
  hypotheticalWorkspaceScope,
  planReadinessRows,
  previousScopeEntries,
  scopedChecklistItems,
  stepTabMap,
  workspaceOverlay,
  workspaceScopeContext,
  type GreenfieldSelection,
  type PlanReadinessRow,
  type PreviousScopeEntry,
  type StepTag,
  type WorkspaceItemScope,
  type WorkspaceScopeContext,
  type WorkspaceScopeKey,
} from "./greenfield-subtrack.ts";
import {
  BF_WS_POLICY_DOC_ID,
  brownfieldExtraItems,
  brownfieldPreviousScope,
  brownfieldRouteInfo,
  brownfieldScopeContext,
  hypotheticalBrownfieldScope,
  type BrownfieldScopeContext,
  type BrownfieldScopeKey,
} from "./brownfield-subtrack.ts";
import { DdTargetError, selectedTargetId, type DdTargetSummary } from "./dd-target.ts";
import { isWebResearchConfigured, tavilySearch, type WebSource } from "./web-research.ts";

// ADR-0148 — DD workspace is 7 domains (financial/hr/market/financing added
// alongside commercial/technical/legal).
export const DD_DOMAINS = ["commercial", "technical", "legal", "financial", "hr", "market", "financing"] as const;
export type DdDomain = (typeof DD_DOMAINS)[number];

/**
 * Domains with industry-tailoring templates (TEMPLATES below). Custom items may
 * exist on all seven DD_DOMAINS since migration 0137 widened the
 * project_checklist_item_custom.domain CHECK, but automated tailoring stays on
 * these three until templates exist for financial/hr/market/financing; custom
 * items on those four are human-proposed (createDdCustomItem).
 */
export const DD_TAILOR_DOMAINS = ["commercial", "technical", "legal"] as const;
export type DdTailorDomain = (typeof DD_TAILOR_DOMAINS)[number];

/** ADR-0099 §2 — per-domain S9 activity owner, read from process/flow.spec.yaml
 * (SSOT, ADR-0074) via the domain→spec-activity mapping below. The four
 * ADR-0148 domains map to S9 activities being added to the spec; while an id
 * is not yet declared there, the owner falls back to DD_DOMAIN_AGENT_FALLBACK. */
export const DD_DOMAIN_TO_SPEC_ACTIVITY: Record<DdDomain, string> = {
  commercial: "commercial-dd",
  technical: "technical-dd",
  legal: "legal-dd",
  financial: "financial-dd",
  hr: "hr-dd",
  market: "market-dd",
  financing: "financing-dd",
};

/** Owners of the four ADR-0148 domains used when their S9 spec activity is not (yet) declared. */
const DD_DOMAIN_AGENT_FALLBACK: Record<"financial" | "hr" | "market" | "financing", string> = {
  financial: "financial-analyst",
  hr: "hr-integration-agent",
  market: "market-intelligence-agent",
  financing: "financing-agent",
};

export const DD_DOMAIN_AGENTS: Record<DdDomain, string> = Object.fromEntries(
  DD_DOMAINS.map((d) => {
    const fallback = DD_DOMAIN_AGENT_FALLBACK[d as keyof typeof DD_DOMAIN_AGENT_FALLBACK];
    try {
      return [d, specAgentFor("S9", DD_DOMAIN_TO_SPEC_ACTIVITY[d])];
    } catch (err) {
      // A missing spec activity only falls back for the four ADR-0148 domains.
      if (fallback) return [d, fallback];
      throw err;
    }
  }),
) as Record<DdDomain, string>;

export const DD_TAILOR_STAGE = "s9_dd_checklist_tailoring";
/** ADR-0157: tailoring runs for opened comparison targets (kept apart from the selected scope's guard). */
export const DD_TAILOR_TARGET_STAGE = "s9_dd_checklist_tailoring_target";
/** checklist_id prefix under which an APPROVED custom item gets its judgment state row. */
export const CUSTOM_CHECKLIST_PREFIX = "custom:";

export function customChecklistId(domain: DdDomain): string {
  return `${CUSTOM_CHECKLIST_PREFIX}${domain}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Industry resolution (deterministic input to the default executor) ──────

/** The industry label proposals are tailored to — live project_industry binding first, then the promoting opportunity's market scope. */
export function industryLabelForProject(projectId: string): string {
  const db = getDb();
  const bound = db
    .query(
      `SELECT i.name_en, i.name_ko FROM project_industry pi
       JOIN md_industry i ON i.id = pi.industry_id
       WHERE pi.project_id = ? AND pi.superseded_by IS NULL
       ORDER BY pi.bound_at DESC LIMIT 1`,
    )
    .get(projectId) as { name_en: string | null; name_ko: string } | undefined;
  if (bound) return bound.name_en ?? bound.name_ko;
  const scope = db
    .query(
      `SELECT o.market_scope FROM md_project p JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE p.id = ? AND o.market_scope IS NOT NULL LIMIT 1`,
    )
    .get(projectId) as { market_scope: string } | undefined;
  return scope?.market_scope ?? "the target's industry";
}

// ── Deterministic proposal templates (한국어 — 산업명 보간; 2026-10-19 decider:
// 영어 템플릿 제안이 그대로 저장되어 한국어 번역 요구) ──

const TEMPLATES: Record<DdTailorDomain, Array<{ label: string; rationale: string }>> = {
  commercial: [
    {
      label: "상위 3개 고객 매출 집중도를 경영진 설명이 아닌 계약서 기준으로 검증 ({industry})",
      rationale: "산업별 고객 집중도는 일반 항목이 놓치는 사각지대 — 지분을 계약서로 확인해야 합니다.",
    },
    {
      label: "{industry} 가격 결정력과 비용 전가력을 직전 불황기 벤치마크로 검증",
      rationale: "일반적인 가격력 질문은 산업 벤치마크 없이는 답할 수 없습니다.",
    },
    {
      label: "{industry} 유통 구조를 매핑하고 유통사 수익성·리베이트·채널 재고를 확인",
      rationale: "유통 의존 산업은 채널 재고에 수요 과대 계상이 숨습니다. 일반 항목은 이를 강제하지 않습니다.",
    },
    {
      label: "{industry} 수요 순환성을 S8 사업 케이스의 프록시 체인 수요 추정치와 대조 검증",
      rationale: "실사를 S8 수요 앵커에 연결해 시장 가정 오류가 발견사항으로 드러나게 합니다.",
    },
    {
      label: "발표된 {industry} 경쟁사 증설과 대상 지분 점유 위협을 검토",
      rationale: "용량 증설 발표는 재무제표에 반영되기 훨씬 전에 마진 압박을 예고합니다.",
    },
  ],
  technical: [
    {
      label: "{industry} 공정 병목을 경영진 인터뷰가 아닌 현장 관찰로 검증",
      rationale: "일반 항목 tdd-04는 병목 식별만 요구 — 이 산업에서는 식별 방법 자체가 중요합니다.",
    },
    {
      label: "설비 연식과 유지보수 적체를 {industry} 재투자 관행과 대조 평가",
      rationale: "유지보수 지연 리스크의 규모와 리드타임은 산업별로 다릅니다.",
    },
    {
      label: "{industry} 특화 라인 인증·자격 현황과 갱신 상태를 확인",
      rationale: "규제 산업에서 인증 만기는 곧 판매 정지 — certification-agent에 연계하고 중복 생성하지 않습니다.",
    },
    {
      label: "부지 오염 이력과 운영 허가 조건을 포함한 {industry} EHS 부채를 검토",
      rationale: "일반 항목 tdd-06은 포괄적 — 어떤 EHS 노출이 중요한지는 산업이 정의합니다.",
    },
    {
      label: "자본 지출 계획을 {industry} 벤치마크 단위 원가와 설비 리드타임으로 검증",
      rationale: "자본 지출의 현실성은 산업 단위 원가와만 대조 가능합니다.",
    },
  ],
  legal: [
    {
      label: "{industry} 사업 인허가 전수 분류 — 지위 변동 시 자동 승계 / 동의 필요 / 재발급 필요",
      rationale: "산업 인허가 이전 가능성이 가장 흔한 구조적 법률 리스크 — 일반 항목 ldd-15는 포괄적으로만 다룹니다.",
    },
    {
      label: "{industry} 특화 규제 조사와 대상·실소유주의 제재 노출 확인",
      rationale: "규제 산업은 일반 스캔이 놓치는 섹터 특화 조사 리스크를 가집니다.",
    },
    {
      label: "영업비밀 보호 관행을 포함한 {industry} IP 권리관계와 담보 설정을 검토",
      rationale: "보호 가능한 IP의 범위는 산업마다 크게 다릅니다.",
    },
    {
      label: "{industry} 노동 구조 — 노조 단체협약 승계 조항과 핵심 인력 의존도 평가",
      rationale: "노동 이전 법리와 단체협약 노출은 산업 구조의 영향을 받습니다.",
    },
    {
      label: "상위 {industry} 고객·공급사 계약의 지위 변동·양도 금지 조항 스캔",
      rationale: "이 산업에서 실제 중요한 거래처로 계약 검토를 우선순위화합니다.",
    },
  ],
};

function renderTemplates(domain: DdTailorDomain, industry: string) {
  return TEMPLATES[domain].map((t) => ({
    itemLabel: t.label.replace("{industry}", industry),
    rationale: t.rationale.replace("{industry}", industry),
  }));
}

// ── Executor seam (ADR-0098 pattern) ───────────────────────────────────────

export interface TailorItemDraft {
  itemLabel: string;
  rationale: string;
  sourceUrl: string | null;
  sourceReliability: "A" | "B" | "C" | null;
}

/**
 * A domain executor produces the tailored item drafts for one domain. The
 * default (deterministic) implementation is HONEST-BY-DEFAULT: it may set
 * sourceUrl/sourceReliability only to null/'C' — no fabricated URLs or
 * grades. A WebSearch-backed factory returns real sources with real grades.
 */
export type DdTailorExecutor = (
  domain: DdTailorDomain,
  ctx: { projectId: string; industry: string },
) => Promise<TailorItemDraft[]>;

type DdExecutorFactory = () => DdTailorExecutor;

/**
 * The seam store lives on globalThis, not module state — same multi-bundle
 * rationale as committee-agents.ts (bootstrap registration was invisible to
 * route-side consumers).
 */
const EXECUTOR_FACTORY_KEY = "__coNewbizDdTailorExecutorFactory";

function getExecutorFactory(): DdExecutorFactory | null {
  return ((globalThis as Record<string, unknown>)[EXECUTOR_FACTORY_KEY] as DdExecutorFactory | undefined) ?? null;
}

/**
 * The seam: a future WebSearch-backed implementation registers a factory here
 * at server bootstrap. Active only when CO_NEWBIZ_DD_TAILOR_AGENTS=llm — the
 * default and any fallback is the local deterministic executor.
 */
export function setDdTailorExecutorFactory(next: DdExecutorFactory | null): void {
  (globalThis as Record<string, unknown>)[EXECUTOR_FACTORY_KEY] = next;
}

function persistDrafts(
  projectId: string,
  domain: DdTailorDomain,
  agentKey: string,
  drafts: TailorItemDraft[],
  targetId: string | null,
): void {
  const db = getDb();
  const now = nowIso();
  for (const d of drafts) {
    if (!d.itemLabel?.trim()) continue; // never persist an empty proposal
    db.run(
      `INSERT INTO project_checklist_item_custom
         (id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, created_at, target_id)
       VALUES (?,?,?,?,?,?,?,?, 'proposed', ?, ?)`,
      [
        ulid(),
        projectId,
        domain,
        d.itemLabel.trim(),
        d.rationale?.trim() ?? null,
        d.sourceUrl ?? null,
        d.sourceReliability ?? null,
        agentKey,
        now,
        targetId,
      ],
    );
  }
}

/** 출처 URL의 신뢰도 등급 — 정부·교육·통계·공시 A, 주요 글로벌 언론·컨설팅 B, 기타 C.
 * (S6 웹검색 후보 제안에서도 재사용 — ADR-0118 근거 표시 계약) */
export function reliabilityForSource(url: string): "A" | "B" | "C" {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host.endsWith(".gov") ||
      host.endsWith(".go.kr") ||
      host.endsWith(".edu") ||
      host.includes("kosis") ||
      host.includes("dart.fss")
    )
      return "A";
    if (
      host.includes("reuters") ||
      host.includes("bloomberg") ||
      host.includes("ft.com") ||
      host.includes("mckinsey") ||
      host.includes("bcg") ||
      host.includes("pwc") ||
      host.includes("deloitte") ||
      host.includes("kpmg") ||
      host.includes("ey.com")
    )
      return "B";
    return "C";
  } catch {
    return "C";
  }
}

function pickSource(sources: WebSource[], index: number): WebSource | null {
  if (sources.length === 0) return null;
  return sources[index % sources.length] ?? null;
}

export function makeTavilyDdTailorExecutor(search: typeof tavilySearch = tavilySearch): DdTailorExecutor {
  return async (domain, ctx) => {
    const templates = renderTemplates(domain, ctx.industry);
    const sources = await search(`${ctx.industry} ${domain} due diligence risks regulations market 2026`, {
      maxResults: 5,
    });
    return templates.map((t, index) => {
      const source = pickSource(sources, index);
      return {
        ...t,
        sourceUrl: source?.url ?? null,
        sourceReliability: source?.url ? reliabilityForSource(source.url) : "C",
      };
    });
  };
}

/** Deterministic default — profile-derived drafts, source_url null, grade 'C'. */
function defaultExecutor(): DdTailorExecutor {
  return async (domain, ctx) =>
    renderTemplates(domain, ctx.industry).map((t) => ({
      ...t,
      sourceUrl: null,
      // Honesty constraint (ADR-0099 §6): unsourced and visibly lowest-confidence.
      sourceReliability: "C" as const,
    }));
}

export function getDdTailorExecutor(): DdTailorExecutor {
  const mode = process.env.CO_NEWBIZ_DD_TAILOR_AGENTS ?? "deterministic";
  const f = mode === "llm" ? getExecutorFactory() : null;
  if (f !== null) return f();
  if (mode === "tavily" && isWebResearchConfigured()) return makeTavilyDdTailorExecutor();
  return defaultExecutor();
}

// ── The chain (one process_run, one activity per requested domain) ─────────

export interface TailorResult {
  processRunId: string;
  status: "running" | "done" | "failed";
  proposedCount: number;
}

/**
 * Run the tailoring chain for the requested domains (default: all three).
 * Synchronous by design (bun's sync SQLite layer); the { runId } response
 * contract is unchanged. Writes PROPOSALS only — never a state row, never a
 * gate_decision (boundary #2).
 */
export async function tailorDdChecklist(
  projectId: string,
  opts: {
    actor: string;
    domains?: DdTailorDomain[];
    source?: string /** ADR-0157: an opened comparison target; omitted = the selected/legacy scope. */;
    targetId?: string | null;
  },
): Promise<TailorResult> {
  const targetId = opts.targetId ?? null;
  const domains = opts.domains?.length ? opts.domains : [...DD_TAILOR_DOMAINS];
  const industry = industryLabelForProject(projectId);
  const executor = getDdTailorExecutor();
  const entity: EntityRef = { entityType: "project", entityId: projectId };

  const before = proposalCount(projectId);
  const activities: ActivitySpec[] = domains.map((domain) => {
    const agentKey = DD_DOMAIN_AGENTS[domain];
    return {
      activityId: `tailor:${domain}`,
      agentKey,
      prompt: `Propose 5-10 industry-tailored DD checklist items for the ${domain} domain — industry: ${industry} (project ${projectId})`,
      execute: async () => {
        const drafts = await executor(domain, { projectId, industry });
        persistDrafts(projectId, domain, agentKey, drafts, targetId);
        const unsourced = drafts.filter((d) => !d.sourceUrl).length;
        return [
          `### [${domain}] ${agentKey} — 산업 맞춤 DD 체크리스트 제안`,
          "",
          `${drafts.length}건 제안 (proposed 상태, 상태 행 없음 — 승인 전까지 진행 불개입).`,
          `Tavily/외부 출처 연결 ${drafts.length - unsourced}건, 출처 없는 제안 ${unsourced}건 — 출처 없는 제안은 그렇게 표시됩니다 (신뢰도 미기재/최저 등급).`,
        ].join("\n");
      },
    };
  });

  const result = await runActivityChain(entity, activities, {
    actor: opts.actor,
    source: opts.source ?? "web",
    // A comparison target's run uses its own stage key so it can never trip
    // the selected scope's already-run guard (ADR-0157).
    stage: targetId ? DD_TAILOR_TARGET_STAGE : DD_TAILOR_STAGE,
  });
  return { processRunId: result.processRunId, status: result.status, proposedCount: proposalCount(projectId) - before };
}

function proposalCount(projectId: string): number {
  return (
    getDb().query("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ?").get(projectId) as {
      c: number;
    }
  ).c;
}

/**
 * A human-proposed custom item on any of the seven domains (the only path for
 * the four ADR-0148 domains, which have no tailoring templates). Written as
 * 'proposed' with no state row, exactly like a tailoring proposal — it still
 * needs the human review (reviewDdCustomItem) before it counts. For a
 * pre-2026-10-01 project the four newer domains are recorded for reference
 * (allowed and persisted) but stay outside the S9 completion count.
 */
export const DD_CUSTOM_CREATE_ACTION = "dd_custom_item.create";
export const DD_CUSTOM_REVIEW_ACTION = "dd_custom_item.review";
export const MAX_ITEM_LABEL_LEN = 200;
export const MAX_RATIONALE_LEN = 2000;
export const MAX_SOURCE_URL_LEN = 2000;

/** Server-side source_url check: null/blank is allowed; otherwise an http(s) URL of bounded length. */
export function validSourceUrl(v: unknown): boolean {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return true;
  if (typeof v !== "string" || v.trim().length > MAX_SOURCE_URL_LEN) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The human who proposed a custom item. project_checklist_item_custom has no
 * human-proposer column (only proposed_by_agent), so the proposer is recorded
 * as the actor of the dd_custom_item.create audit entry; null when unknown.
 */
export function ddCustomItemProposer(projectId: string, itemId: string): string | null {
  const row = getDb()
    .query("SELECT actor_user_id FROM audit_log WHERE action = ? AND target = ? ORDER BY created_at, id LIMIT 1")
    .get(DD_CUSTOM_CREATE_ACTION, `${projectId}:${itemId}`) as { actor_user_id: string } | null;
  return row?.actor_user_id ?? null;
}

export function createDdCustomItem(
  projectId: string,
  input: {
    domain: DdDomain;
    itemLabel: string;
    rationale?: string | null;
    sourceUrl?: string | null;
    sourceReliability?: "A" | "B" | "C" | null;
    targetId?: string | null;
    actor?: string;
  },
): { id: string; domain: DdDomain; status: "proposed" } {
  const id = ulid();
  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    db.run(
      `INSERT INTO project_checklist_item_custom
         (id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, created_at, target_id)
       VALUES (?,?,?,?,?,?,?, NULL, 'proposed', ?, ?)`,
      [
        id,
        projectId,
        input.domain,
        input.itemLabel.trim(),
        input.rationale?.trim() || null,
        input.sourceUrl?.trim() || null,
        input.sourceReliability ?? null,
        now,
        input.targetId ?? null,
      ],
    );
    if (input.actor)
      appendAudit(db, { actor: input.actor, action: DD_CUSTOM_CREATE_ACTION, target: `${projectId}:${id}`, now });
  })();
  return { id, domain: input.domain, status: "proposed" };
}

/** The reviewer is the item's proposer — a second, distinct person must decide. */
export class DdCustomReviewError extends Error {
  constructor(
    public readonly code: "second_person_required",
    message: string,
  ) {
    super(message);
  }
}

// ── Human review (the boundary-#2 decision) ────────────────────────────────

export type TailorReviewDecision = "approved" | "rejected";

/**
 * Approve or reject one proposed item — the HUMAN decision (boundary #2).
 * On approve: status flip + approved_by/approved_at AND, in the SAME
 * transaction, the project_checklist_item_state row with
 * checklist_id = 'custom:<domain>' (item_id = the custom item's id, status
 * 'pending') — from that moment the item is judged like any other item and
 * the S9 completion check counts it with no special treatment. On reject:
 * status flip only, no state row. Returns the updated item, or null when the
 * item does not exist for this project or is not in 'proposed' status (a
 * decided item is never re-decided).
 */
export function reviewDdCustomItem(
  projectId: string,
  itemId: string,
  decision: TailorReviewDecision,
  userId: string,
): { id: string; domain: DdDomain; status: TailorReviewDecision } | null {
  const db = getDb();
  const item = db
    .query("SELECT id, domain, status, target_id FROM project_checklist_item_custom WHERE id = ? AND project_id = ?")
    .get(itemId, projectId) as { id: string; domain: DdDomain; status: string; target_id: string | null } | undefined;
  if (item?.status !== "proposed") return null;
  if (ddCustomItemProposer(projectId, itemId) === userId) {
    throw new DdCustomReviewError(
      "second_person_required",
      "The proposer of a custom item cannot approve/reject it — another person must review it.",
    );
  }
  const now = nowIso();
  const apply = db.transaction(() => {
    db.run("UPDATE project_checklist_item_custom SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?", [
      decision,
      userId,
      now,
      itemId,
    ]);
    if (decision === "approved") {
      db.run(
        `INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at, target_id)
         VALUES (?,?,?,?, 'pending', ?, ?, ?)`,
        [ulid(), projectId, customChecklistId(item.domain), itemId, userId, now, item.target_id],
      );
    }
    appendAudit(db, {
      actor: userId,
      action: DD_CUSTOM_REVIEW_ACTION,
      target: `${projectId}:${itemId}:${decision}`,
      now,
    });
  });
  apply();
  return { id: itemId, domain: item.domain, status: decision };
}

// ── Judgment state write (the S9 workspace's ordinary write path) ──────────

// ── bf-01 derived from the validator completeness engine (ADR-0186 D4, design 3.4) ────────────────────

export const BF_FEASIBILITY_CHECKLIST_ID = "chk-brownfield-feasibility-checklist";
export const BF_VALIDATORS_ITEM_ID = "bf-01";

export interface DerivedBf01 {
  status: "pass" | "fail";
  note: string;
  applicable: number;
  completed: number;
  missing: string[];
  evaluated_at: string;
}

/**
 * bf-01 ("all six M&A validators recorded") is not a hand-set checkbox: under family `validators` = enforce its
 * state is the engine's read-only verdict (pass when no applicable core validator is missing, else fail with the
 * missing list in the note) and a stored manual row is ignored. null = not derived (flag not enforce, or the
 * brownfield-feasibility checklist is not attached to this project's DD scope).
 */
export function derivedBf01(projectId: string, db: Database = getDb()): DerivedBf01 | null {
  if (gateIntegrityMode("validators") !== "enforce") return null;
  if (!subTrackChecklistIds(projectId).includes(BF_FEASIBILITY_CHECKLIST_ID)) return null;
  const v = evaluateValidatorCompleteness(projectId, null, db);
  const missing = [...v.halt.missing] as string[];
  return {
    status: missing.length === 0 ? "pass" : "fail",
    note:
      missing.length === 0
        ? `Derived from the validator engine: ${v.completed_count} of ${v.applicable_count} applicable core validators recorded.`
        : `Derived from the validator engine: applicable core validator(s) missing - ${missing.join(", ")}.`,
    applicable: v.applicable_count,
    completed: v.completed_count,
    missing,
    evaluated_at: v.evaluated_at,
  };
}

/** Replace the stored bf-01 row by the derived verdict (selected/legacy scope only). */
function withDerivedBf01<T extends { checklist_id: string; item_id: string; status: string }>(
  projectId: string,
  rows: T[],
  make: (derived: DerivedBf01) => T,
): T[] {
  const derived = derivedBf01(projectId);
  if (!derived) return rows;
  return [
    ...rows.filter((r) => !(r.checklist_id === BF_FEASIBILITY_CHECKLIST_ID && r.item_id === BF_VALIDATORS_ITEM_ID)),
    make(derived),
  ];
}

export const STATE_STATUSES = ["pending", "pass", "fail", "na", "waived"] as const;
export type ChecklistStateStatus = (typeof STATE_STATUSES)[number];

/**
 * Upsert one judgment-state row for a standard checklist item or an approved
 * custom item (checklist_id 'custom:<domain>'). A 'waived' status requires a
 * waiver_id (0039 discipline, enforced at the API layer — a waiver is created
 * per-project against a key, not per checklist item). Returns null when the
 * (checklist_id, item_id) pair is not an applied item of this project.
 */
export function upsertChecklistState(
  projectId: string,
  checklistId: string,
  itemId: string,
  status: ChecklistStateStatus,
  userId: string,
  opts: {
    note?: string;
    evidenceRef?: string;
    waiverId?: string /** ADR-0157: resolved scope (see resolveDdScope); NULL = selected/legacy. */;
    targetId?: string | null;
  } = {},
): { id: string } | null {
  const db = getDb();
  const targetId = opts.targetId ?? null;
  let known = false;
  if (checklistId.startsWith(CUSTOM_CHECKLIST_PREFIX)) {
    known = !!db
      .query(
        "SELECT id FROM project_checklist_item_custom WHERE id = ? AND project_id = ? AND status = 'approved' AND target_id IS ?",
      )
      .get(itemId, projectId, targetId);
  } else {
    const items = getChecklistItems(checklistId);
    known = !!items?.some((i) => i.id === itemId);
  }
  if (!known) return null;
  // ADR-0160 addendum (b): an item the workspace scope excludes (N, X with a judged
  // replacement) takes no NEW judgement (409). An item that already carries a row
  // (judged under the previous scope) may be re-judged, so a recorded fail can be
  // cleared by a person — never silently (design §9.3).
  if (targetId === null) {
    const ws = workspaceScopeContext(projectId, db);
    const sc = ws?.items.get(`${checklistId}:${itemId}`);
    if (ws && sc && !sc.judgeable && !ws.states.has(`${checklistId}:${itemId}`)) {
      throw new DdTargetError(
        409,
        "dd_item_out_of_scope",
        `This item (${itemId}) is, under the greenfield work scope, ${sc.code === "X" ? "replaced by another item" : "not applicable under the track rule"} — a new judgement cannot be recorded.`,
      );
    }
    // ADR-0162: the same rule for an in-scope brownfield project (workspace items and
    // section-scoped extras). m_and_a / grandfathered projects have no context.
    const bf = ws ? null : brownfieldScopeContext(projectId, db);
    const bsc = bf?.items.get(`${checklistId}:${itemId}`);
    if (bf && bsc && !bsc.judgeable && !bf.states.has(`${checklistId}:${itemId}`)) {
      throw new DdTargetError(
        409,
        "dd_item_out_of_scope",
        `This item (${itemId}) is, under the brownfield work scope, ${bsc.code === "X" ? "replaced by another item" : "not applicable due to deal shape"} — a new judgement cannot be recorded.`,
      );
    }
  }
  if (status === "waived" && !opts.waiverId) return null;
  if (opts.waiverId) {
    // A waiver applies to exactly one DD scope (ADR-0157): matched on target_id equality.
    const waiver = db
      .query("SELECT target_id FROM waiver WHERE id = ? AND project_id = ?")
      .get(opts.waiverId, projectId) as { target_id: string | null } | undefined;
    if (waiver && waiver.target_id !== targetId) {
      throw new DdTargetError(
        400,
        "waiver_target_mismatch",
        "This waiver belongs to another target's DD scope — only waivers of the same target can be linked.",
      );
    }
  }
  const now = nowIso();
  const existing = db
    .query(
      "SELECT id FROM project_checklist_item_state WHERE project_id = ? AND target_id IS ? AND checklist_id = ? AND item_id = ?",
    )
    .get(projectId, targetId, checklistId, itemId) as { id: string } | undefined;
  if (existing) {
    db.run(
      "UPDATE project_checklist_item_state SET status = ?, note = COALESCE(?, note), evidence_ref = COALESCE(?, evidence_ref), waiver_id = COALESCE(?, waiver_id), assessed_by = ?, assessed_at = ?, na_confirmed_by = NULL, na_confirmed_at = NULL WHERE id = ?",
      [status, opts.note ?? null, opts.evidenceRef ?? null, opts.waiverId ?? null, userId, now, existing.id],
    );
    return existing;
  }
  const id = ulid();
  db.run(
    `INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at, target_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      projectId,
      checklistId,
      itemId,
      status,
      opts.note ?? null,
      opts.evidenceRef ?? null,
      opts.waiverId ?? null,
      userId,
      now,
      targetId,
    ],
  );
  return { id };
}

// ── S9 completion predicate (ADR-0099 §5 — state table only) ───────────────

/**
 * The S9 predicate inputs, read from project_checklist_item_state ONLY —
 * this check never reads project_checklist_item_custom. A 'proposed'
 * (unapproved) item has no state row, so it cannot count toward coverage,
 * cannot block, and cannot satisfy anything.
 */
export interface DdCompletionSummary {
  total: number;
  pending: number;
  /**
   * Standard items with no state row, counted only for projects created on/after
   * DD_UNASSESSED_COUNTED_FROM (ADR-0148 option A); always 0 for earlier projects.
   * Separate from `pending` so the pipeline's checklist_approval trigger keeps its meaning.
   */
  unassessed: number;
  /** fail rows on mandatory items without a waiver — the "필수 미충족" count. */
  mandatoryUnmet: number;
  /**
   * ADR-0160 addendum (b): present ONLY for greenfield projects in the new workspace
   * scope (brownfield and grandfathered payloads are unchanged). Y = judgeable items
   * (A + R, C when the site is in scope) of the counted workspace checklists plus the
   * scoped sub-track extras; X/N items never count.
   */
  judged?: number;
  judgeable?: number;
  /** Seven-domain part of `judgeable` (design §5: 52 / 56 / 51, +3 site items). */
  workspace_judgeable?: number;
  /** N + X items of the counted workspace checklists (the "Excluded by track rule" count). */
  excluded?: number;
}

/** View paths require the scoped counts (judged/judgeable/workspace_judgeable/
 *  excluded are optional on DdCompletionSummary because non-scoped summaries
 *  omit them); a missing count there is a wiring bug, not data — fail loudly
 *  instead of asserting non-null. */
function scopedCount(v: number | undefined): number {
  if (v === undefined) throw new Error("scoped completion summary count missing");
  return v;
}

const STANDARD_MANDATORY_CACHE = new Map<string, Set<string>>();

function mandatoryItemIds(checklistId: string): Set<string> | null {
  const cached = STANDARD_MANDATORY_CACHE.get(checklistId);
  if (cached) return cached;
  const items = getChecklistItems(checklistId);
  if (!items) return null; // unknown checklist — not part of the applied floor
  const set = new Set(items.filter((i) => i.mandatory).map((i) => i.id));
  STANDARD_MANDATORY_CACHE.set(checklistId, set);
  return set;
}

/**
 * ADR-0186 D5: whether an item is mandatory. Standard items follow the checklist
 * yaml's flag; an approved custom item was approved INTO the gate-relevant set,
 * so it counts as mandatory (ADR-0099 section 5).
 */
export function isMandatoryChecklistItem(checklistId: string, itemId: string): boolean {
  if (checklistId.startsWith(CUSTOM_CHECKLIST_PREFIX)) return true;
  return mandatoryItemIds(checklistId)?.has(itemId) ?? false;
}

/** Whether (checklist, item) is an applied item of this project in this DD scope (standard, or an approved custom item). */
export function isKnownChecklistItem(
  projectId: string,
  checklistId: string,
  itemId: string,
  targetId: string | null,
): boolean {
  if (checklistId.startsWith(CUSTOM_CHECKLIST_PREFIX)) {
    return !!getDb()
      .query(
        "SELECT id FROM project_checklist_item_custom WHERE id = ? AND project_id = ? AND status = 'approved' AND target_id IS ?",
      )
      .get(itemId, projectId, targetId);
  }
  return !!getChecklistItems(checklistId)?.some((i) => i.id === itemId);
}

/**
 * ADR-0186 D5: under `enforce`, a mandatory `na` that no second person confirmed
 * counts as pending (the flag is read per call; shadow and off keep the old count).
 */
function unconfirmedMandatoryNa(r: {
  checklist_id: string;
  item_id: string;
  status: string;
  na_confirmed_by: string | null;
}): boolean {
  return (
    r.status === "na" &&
    !r.na_confirmed_by &&
    gateIntegrityMode("waiver") === "enforce" &&
    isMandatoryChecklistItem(r.checklist_id, r.item_id)
  );
}

/**
 * ADR-0148 option A: from this instant on, a project's standard DD checklist items
 * that have no state row count as `unassessed`, so a never-assessed mandatory item
 * blocks S9 like any other undecided item (reported as `unassessed`). Projects created before it keep the
 * earlier row-only counting (no retroactive blocking). Keyed on md_project.created_at.
 */
export const DD_UNASSESSED_COUNTED_FROM = "2026-10-01T00:00:00.000Z";

/** The four domains added to the S9 workspace by ADR-0148 beyond commercial/technical/legal. */
const DD_NEW_DOMAIN_CHECKLISTS: ReadonlySet<string> = new Set(
  (["financial", "hr", "market", "financing"] as const).map((d) => DD_WORKSPACE_CHECKLISTS[d]),
);
function isGrandfatheredDomain(domain: DdDomain): boolean {
  const mapped = DD_WORKSPACE_CHECKLISTS[domain];
  return mapped !== undefined && DD_NEW_DOMAIN_CHECKLISTS.has(mapped);
}
/**
 * Pre-2026-10-01 projects: the four newer domains are judged and kept for reference
 * (writes allowed) but never enter the completion count, so their gates do not move.
 */
export const DD_NOT_COUNTED_REASON =
  "Recorded for reference; not counted in S9 completion for projects created before 2026-10-01";

export interface DdDomainAdoption {
  adopted: boolean;
  rationale: string;
  by: string;
  at: string;
}

/** 2026-10-19 decider-approved option: a PERSON may adopt the four newer DD
 *  domains (재무·인사·시장·자금조달 계획) into THIS project's S9 completion count
 *  and the dd gate — the same escape hatch as the greenfield hr exception, but
 *  recorded (rationale mandatory + audited) instead of silent. Null = grandfathered
 *  reference-only (today's behavior). */
export function ddDomainAdoption(projectId: string): DdDomainAdoption | null {
  const row = getDb().query("SELECT dd_domain_adopt_json AS j FROM md_project WHERE id = ?").get(projectId) as
    | { j: string | null }
    | undefined;
  if (!row?.j) return null;
  try {
    const parsed = JSON.parse(row.j) as { adopted?: unknown; rationale?: unknown; by?: unknown; at?: unknown };
    if (parsed.adopted !== true || typeof parsed.rationale !== "string") return null;
    return { adopted: true, rationale: parsed.rationale, by: String(parsed.by ?? ""), at: String(parsed.at ?? "") };
  } catch {
    return null;
  }
}

export function writeDdDomainAdoption(
  db: { run: (sql: string, ...args: unknown[]) => void },
  projectId: string,
  opts: { adopted: boolean; rationale: string; by: string; at: string },
): void {
  const json = opts.adopted
    ? JSON.stringify({ adopted: true, rationale: opts.rationale, by: opts.by, at: opts.at })
    : null;
  db.run("UPDATE md_project SET dd_domain_adopt_json = ? WHERE id = ?", [json, projectId]);
}

/** The effective "newer DD domains count" flag: created on/after the cut-off, OR
 *  the person adopted them for this project. Every DD counting path reads this —
 *  never the raw created_at test alone. */
export function newerDomainsCounted(projectId: string): boolean {
  return countsUnassessedItems(projectId) || ddDomainAdoption(projectId)?.adopted === true;
}

export function isDdDomain(value: string): value is DdDomain {
  return (DD_DOMAINS as readonly string[]).includes(value);
}

/**
 * ADR-0160 addendum (2026-10-12): for a greenfield project in the new workspace
 * scope (opted in, or created after the cut-off) the hr ("인력/조직 계획") domain is
 * counted even when the project was created before 2026-10-01 — a new entity or team
 * is established on that plan. The other three newer domains stay reference-only.
 */
const GF_SCOPE_COUNTED_NEW_DOMAINS: ReadonlySet<DdDomain> = new Set<DdDomain>(["hr"]);

/** True for a state row the completion count ignores: a newer-domain row (standard or custom) of a pre-2026-10-01 project. */
function uncountedRow(checklistId: string, countsNewDomains: boolean, gfInScope = false): boolean {
  if (countsNewDomains) return false;
  const d = checklistId.startsWith(CUSTOM_CHECKLIST_PREFIX)
    ? checklistId.slice(CUSTOM_CHECKLIST_PREFIX.length)
    : (Object.keys(DD_WORKSPACE_CHECKLISTS) as DdDomain[]).find((k) => DD_WORKSPACE_CHECKLISTS[k] === checklistId);
  if (!d || !isDdDomain(d) || !isGrandfatheredDomain(d)) return false;
  return !(gfInScope && GF_SCOPE_COUNTED_NEW_DOMAINS.has(d));
}

function countsUnassessedItems(projectId: string): boolean {
  const row = getDb().query("SELECT created_at FROM md_project WHERE id = ?").get(projectId) as
    | { created_at: string }
    | undefined;
  return !!row && row.created_at >= DD_UNASSESSED_COUNTED_FROM;
}

/**
 * Wave F-8 (audit B1): sub-track-specific checklists the project must also judge.
 * Brownfield: empty for sub-tracks without one and for projects pinned before
 * WAVE_F_PREDICATE_DATE (grandfathered — no retroactive blocking).
 * Greenfield (ADR-0160): per greenfieldSelection — empty for the null
 * sub-track and for projects grandfathered by GF_SUBTRACK_PREDICATE_DATE.
 */
export function subTrackChecklistIds(projectId: string): string[] {
  const db = getDb();
  const proj = db.query("SELECT created_at, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as
    | { created_at: string | null; source_opportunity_id: string | null }
    | undefined;
  if (!proj?.source_opportunity_id) return [];
  const pin = db
    // The ADR-0162 opt-in pin never re-dates a project; it attaches extras explicitly below.
    .query("SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ? AND policy_doc_id != ?")
    .get(projectId, BF_WS_POLICY_DOC_ID) as { at: string | null };
  // ADR-0160: greenfield has its own cut-off/opt-in rule (greenfield-subtrack.ts);
  // the brownfield path below is unchanged.
  const gf = greenfieldSelection(projectId, db);
  if (gf) return gf.extra_checklists;
  // ADR-0162 (user decision 2026-10-12): a recorded brownfield opt-in attaches the sub-track extras.
  const bfInfo = brownfieldRouteInfo(projectId, db);
  // DEC-20261013-03 / DEC-20261013-04: the scoped path is "opt-in OR past
  // BF_WORKSPACE_SCOPE_DATE"; since the cut-off moved to 2026-07-01 (before
  // WAVE_F_PREDICATE_DATE), an in-scope-by-date project gets the same scoped extras
  // as an opted-in one, ahead of the WAVE_F grandfathering below.
  if (bfInfo?.scope_key && (bfInfo.opted_in || bfInfo.by_date)) return scopedSubTrackDdChecklists(bfInfo.scope_key);
  if ((pin.at ?? proj.created_at ?? "") < WAVE_F_PREDICATE_DATE) return [];
  const route = db
    .query("SELECT track, sub_track FROM route_decision WHERE opportunity_id = ? AND is_current = 1")
    .get(proj.source_opportunity_id) as { track: string; sub_track: string | null } | undefined;
  if (route?.track !== "brownfield" || !route.sub_track) return [];
  return SUB_TRACK_DD_CHECKLISTS[route.sub_track] ?? [];
}

/**
 * ADR-0157: the completion summary of ONE DD scope. The default (no options)
 * reads target_id IS NULL — the selected/legacy scope — so the S9 predicate and
 * the dd gate readiness, which call it with no target, can never be moved by
 * rows recorded on another target. A comparison view passes an opened target id.
 */
export function ddCompletionSummary(projectId: string, opts: { targetId?: string | null } = {}): DdCompletionSummary {
  const targetId = opts.targetId ?? null;
  if (targetId === null) {
    const ws = workspaceScopeContext(projectId, getDb());
    if (ws) return scopedCompletionSummary(projectId, gfScopedInput(ws));
    // ADR-0162: brownfield non-baseline sub-tracks in scope only (m_and_a, null
    // sub-track and grandfathered projects keep the default path below, byte-identical).
    const bf = brownfieldScopeContext(projectId, getDb());
    if (bf) return scopedCompletionSummary(projectId, bfScopedInput(bf));
  }
  const rowsRaw = (
    getDb()
      .query(
        `SELECT checklist_id, item_id, status, waiver_id, na_confirmed_by FROM project_checklist_item_state WHERE project_id = ? AND target_id IS ?`,
      )
      .all(projectId, targetId) as Array<{
      checklist_id: string;
      item_id: string;
      status: string;
      waiver_id: string | null;
      na_confirmed_by: string | null;
    }>
  )
    // Reference-only rows (newer domains of a pre-2026-10-01 project) never enter the count.
    .filter((r) => !uncountedRow(r.checklist_id, newerDomainsCounted(projectId)));
  const rows =
    targetId === null
      ? withDerivedBf01(projectId, rowsRaw, (d) => ({
          checklist_id: BF_FEASIBILITY_CHECKLIST_ID,
          item_id: BF_VALIDATORS_ITEM_ID,
          status: d.status,
          waiver_id: null,
          na_confirmed_by: null,
        }))
      : rowsRaw;
  const extraIds = subTrackChecklistIds(projectId);
  const extraSet = new Set(extraIds);
  let pending = 0;
  let mandatoryUnmet = 0;
  for (const r of rows) {
    if (r.status === "pending" || unconfirmedMandatoryNa(r)) pending += 1;
    if (r.status === "fail" && !r.waiver_id) {
      // Approved custom items were approved INTO the gate-relevant set —
      // approval is the mandatory declaration for them (ADR-0099 §5); for
      // standard items the yaml's mandatory flag decides.
      if (r.checklist_id.startsWith(CUSTOM_CHECKLIST_PREFIX) || mandatoryItemIds(r.checklist_id)?.has(r.item_id)) {
        mandatoryUnmet += 1;
      }
    }
  }
  // Binding items (mandatory, waiver_eligible=false — e.g. bf-01 "all six M&A
  // validators recorded") cannot be satisfied by na/waived: a missing
  // validator is a Kill Criterion, not an exemption.
  for (const checklistId of extraIds) {
    for (const item of scopedChecklistItems(checklistId) ?? []) {
      if (!item.mandatory || item.waiver_eligible) continue;
      const st = rows.find((r) => r.checklist_id === checklistId && r.item_id === item.id);
      if (st && (st.status === "na" || st.status === "waived")) mandatoryUnmet += 1;
    }
  }
  let unassessed = 0;
  if (newerDomainsCounted(projectId) || extraIds.length > 0) {
    const have = new Set(rows.map((r) => `${r.checklist_id}:${r.item_id}`));
    const applicable = [...(newerDomainsCounted(projectId) ? Object.values(DD_WORKSPACE_CHECKLISTS) : []), ...extraSet];
    for (const checklistId of applicable) {
      for (const item of (extraSet.has(checklistId)
        ? scopedChecklistItems(checklistId)
        : getChecklistItems(checklistId)) ?? []) {
        if (have.has(`${checklistId}:${item.id}`)) continue;
        unassessed += 1;
      }
    }
  }
  return { total: rows.length, pending, unassessed, mandatoryUnmet };
}

/**
 * Workspace checklists that count for this project (ADR-0148 §6B: the four newer domains
 * only from 2026-10-01; ADR-0160 addendum: hr also for an in-scope greenfield project).
 */
function countedWorkspaceChecklists(projectId: string, gfInScope = false): string[] {
  const all = Object.values(DD_WORKSPACE_CHECKLISTS);
  if (newerDomainsCounted(projectId)) return all;
  const keep = new Set(gfInScope ? [...GF_SCOPE_COUNTED_NEW_DOMAINS].map((d) => DD_WORKSPACE_CHECKLISTS[d]) : []);
  return all.filter((c) => !DD_NEW_DOMAIN_CHECKLISTS.has(c) || keep.has(c));
}

/**
 * ADR-0160 addendum (b) completion for a greenfield project in the workspace scope.
 * Same rules as the default path with the applicable set narrowed: pending and
 * unassessed only on judgeable items; a recorded fail (no waiver) on a mandatory item
 * stays unmet whatever its new code (no silent removal of a negative finding).
 */
interface ScopedInput {
  /** Resolved scope per `<checklist_id>:<item_id>` (judgeable false = N / X). */
  items: Map<string, { judgeable: boolean }>;
  /** Attached extra checklists with their judgeable (scoped) items. */
  extras: Array<[string, ChecklistItemDef[]]>;
  /** Greenfield in the workspace scope: hr counts even for a pre-2026-10-01 project. */
  gfInScope?: boolean;
}
function gfScopedInput(ws: WorkspaceScopeContext): ScopedInput {
  return {
    items: ws.items,
    extras: ws.sel.extra_checklists.map((c) => [c, scopedChecklistItems(c) ?? []] as [string, ChecklistItemDef[]]),
    gfInScope: true,
  };
}
function bfScopedInput(bf: BrownfieldScopeContext): ScopedInput {
  return {
    items: bf.items,
    extras: bf.extra_checklists.map((c) => [c, brownfieldExtraItems(bf, c)] as [string, ChecklistItemDef[]]),
  };
}

function scopedCompletionSummary(projectId: string, ws: ScopedInput): DdCompletionSummary {
  const rowsRaw = (
    getDb()
      .query(
        "SELECT checklist_id, item_id, status, waiver_id, na_confirmed_by FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL",
      )
      .all(projectId) as Array<{
      checklist_id: string;
      item_id: string;
      status: string;
      waiver_id: string | null;
      na_confirmed_by: string | null;
    }>
  ).filter((r) => !uncountedRow(r.checklist_id, newerDomainsCounted(projectId), !!ws.gfInScope));
  const rows = withDerivedBf01(projectId, rowsRaw, (d) => ({
    checklist_id: BF_FEASIBILITY_CHECKLIST_ID,
    item_id: BF_VALIDATORS_ITEM_ID,
    status: d.status,
    waiver_id: null,
    na_confirmed_by: null,
  }));
  const counted = countedWorkspaceChecklists(projectId, !!ws.gfInScope);
  const outOfScope = (r: { checklist_id: string; item_id: string }) =>
    ws.items.get(`${r.checklist_id}:${r.item_id}`)?.judgeable === false;
  let pending = 0;
  let mandatoryUnmet = 0;
  for (const r of rows) {
    if ((r.status === "pending" || unconfirmedMandatoryNa(r)) && !outOfScope(r)) pending += 1;
    if (r.status === "fail" && !r.waiver_id) {
      if (r.checklist_id.startsWith(CUSTOM_CHECKLIST_PREFIX) || mandatoryItemIds(r.checklist_id)?.has(r.item_id))
        mandatoryUnmet += 1;
    }
  }
  for (const [checklistId, extraItems] of ws.extras) {
    for (const item of extraItems) {
      if (!item.mandatory || item.waiver_eligible) continue;
      const st = rows.find((r) => r.checklist_id === checklistId && r.item_id === item.id);
      if (st && (st.status === "na" || st.status === "waived")) mandatoryUnmet += 1;
    }
  }
  // Workspace binding items (fin-09) are never N/X (overlay validator) and keep the default rule.
  const byKey = new Map(rows.map((r) => [`${r.checklist_id}:${r.item_id}`, r]));
  const countUnassessed = newerDomainsCounted(projectId);
  let unassessed = 0;
  let judged = 0;
  let workspaceJudgeable = 0;
  let excluded = 0;
  for (const checklistId of counted) {
    for (const item of getChecklistItems(checklistId) ?? []) {
      const k = `${checklistId}:${item.id}`;
      if (ws.items.get(k)?.judgeable === false) {
        excluded += 1;
        continue;
      }
      workspaceJudgeable += 1;
      const st = byKey.get(k);
      if (st && st.status !== "pending") judged += 1;
      if (!st && countUnassessed) unassessed += 1;
    }
  }
  let extraJudgeable = 0;
  for (const [checklistId, extraItems] of ws.extras) {
    for (const item of extraItems) {
      extraJudgeable += 1;
      const st = byKey.get(`${checklistId}:${item.id}`);
      if (st && st.status !== "pending") judged += 1;
      if (!st) unassessed += 1;
    }
  }
  return {
    total: rows.length,
    pending,
    unassessed,
    mandatoryUnmet,
    judged,
    judgeable: workspaceJudgeable + extraJudgeable,
    workspace_judgeable: workspaceJudgeable,
    excluded,
  };
}

/** The workspace-scope block of the dd GET / greenfield-scope GET (greenfield in scope only). */
export interface WorkspaceScopeView {
  active: true;
  overlay_doc_id: string;
  overlay_version: string;
  scope_key: WorkspaceScopeKey;
  /** Per item: code, reading / reason, replacement pointers, step tags. Key `<checklist_id>:<item_id>`. */
  items: Record<string, WorkspaceItemScope>;
  /** Interim greenfield tab labels from the overlay (person chooses the final ones). */
  tab_labels: Record<string, { en: string; ko: string }>;
  step_tabs: Record<string, StepTag[]>;
  plan_readiness: PlanReadinessRow[];
  previous_scope: PreviousScopeEntry[];
  counts: { judged: number; judgeable: number; workspace_judgeable: number; excluded: number; mandatory_unmet: number };
}

/** Workspace scope view for a greenfield project; `null` when the scope is not active (grandfathered or no overlay). */
export function workspaceScopeView(projectId: string, sel?: GreenfieldSelection | null): WorkspaceScopeView | null {
  const db = getDb();
  const ws = workspaceScopeContext(projectId, db, sel);
  if (!ws) return null;
  const ov = workspaceOverlay();
  if (!ov) return null;
  const c = scopedCompletionSummary(projectId, gfScopedInput(ws));
  return {
    active: true,
    overlay_doc_id: ov.governance_doc_id,
    overlay_version: ws.overlay_version,
    scope_key: ws.key,
    items: Object.fromEntries(ws.items),
    tab_labels: ov.tab_labels,
    step_tabs: stepTabMap(ws.sel, ws.states),
    plan_readiness: planReadinessRows(projectId, ws.sel, db),
    previous_scope: previousScopeEntries(ws.items, ws.states),
    counts: {
      judged: scopedCount(c.judged),
      judgeable: scopedCount(c.judgeable),
      workspace_judgeable: scopedCount(c.workspace_judgeable),
      excluded: scopedCount(c.excluded),
      mandatory_unmet: c.mandatoryUnmet,
    },
  };
}

export interface WorkspaceOptInPreview {
  project_id: string;
  eligible: boolean;
  /** Why the opt-in is not offered (already in scope, brownfield, no overlay). */
  reason: string | null;
  overlay_version: string | null;
  before: { judged: number; judgeable: number; pending: number; unassessed: number; mandatory_unmet: number };
  after: {
    judged: number;
    judgeable: number;
    workspace_judgeable: number;
    excluded: number;
    pending: number;
    unassessed: number;
    mandatory_unmet: number;
  };
  /** Existing judgements that move to "Judged under previous scope" (kept, never deleted). */
  moves_to_previous_scope: PreviousScopeEntry[];
  /** Recorded fails (no waiver) on items leaving scope — they stay unmet until a person re-judges them. */
  fails_stay_unmet: PreviousScopeEntry[];
  /** True when the opt-in also records the ADR-0160 sub-track pin (one human act, two pins). */
  records_subtrack_pin: boolean;
  /**
   * Greenfield only: newer-domain checklists that enter the count with the opt-in
   * (hr for a pre-2026-10-01 project) — judgeable items and those already judged.
   * Empty when nothing new becomes countable.
   */
  newly_counted?: Array<{ checklist_id: string; judgeable: number; judged: number; judged_item_ids: string[] }>;
  /** ADR-0162 (brownfield preview only): extra checklists the opt-in attaches that are not attached today, with judgeable (scoped) counts. */
  extras_attached_by_opt_in?: Array<{ checklist_id: string; judgeable: number; excluded: number }>;
}

/** Judged / applicable count of the current (pre-opt-in) view, read the same way the S9 tabs read it. */
function currentViewCounts(projectId: string): { judged: number; judgeable: number } {
  const db = getDb();
  const rows = db
    .query(
      "SELECT checklist_id, item_id, status FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL",
    )
    .all(projectId) as Array<{ checklist_id: string; item_id: string; status: string }>;
  const byKey = new Map(rows.map((r) => [`${r.checklist_id}:${r.item_id}`, r]));
  let judged = 0;
  let judgeable = 0;
  const lists: Array<[string, ChecklistItemDef[]]> = [
    ...countedWorkspaceChecklists(projectId).map(
      (c) => [c, getChecklistItems(c) ?? []] as [string, ChecklistItemDef[]],
    ),
    ...subTrackChecklistIds(projectId).map((c) => [c, scopedChecklistItems(c) ?? []] as [string, ChecklistItemDef[]]),
  ];
  for (const [c, items] of lists) {
    for (const i of items) {
      judgeable += 1;
      const st = byKey.get(`${c}:${i.id}`);
      if (st && st.status !== "pending") judged += 1;
    }
  }
  return { judged, judgeable };
}

/** hr (and any other GF_SCOPE_COUNTED_NEW_DOMAINS) items that become countable with the scope. */
function newlyCountedChecklists(projectId: string, hyp: WorkspaceScopeContext, active: boolean) {
  if (active) return [];
  const before = new Set(countedWorkspaceChecklists(projectId));
  const out: NonNullable<WorkspaceOptInPreview["newly_counted"]> = [];
  for (const c of countedWorkspaceChecklists(projectId, true)) {
    if (before.has(c)) continue;
    let judgeable = 0;
    const judgedIds: string[] = [];
    for (const i of getChecklistItems(c) ?? []) {
      if (hyp.items.get(`${c}:${i.id}`)?.judgeable === false) continue;
      judgeable += 1;
      const st = hyp.states.get(`${c}:${i.id}`);
      if (st && st.status !== "pending") judgedIds.push(i.id);
    }
    out.push({ checklist_id: c, judgeable, judged: judgedIds.length, judged_item_ids: judgedIds });
  }
  return out;
}

/** Read-only opt-in preview (design §9.3): how X / Y changes; nothing is written. */
export function workspaceOptInPreview(projectId: string): WorkspaceOptInPreview | null {
  const db = getDb();
  const sel = greenfieldSelection(projectId, db);
  if (!sel) return null;
  const current = ddCompletionSummary(projectId);
  const cur = currentViewCounts(projectId);
  const active = workspaceScopeContext(projectId, db, sel);
  const hyp = active ?? hypotheticalWorkspaceScope(projectId, db);
  const before = {
    judged: current.judged ?? cur.judged,
    judgeable: current.judgeable ?? cur.judgeable,
    pending: current.pending,
    unassessed: current.unassessed,
    mandatory_unmet: current.mandatoryUnmet,
  };
  if (!hyp) {
    return {
      project_id: projectId,
      eligible: false,
      reason: "작업 범위 오버레이를 읽을 수 없습니다.",
      overlay_version: null,
      before,
      after: { ...before, workspace_judgeable: 0, excluded: 0 },
      moves_to_previous_scope: [],
      fails_stay_unmet: [],
      records_subtrack_pin: false,
    };
  }
  const after = scopedCompletionSummary(projectId, gfScopedInput(hyp));
  const moved = previousScopeEntries(hyp.items, hyp.states);
  return {
    project_id: projectId,
    eligible: !active,
    reason: active ? "이미 새 작업 범위가 적용된 프로젝트입니다." : null,
    overlay_version: hyp.overlay_version,
    before,
    after: {
      judged: scopedCount(after.judged),
      judgeable: scopedCount(after.judgeable),
      workspace_judgeable: scopedCount(after.workspace_judgeable),
      excluded: scopedCount(after.excluded),
      pending: after.pending,
      unassessed: after.unassessed,
      mandatory_unmet: after.mandatoryUnmet,
    },
    moves_to_previous_scope: moved,
    fails_stay_unmet: moved.filter((m) => m.stays_unmet),
    records_subtrack_pin: !active && hyp.sel.selection_active && !sel.selection_active,
    newly_counted: newlyCountedChecklists(projectId, hyp, !!active),
  };
}

// ── ADR-0162 brownfield workspace scope (view + opt-in preview) ───────────

/** The brownfield workspace-scope block of the dd GET (non-baseline sub-tracks in scope only). */
export interface BrownfieldWorkspaceScopeView {
  active: true;
  overlay_doc_id: string;
  overlay_version: string;
  scope_key: BrownfieldScopeKey;
  opted_in: boolean;
  /** Attached extra checklists (attach rule unchanged); their excluded sections carry code N. */
  extra_checklists: string[];
  /** Per item (workspace + attached extras): code, reading / reason, replacement pointers. Key `<checklist_id>:<item_id>`. */
  items: Record<string, WorkspaceItemScope>;
  previous_scope: PreviousScopeEntry[];
  counts: {
    judged: number;
    judgeable: number;
    workspace_judgeable: number;
    excluded: number;
    extras_excluded: number;
    mandatory_unmet: number;
  };
}

function brownfieldViewOf(projectId: string, ctx: BrownfieldScopeContext): BrownfieldWorkspaceScopeView {
  const c = scopedCompletionSummary(projectId, bfScopedInput(ctx));
  let extrasExcluded = 0;
  for (const sc of ctx.items.values())
    if (!sc.judgeable && ctx.extra_checklists.includes(sc.checklist_id)) extrasExcluded += 1;
  return {
    active: true,
    overlay_doc_id: BF_WS_POLICY_DOC_ID,
    overlay_version: ctx.overlay_version,
    scope_key: ctx.key,
    opted_in: ctx.opted_in,
    extra_checklists: ctx.extra_checklists,
    items: Object.fromEntries(ctx.items),
    previous_scope: brownfieldPreviousScope(ctx),
    counts: {
      judged: scopedCount(c.judged),
      judgeable: scopedCount(c.judgeable),
      workspace_judgeable: scopedCount(c.workspace_judgeable),
      excluded: scopedCount(c.excluded),
      extras_excluded: extrasExcluded,
      mandatory_unmet: c.mandatoryUnmet,
    },
  };
}

/** Brownfield workspace scope view; null for m_and_a, null sub-track, grandfathered projects and greenfield. */
export function brownfieldWorkspaceScopeView(projectId: string): BrownfieldWorkspaceScopeView | null {
  const ctx = brownfieldScopeContext(projectId, getDb());
  return ctx ? brownfieldViewOf(projectId, ctx) : null;
}

/**
 * Read-only brownfield opt-in preview (design §9.3): before / after counts and
 * the judgements that would move to "Judged under previous scope". null when
 * the project is not on the brownfield route. Nothing is written.
 */
export function brownfieldOptInPreview(projectId: string): WorkspaceOptInPreview | null {
  const db = getDb();
  const info = brownfieldRouteInfo(projectId, db);
  if (!info) return null;
  const current = ddCompletionSummary(projectId);
  const cur = currentViewCounts(projectId);
  const before = {
    judged: current.judged ?? cur.judged,
    judgeable: current.judgeable ?? cur.judgeable,
    pending: current.pending,
    unassessed: current.unassessed,
    mandatory_unmet: current.mandatoryUnmet,
  };
  const active = brownfieldScopeContext(projectId, db);
  const hyp = active ?? hypotheticalBrownfieldScope(projectId, db);
  if (!hyp) {
    return {
      project_id: projectId,
      eligible: false,
      reason: info.scope_key
        ? "작업 범위 오버레이를 읽을 수 없습니다."
        : "이 세부 유형(인수합병 기준 열 또는 세부 유형 없음)은 작업 범위가 바뀌지 않습니다.",
      overlay_version: null,
      before,
      after: { ...before, workspace_judgeable: 0, excluded: 0 },
      moves_to_previous_scope: [],
      fails_stay_unmet: [],
      records_subtrack_pin: false,
    };
  }
  const after = scopedCompletionSummary(projectId, bfScopedInput(hyp));
  const moved = brownfieldPreviousScope(hyp);
  return {
    project_id: projectId,
    eligible: !active,
    reason: active ? "이미 새 작업 범위가 적용된 프로젝트입니다." : null,
    overlay_version: hyp.overlay_version,
    before,
    after: {
      judged: scopedCount(after.judged),
      judgeable: scopedCount(after.judgeable),
      workspace_judgeable: scopedCount(after.workspace_judgeable),
      excluded: scopedCount(after.excluded),
      pending: after.pending,
      unassessed: after.unassessed,
      mandatory_unmet: after.mandatoryUnmet,
    },
    moves_to_previous_scope: moved,
    fails_stay_unmet: moved.filter((m) => m.stays_unmet),
    records_subtrack_pin: false,
    extras_attached_by_opt_in: hyp.extra_checklists
      .filter((c) => !subTrackChecklistIds(projectId).includes(c))
      .map((c) => {
        const judgeable = brownfieldExtraItems(hyp, c).length;
        return { checklist_id: c, judgeable, excluded: (getChecklistItems(c)?.length ?? 0) - judgeable };
      }),
  };
}

// ── Aggregate read surface (GET /api/projects/[id]/dd) ─────────────────────

export interface DdWorkspaceView {
  domains: Array<{
    /** DdDomain for the shared tabs; the checklist id for Wave F-8 sub-track tabs. */
    domain: string;
    checklistId: string;
    title: string;
    /** `scope` is present only for greenfield projects in the workspace scope (ADR-0160 addendum b). */
    items: Array<ChecklistItemDef & { state: DdItemState | null; scope?: WorkspaceItemScope }>;
    custom: CustomItemRow[];
    /**
     * ADR-0148 §6B: false for the four newer domains of a project created before
     * DD_UNASSESSED_COUNTED_FROM — judgeable and persisted, but not in the completion count.
     * Absent on sub-track extra tabs (always counted).
     */
    counted?: boolean;
    counted_reason?: string;
  }>;
  findings: FindingRow[];
  completion: DdCompletionSummary;
  /** ADR-0157: the scope this payload describes — null = the selected/legacy scope that the gate judges. */
  scope_target_id: string | null;
  /** ADR-0160: present only for greenfield projects; `workspace_scope` only when the addendum (b) scope is active. */
  greenfield_scope?: GreenfieldSelection & { workspace_scope?: WorkspaceScopeView };
  /** ADR-0162: present only for brownfield non-baseline sub-tracks in the new workspace scope. */
  brownfield_scope?: { sub_track: string; workspace_scope: BrownfieldWorkspaceScopeView };
  /** The target the dd gate judges (the S8 selection), if any. */
  selected_target_id: string | null;
  /** One entry per shortlisted target (brownfield only; empty otherwise). */
  targets: DdTargetSummary[];
}

export interface DdItemState {
  status: ChecklistStateStatus;
  note: string | null;
  evidence_ref: string | null;
  waiver_id: string | null;
  assessed_by: string | null;
  assessed_at: string | null;
  /** ADR-0186 D4: true when the state is the validator engine's read-only verdict (bf-01), not a hand-set judgement. */
  derived?: boolean;
}

export interface CustomItemRow {
  id: string;
  domain: DdDomain;
  item_label: string;
  rationale: string | null;
  source_url: string | null;
  source_reliability: "A" | "B" | "C" | null;
  proposed_by_agent: string | null;
  status: "proposed" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  /** Human proposer (display name, else account id) from the dd_custom_item.create audit entry; null for agent or unknown proposals. */
  proposed_by_user: string | null;
  /** True when the calling user proposed this item (they cannot review it). */
  is_proposer: boolean;
  state: DdItemState | null;
}

export interface FindingRow {
  id: string;
  category: string;
  description: string;
  value_impact: number | null;
  assumption_key: string | null;
  evidence_ref: string | null;
  created_at: string;
}

/** Assemble the whole S9 surface: standard items + live state, custom items with provenance, findings, completion. */
export function listDdWorkspace(
  projectId: string,
  opts: { targetId?: string | null; viewerId?: string | null } = {},
): DdWorkspaceView {
  const db = getDb();
  const targetId = opts.targetId ?? null;
  const states = new Map<string, DdItemState>();
  for (const s of db
    .query(
      "SELECT checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at FROM project_checklist_item_state WHERE project_id = ? AND target_id IS ?",
    )
    .all(projectId, targetId) as Array<{
    checklist_id: string;
    item_id: string;
    status: ChecklistStateStatus;
    note: string | null;
    evidence_ref: string | null;
    waiver_id: string | null;
    assessed_by: string | null;
    assessed_at: string | null;
  }>) {
    states.set(`${s.checklist_id}:${s.item_id}`, {
      status: s.status,
      note: s.note,
      evidence_ref: s.evidence_ref,
      waiver_id: s.waiver_id,
      assessed_by: s.assessed_by,
      assessed_at: s.assessed_at,
    });
  }
  // ADR-0186 D4: bf-01 is the validator engine's read-only verdict (gate scope only).
  const derivedValidators = targetId === null ? derivedBf01(projectId, db) : null;
  if (derivedValidators) {
    states.set(`${BF_FEASIBILITY_CHECKLIST_ID}:${BF_VALIDATORS_ITEM_ID}`, {
      status: derivedValidators.status,
      note: derivedValidators.note,
      evidence_ref: null,
      waiver_id: null,
      assessed_by: "validator-engine",
      assessed_at: derivedValidators.evaluated_at,
      derived: true,
    });
  }

  const customByDomain = new Map<DdDomain, CustomItemRow[]>();
  for (const c of db
    .query(
      `SELECT id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at
       FROM project_checklist_item_custom WHERE project_id = ? AND target_id IS ? ORDER BY created_at, id`,
    )
    .all(projectId, targetId) as Array<Omit<CustomItemRow, "state" | "proposed_by_user" | "is_proposer">>) {
    const proposer = c.proposed_by_agent === null ? ddCustomItemProposer(projectId, c.id) : null;
    const human = proposer !== null && !AGENT_KEYS.has(proposer) ? proposer : null;
    const name = human
      ? (
          db.query("SELECT display_name FROM app_user WHERE user_id = ?").get(human) as {
            display_name: string | null;
          } | null
        )?.display_name?.trim() || human
      : null;
    const row: CustomItemRow = {
      ...c,
      proposed_by_user: name,
      is_proposer: human !== null && !!opts.viewerId && opts.viewerId === human,
      state: states.get(`${customChecklistId(c.domain)}:${c.id}`) ?? null,
    };
    const list = customByDomain.get(c.domain) ?? [];
    list.push(row);
    customByDomain.set(c.domain, list);
  }

  const findings = db
    .query(
      `SELECT id, category, description, value_impact, assumption_key, evidence_ref, created_at
       FROM dd_finding WHERE project_id = ? AND target_id IS ? ORDER BY created_at DESC, id`,
    )
    .all(projectId, targetId) as unknown as FindingRow[];

  // §4 payload: the seven domains carry the Korean titles (UI tabs, payload and reports agree) —
  // constants live in ko-data-values.ts; display rendering resolves common.ddDomain.* instead.
  const domainLabels: Record<DdDomain, string> = {
    commercial: KO_DATA.ddDomainCommercial,
    technical: KO_DATA.ddDomainTechnical,
    legal: KO_DATA.ddDomainLegal,
    financial: KO_DATA.ddDomainFinancial,
    hr: KO_DATA.ddDomainHr,
    market: KO_DATA.ddDomainMarket,
    financing: KO_DATA.ddDomainFinancing,
  };
  const countsNewDomains = newerDomainsCounted(projectId);
  const gfScope = greenfieldSelection(projectId, db);
  // ADR-0160 addendum (b): the gate scope only (target_id NULL); comparison targets are brownfield.
  const wsView = gfScope && targetId === null ? workspaceScopeView(projectId, gfScope) : null;
  // ADR-0162: brownfield gate scope only; comparison targets keep today's payload.
  const bfCtx = !gfScope && targetId === null ? brownfieldScopeContext(projectId, db) : null;
  const bfView = bfCtx ? brownfieldViewOf(projectId, bfCtx) : null;
  const itemScopes = wsView?.items ?? bfView?.items;
  const domains = DD_DOMAINS.map((domain) => {
    const checklistId = DD_WORKSPACE_CHECKLISTS[domain];
    const items = (getChecklistItems(checklistId) ?? []).map((i) => {
      const scope = itemScopes?.[`${checklistId}:${i.id}`];
      return { ...i, state: states.get(`${checklistId}:${i.id}`) ?? null, ...(scope ? { scope } : {}) };
    });
    const counted =
      !(isGrandfatheredDomain(domain) && !countsNewDomains) || (!!wsView && GF_SCOPE_COUNTED_NEW_DOMAINS.has(domain));
    return {
      domain,
      checklistId,
      title: domainLabels[domain],
      items,
      custom: customByDomain.get(domain) ?? [],
      counted,
      ...(counted ? {} : { counted_reason: DD_NOT_COUNTED_REASON }),
    };
  });

  // Wave F-8 (audit B1): sub-track-specific checklists appended as extra tabs.
  // INTERIM-WORDING: Korean tab titles (no glossary term exists for pre-signing).
  const SUB_TRACK_TITLES: Record<string, string> = {
    "chk-brownfield-feasibility-checklist": "M&A 6대 검증 체크리스트", // same wording as lib/brownfield-dd-view.ts
    "chk-ma-special-topics-checklist": "M&A 특수 주제",
    "chk-partnership-checklist": "전략 제휴 점검", // glossary Partnership.ko
    "chk-deal-shape-presigning-checklist": "체결 전 딜 구조 점검", // INTERIM-WORDING
    "chk-rbd-technology-checklist": "R&BD 기술",
    "chk-entity-formation-checklist": "법인 설립 준비 (계획 검증)",
    "chk-business-unit-formation-checklist": "사업부 신설 준비 (계획 검증)", // INTERIM-WORDING
  };
  const extra = subTrackChecklistIds(projectId).map((checklistId) => ({
    domain: checklistId,
    checklistId,
    title: SUB_TRACK_TITLES[checklistId] ?? checklistId,
    // Brownfield in scope: every item listed with its scope (excluded sections carry N + reason).
    items: bfView
      ? (getChecklistItems(checklistId) ?? []).map((i) => {
          const scope = bfView.items[`${checklistId}:${i.id}`];
          return { ...i, state: states.get(`${checklistId}:${i.id}`) ?? null, ...(scope ? { scope } : {}) };
        })
      : (scopedChecklistItems(checklistId) ?? []).map((i) => ({
          ...i,
          state: states.get(`${checklistId}:${i.id}`) ?? null,
        })),
    custom: [] as CustomItemRow[],
  }));
  return {
    domains: [...domains, ...extra],
    findings,
    completion: ddCompletionSummary(projectId, { targetId }),
    scope_target_id: targetId,
    selected_target_id: selectedTargetId(projectId, db),
    targets: listDdTargetSummaries(projectId),
    // ADR-0160: greenfield only (brownfield payload unchanged) — sub-track,
    // site scope, excluded steps and warnings for the excluded-by-rule panel.
    ...(gfScope ? { greenfield_scope: { ...gfScope, ...(wsView ? { workspace_scope: wsView } : {}) } } : {}),
    ...(bfCtx && bfView ? { brownfield_scope: { sub_track: bfCtx.sub_track, workspace_scope: bfView } } : {}),
  };
}

/**
 * ADR-0157: one summary row per shortlisted target — the comparison-table
 * source. The selected target's row is the gate scope (target_id IS NULL);
 * every other row is comparison evidence, never a verdict.
 */
export function listDdTargetSummaries(projectId: string): DdTargetSummary[] {
  const db = getDb();
  const project = db.query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as
    | { track: string | null; source_opportunity_id: string | null }
    | undefined;
  if (project?.track !== "brownfield") return [];
  const selected = selectedTargetId(projectId, db);
  const targets = db
    .query(
      `SELECT bt.id, bt.company_name FROM brownfield_target bt
       WHERE bt.opportunity_id = ? AND bt.status = 'shortlisted'
       ORDER BY bt.rank IS NULL, bt.rank, bt.created_at`,
    )
    .all(project.source_opportunity_id ?? "") as Array<{ id: string; company_name: string }>;
  const opens = new Map(
    (
      db
        .query("SELECT target_id, opened_at, opened_by, rationale FROM dd_target_open WHERE project_id = ?")
        .all(projectId) as Array<{ target_id: string; opened_at: string; opened_by: string; rationale: string }>
    ).map((o) => [o.target_id, o]),
  );
  const out: DdTargetSummary[] = [];
  for (const t of targets) {
    const isSelected = t.id === selected;
    const open = opens.get(t.id);
    const opened = isSelected || !!open;
    const scope = isSelected ? null : t.id;
    const c = opened
      ? ddCompletionSummary(projectId, { targetId: scope })
      : { total: 0, pending: 0, unassessed: 0, mandatoryUnmet: 0 };
    const f = opened
      ? (db
          .query(
            "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN value_impact IS NOT NULL THEN 1 ELSE 0 END), 0) AS v FROM dd_finding WHERE project_id = ? AND target_id IS ?",
          )
          .get(projectId, scope) as { n: number; v: number })
      : { n: 0, v: 0 };
    out.push({
      target_id: t.id,
      name: t.company_name,
      is_selected: isSelected,
      opened,
      opened_at: open?.opened_at ?? null,
      opened_by: open?.opened_by ?? null,
      rationale: open?.rationale ?? null,
      total: c.total,
      unassessed: c.unassessed,
      pending: c.pending,
      mandatory_unmet: c.mandatoryUnmet,
      findings: f.n,
      findings_with_value_impact: f.v,
    });
  }
  return out;
}
