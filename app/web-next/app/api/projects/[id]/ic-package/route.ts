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
import { getDb } from "../../../../../../../db/client.ts";
import { readRagView, recomputeRag } from "../../../../../../../db/lib/rag-service.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { latestAdoption, listBusinessCases, type BusinessCaseView } from "../../../../../lib/business-case.ts";
import { establishmentProgress, listEstablishmentSteps } from "../../../../../lib/establishment.ts";
import { icGoGapItems, parseRationale } from "../../../../../lib/ic-gap-override.ts";
import { latestGateDecisions, latestRouteDecision, type GateId, type GateVerdict } from "../../../../../lib/process-flow.ts";
import { latestPmiKickoff, pmiKickoffApplies } from "../../../../../lib/pmi-kickoff.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { ddCompletionSummary, type DdCompletionSummary, type FindingRow } from "../../../../../lib/dd-checklist-tailor.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { getHypotheses } from "../../../../../../../db/repositories/deal-structure-hypothesis.repository.ts";
import { financingTotals, listFinancingEntries } from "../../../../../../../db/repositories/financing-plan.repository.ts";

const IC_GATES: GateId[] = ["entity_ic", "group_ic"];
const TOP_FINDINGS = 10;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();

  // Business case — the human ADOPTED case only feeds the committees; when
  // nothing is adopted yet the package says so rather than substituting a case.
  const { cases, adoption } = listBusinessCases(id);
  const adoptedCase: BusinessCaseView | null = cases.find((c) => c.adopted) ?? null;

  // Committee deliberation refs (ADR-0104) — sessions convened for this
  // project give the IC the deliberation provenance (minutes are one GET away).
  const committeeSessions = db
    .query(
      `SELECT pr.id AS sessionId, pr.stage, pr.status, pr.started_at,
              JSON_EXTRACT(pr.meta_json, '$.committee_key') AS committeeKey,
              JSON_EXTRACT(pr.meta_json, '$.decision_mode') AS decisionMode,
              JSON_EXTRACT(pr.meta_json, '$.minutes_confirmed_by') AS minutesConfirmedBy
       FROM process_run pr
       WHERE pr.entity_type = 'project' AND pr.entity_id = ? AND pr.meta_json LIKE '%"committee_key"%'
       ORDER BY pr.started_at DESC LIMIT 10`,
    )
    .all(id) as Array<Record<string, unknown>>;

  // DD summary — completion counts + top findings (IC needs the risk surface,
  // not the full checklist; the S9 workspace route is the full read).
  const completion: DdCompletionSummary = ddCompletionSummary(id);
  const findings = db
    .query(
      `SELECT id, category, description, value_impact, assumption_key, evidence_ref, created_at
       FROM dd_finding WHERE project_id = ? ORDER BY created_at DESC, id LIMIT ?`,
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
    .all(id) as Array<{ id: string; gate: string; decision: string; rationale: string; missing_artifacts_json: string | null; decided_by: string; decided_at: string }>;

  return ok(
    {
      project: { id: project.id, project_no: project.project_no },
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
        : { adopted: null, adoption, note: "채택(adopt)된 Business Case가 없습니다 — Entity IC 심사 전 S8 채택이 필요합니다." },
      dd: { completion, findings, finding_count: findings.length },
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
          return { gate: g, decision: (v?.decision ?? null) as GateVerdict | null, rationale: parsed?.rationale ?? null, gap_override: parsed?.gap_override ?? null, missing_artifacts: v?.missing ?? null };
        }),
        history: history.map((h) => ({ ...h, ...parseRationale(h.rationale) })),
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
          financing: { entries: listFinancingEntries(id, db), totals },
          balanced: totals.balanced,
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
      establishment: (() => {
        const steps = listEstablishmentSteps(id);
        const progress = establishmentProgress(id);
        return { steps, done: progress.done, total: 5, complete: progress.complete, progress: `${progress.done}/5` };
      })(),
    },
    200,
    { gate_count: history.length },
  );
}
