// GET /api/projects/[id]/ic-package — the S11 IC package, read-only (ADR-0100
// §2). The package the Entity/Group IC committees read: the adopted business
// case with its valuation simulations (0068), the DD summary (applied
// checklist completion + findings), the AI-PROPOSED RAG grade (explicitly
// labeled a proposal — boundary #2, with the data-confidence cap that bounds
// it, boundary #4), the entity_ic/group_ic gate history, and the
// establishment progress (0070 project key). This route never writes a gate
// record (those stay human authority — no POST/PUT here at all). The ONE write
// it may make is the lazy RAG recompute (Wave F-5): when the persisted inputs
// changed since the last web assessment it appends rag_assessment rows — a
// derived AI PROPOSAL, performed as the calling user (boundary #1).
// Deny-by-default: getProjectIfVisible via visibleProject — non-members get
// 404 (FR-SEC-01); admins are excluded by role separation.
import { previewGateSnapshot } from "../../../../../lib/gate-snapshot.ts";
import { reconfirmNotice } from "../../../../../lib/reconfirm.ts";
import { waccStatusView } from "../../../../../lib/wacc-status.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { readRagView, recomputeRag } from "../../../../../../../db/lib/rag-service.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { findAdoptedCase, listBusinessCases, type BusinessCaseView } from "../../../../../lib/business-case.ts";
import { establishmentProgress, listEstablishmentSteps, reopenedAfterGate } from "../../../../../lib/establishment.ts";
import { icStandingRisks } from "../../../../../lib/establishment-mode-view.ts";
import { icGoGapItems, parseRationale } from "../../../../../lib/ic-gap-override.ts";
import {
  latestGateDecisions,
  latestRouteDecision,
  type GateId,
  type GateVerdict,
} from "../../../../../lib/process-flow.ts";
import { latestPmiKickoff, pmiKickoffApplies } from "../../../../../lib/pmi-kickoff.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import {
  ddCompletionSummary,
  listDdWorkspace,
  type DdCompletionSummary,
  type FindingRow,
} from "../../../../../lib/dd-checklist-tailor.ts";
import { draftAiSummary } from "../../../../../lib/checklist-review-status.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { buildRiskHeatmap, heatmapSnapshot } from "../../../../../lib/risk-heatmap.ts";
import { covenantHeadroom } from "../../../../../lib/covenant-headroom.ts";
import { icReviewStepsView } from "../../../../../lib/ic-review-steps.ts";
import { getHypotheses } from "../../../../../../../db/repositories/deal-structure-hypothesis.repository.ts";
import {
  financingCertainty,
  financingTotals,
  listFinancingEntries,
} from "../../../../../../../db/repositories/financing-plan.repository.ts";
import { countersignState } from "../../../../../../../db/lib/gate-effective.ts";
import { listConditions } from "../../../../../../../db/repositories/condition-precedent.repository.ts";

const IC_GATES: GateId[] = ["entity_ic", "group_ic"];
const TOP_FINDINGS = 10;

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();

  // Business case — the human ADOPTED case only feeds the committees; when
  // nothing is adopted yet the package says so rather than substituting a case.
  const list = listBusinessCases(id);
  const { cases, adoption } = list;
  // ADR-0158: an archived legacy model that a human adopted still resolves here.
  const adoptedCase: BusinessCaseView | null = findAdoptedCase(list);

  // Committee deliberation refs (ADR-0104, ADR-0196 Phase E) — sessions
  // convened for this project give the IC the deliberation provenance. Both
  // the opportunity- and project-scoped minutes surfaces link (the
  // project-scoped one lives at /api/projects/[id]/committee-sessions).
  // Read-only — no minutes content is copied here, so dissent is never
  // duplicated.
  const sourceOpportunityId =
    (
      db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(id) as
        | { source_opportunity_id: string | null }
        | undefined
    )?.source_opportunity_id ?? null;
  const committeeSessions = db
    .query(
      `SELECT pr.id AS sessionId, pr.entity_type AS entityType, pr.entity_id AS entityId,
              pr.stage, pr.status, pr.started_at,
              JSON_EXTRACT(pr.meta_json, '$.committee_key') AS committeeKey,
              JSON_EXTRACT(pr.meta_json, '$.decision_mode') AS decisionMode,
              JSON_EXTRACT(pr.meta_json, '$.minutes_confirmed_by') AS minutesConfirmedBy
       FROM process_run pr
       WHERE (pr.entity_type = 'project' AND pr.entity_id = ?
              OR pr.entity_type = 'opportunity' AND ? IS NOT NULL AND pr.entity_id = ?)
         AND pr.meta_json LIKE '%"committee_key"%'
       ORDER BY pr.started_at DESC LIMIT 10`,
    )
    .all(id, sourceOpportunityId, sourceOpportunityId) as Array<{
    sessionId: string;
    entityType: string;
    entityId: string;
    stage: string | null;
    status: string;
    started_at: string | null;
    committeeKey: string | null;
    decisionMode: string | null;
    minutesConfirmedBy: string | null;
  }>;

  // DD summary — completion counts + top findings (IC needs the risk surface,
  // not the full checklist; the S9 workspace route is the full read).
  const completion: DdCompletionSummary = ddCompletionSummary(id);
  const findings = db
    .query(
      `SELECT id, category, description, value_impact, assumption_key, evidence_ref, created_at
       FROM dd_finding WHERE project_id = ? AND target_id IS NULL ORDER BY created_at DESC, id LIMIT ?`,
    )
    .all(id, TOP_FINDINGS) as unknown as FindingRow[];

  // RAG — the AI-proposed overall grade, labeled a proposal, with the
  // data_confidence grade that caps it (boundary #4: a capped estimate can
  // never read as Green regardless of the financials). Recomputed lazily when
  // the persisted inputs changed (stale read); an incomplete assessment has NO
  // overall grade and is reported "not_graded" — never a default color.
  try {
    recomputeRag(db, id, "ic_package", { actor: auth.auth.userId });
  } catch (err) {
    console.error(`ic-package: rag recompute failed for ${id}: ${(err as Error).message}`);
  }
  const rag = readRagView(db, id);
  const overall = rag.overall;
  const confidence = rag.dimensions.data_confidence;

  // Gate history — entity_ic and group_ic on the project entity only.
  const latest = latestGateDecisions("project", id);
  const history = db
    .query(
      `SELECT id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at
       FROM gate_decision
       WHERE entity_type = 'project' AND entity_id = ? AND gate IN ('entity_ic', 'group_ic')
       ORDER BY decided_at DESC, id DESC`,
    )
    .all(id) as Array<{
    id: string;
    gate: string;
    decision: string;
    rationale: string;
    missing_artifacts_json: string | null;
    decided_by: string;
    decided_at: string;
  }>;

  // ADR-0193 (risk-officer E): carried kill criteria that were evaluated but are still unassessed (closure "open"), and the S12
  // criteria that stay open_monitoring, are listed BY NAME for the committee. Read-only (the preview runs in a rolled-back
  // transaction); a failure degrades to null, never to an empty-looking list.
  let killCarries: {
    gate: string;
    open: Array<Record<string, unknown>>;
    open_monitoring: Array<Record<string, unknown>>;
  } | null = null;
  try {
    const icGate = latest.get("entity_ic")?.decision === "go" ? "group_ic" : "entity_ic";
    const { snapshot } = previewGateSnapshot({
      entityType: "project",
      entityId: id,
      gate: icGate,
      actor: auth.auth.userId,
      db,
    });
    const pick = (c: (typeof snapshot.kill.carried_in)[number]) => ({
      key: c.key,
      title: c.title,
      action: c.action,
      outcome: c.outcome,
      closure: c.closure,
      reason: c.reason,
      evaluable_from: c.evaluable_from,
      reevaluate_at: c.reevaluate_at,
      from_decision_id: c.from_decision_id,
    });
    killCarries = {
      gate: icGate,
      open: snapshot.kill.carried_in.filter((c) => c.closure === "open").map(pick),
      open_monitoring: snapshot.kill.carried_in.filter((c) => c.closure === "open_monitoring").map(pick),
    };
  } catch (err) {
    console.error(`ic-package: kill carries unavailable for ${id}: ${(err as Error).message}`);
  }

  return ok(
    {
      project: { id: project.id, project_no: project.project_no },
      // ADR-0193: carried kill criteria still open at the IC gate, listed by name; null = could not be computed (not "none").
      kill_carries: killCarries,
      // ADR-0186 D8: display contract - "provisional discount rate" until subject, WACC and hurdle are user-confirmed.
      wacc_status: waccStatusView(id, db),
      // ADR-0186 O-6: non-blocking notice while the legacy record awaits re-confirmation.
      reconfirmation: reconfirmNotice(db, id),
      business_case: adoptedCase
        ? {
            adopted: adoptedCase,
            adoption,
            // ADR-0117 — the adopted variant next to its sibling perspective
            // (market_forward vs historical), so the IC sees how much the
            // growth assumption alone moves the valuation.
            comparison: cases
              .filter((c) => c.scenario === adoptedCase.scenario && c.id !== adoptedCase.id)
              .map((c) => ({
                variant: c.variant,
                name: c.name,
                p50: c.simulations.find((x) => x.percentile === "p50")?.npv_krw_m ?? null,
                p05: c.simulations.find((x) => x.percentile === "p05")?.npv_krw_m ?? null,
              })),
          }
        : {
            adopted: null,
            adoption,
            note: "채택(adopt)된 Business Case가 없습니다 — 법인 투자심의위원회 심사 전 S8 채택이 필요합니다.",
          },
      // Informational only (never gates): in-scope checklist items still draft-AI, shown in the IC "could not verify" area.
      dd: { completion, findings, finding_count: findings.length, review_status: draftAiSummary(listDdWorkspace(id)) },
      // ADR-0122 #2 — the S9 risk heatmap snapshot auto-attaches to the IC
      // package: same server builder as the heatmap page, hash-stamped so the
      // committee can tell which snapshot it read. Informational, never gates.
      risk_heatmap: heatmapSnapshot(buildRiskHeatmap(db, id)),
      // 2026-10-21 — entity-ic-review / group-investment-review step status
      // (lib/ic-review-steps). procedure_gaps are the step items that also ride
      // go_gaps (decider 2026-10-21: the GO gap-rationale contract covers them).
      ic_steps: (() => {
        const v = icReviewStepsView(db, id);
        return {
          entity: v.entity.map((s) => ({ id: s.id, output_type: s.output_type, status: s.status })),
          group: v.group.map((s) => ({ id: s.id, output_type: s.output_type, status: s.status })),
          procedure_gaps: v.gaps,
        };
      })(),
      rag: {
        status: rag.status,
        grade: overall?.grade ?? null, // null = not graded (never a default color)
        isProposal: true, // boundary #2 — AI 제안일 뿐, 승인 기록이 아니다
        rationale: overall?.rationale ?? null,
        assessed_at: overall?.assessed_at ?? rag.assessed_at,
        missing_dimensions: rag.missing_dimensions,
        confidence_cap: confidence?.grade ?? null,
        confidence_note: confidence
          ? `데이터 신뢰도 등급(${confidence.grade})이 전체 등급 상한을 규정합니다 — 2-hop 프록시 추정은 재무가 좋아도 Green일 수 없습니다.`
          : null,
      },
      gates: {
        latest: IC_GATES.map((g) => {
          const v = latest.get(g);
          const parsed = v ? parseRationale(v.rationale) : null;
          // ADR-0186 D6: `decision` is the EFFECTIVE verdict (an IC GO awaiting its countersign reads `pending` under maker_checker = enforce); recorded_decision is what was recorded.
          return {
            gate: g,
            decision: (v?.decision ?? null) as GateVerdict | null,
            recorded_decision: (v?.rawDecision ?? null) as GateVerdict | null,
            awaiting_countersign: v?.awaitingCountersign ?? false,
            countersign_state: v?.countersign ?? null,
            rationale: parsed?.rationale ?? null,
            gap_override: parsed?.gap_override ?? null,
            missing_artifacts: v?.missing ?? null,
          };
        }),
        history: history.map((h) => ({
          ...h,
          ...parseRationale(h.rationale),
          countersign_state: countersignState(db, id, h),
        })),
        // ADR-0186 D4: every condition precedent of the IC decisions (open ones first); the committee sees what is still owed.
        conditions: listConditions(id, { db }).sort((a, b) =>
          a.status === b.status
            ? a.created_at < b.created_at
              ? -1
              : 1
            : a.status === "open"
              ? -1
              : b.status === "open"
                ? 1
                : 0,
        ),
        conditions_open: listConditions(id, { status: "open", db }).length,
        // What an IC GO would be missing right now - the screen warns and asks for a rationale (R2-B item 3).
        go_gaps: icGoGapItems(id),
      },
      deal_structure: (() => {
        // S10 투자구조 설계 산출물 (flow.spec v2.2.0) — 최신 가설의 4축 검토
        // 상태와 sources & uses 균형을 IC가 그대로 본다.
        const hypotheses = getHypotheses(id, db);
        const latestHypothesis = hypotheses[0] ?? null;
        const totals = financingTotals(id, db);
        return {
          latest_hypothesis: latestHypothesis,
          hypothesis_count: hypotheses.length,
          four_axis_review_completed: latestHypothesis?.four_axis_review_completed === 1,
          financing: { entries: listFinancingEntries(id, db), totals, certainty: financingCertainty(id, db) },
          balanced: totals.balanced,
          // S10 financing-plan output "커버넌트 여력" (fin-03) — latest simulation's covenant headroom.
          covenant_headroom: covenantHeadroom(db, id),
        };
      })(),
      // S11 PMI kickoff (Wave F-6) — brownfield M&A/JV/strategic only.
      pmi_kickoff: (() => {
        const p = db.query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?").get(id) as
          | { track: string | null; source_opportunity_id: string | null }
          | undefined;
        const sub = p?.source_opportunity_id ? (latestRouteDecision(p.source_opportunity_id)?.sub_track ?? null) : null;
        return { applies: pmiKickoffApplies(p?.track ?? null, sub), sub_track: sub, record: latestPmiKickoff(db, id) };
      })(),
      // ADR-0167 (D8): standing risk lines tied to the establishment mode; informational, never a gate.
      standing_risks: icStandingRisks(establishmentProgress(id).mode),
      // ADR-0196 Phase C (M6) — committee session refs with minutes link +
      // confirmation state. No minutes content is copied (dissent is never
      // duplicated); the link is exposed only for opportunity-scoped sessions.
      committee_sessions: committeeSessions.map((r) => ({
        sessionId: r.sessionId,
        stage: r.stage,
        status: r.status,
        startedAt: r.started_at,
        committeeKey: r.committeeKey,
        decisionMode: r.decisionMode,
        minutesUrl: r.entityId
          ? r.entityType === "opportunity"
            ? `/api/opportunities/${encodeURIComponent(r.entityId)}/committee-sessions/${encodeURIComponent(r.sessionId)}/minutes`
            : `/api/projects/${encodeURIComponent(r.entityId)}/committee-sessions/${encodeURIComponent(r.sessionId)}/minutes`
          : null,
        minutesConfirmed: r.minutesConfirmedBy != null,
      })),
      establishment: (() => {
        const steps = listEstablishmentSteps(id);
        const progress = establishmentProgress(id);
        return {
          mode: progress.mode,
          steps,
          done: progress.done,
          total: 5,
          complete: progress.complete,
          progress: `${progress.done}/5`,
          ...reopenedAfterGate(id),
        };
      })(),
    },
    200,
    { gate_count: history.length },
  );
});
