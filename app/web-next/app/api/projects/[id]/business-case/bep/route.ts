// GET /api/projects/[id]/business-case/bep — 재무분석 탭 (BEP Analysis · 연도별
// 재무 명세, 2026-10-19 decider ask). Read-only compute from the SAME case inputs
// the generator uses — nothing is persisted, no gate impact. Returns per-scenario
// year tables (매출·인건비·운영비·설비투자·순현금흐름·누적 할인 FCF) plus the BEP
// summary (회수 연도, 계획 고정비가 있는 해의 손익분기 매출).
//
// Greenfield: project-level inputs with the S5 plan (`s5_plan` basis).
// Brownfield (2026-10-19 decider direction): an M&A case is priced differently —
// the year-0 outflow is the ACQUISITION EV (target revenue × EV/Revenue), the
// revenue anchor is the TARGET's latest annual revenue, and the exit value reuses
// the entry multiple. Those live in `caseInputsForTarget`, so the route resolves
// the subject target (the project's selected company, else the rank-1 shortlist
// target) instead of silently computing a greenfield-shaped market-capture case.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import {
  caseInputsForProject,
  caseInputsForTarget,
  deterministicCaseYearTable,
  listShortlistSubjects,
} from "../../../../../../lib/business-case-generator.ts";
import { ok, notFound } from "../../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (!visibleProject(auth.auth, (await params).id)) return notFound();
  const db = getDb();
  const project = db
    .query("SELECT id, track, company_id, source_opportunity_id FROM md_project WHERE id = ?")
    .get((await params).id) as
    | { id: string; track: string | null; company_id: string | null; source_opportunity_id: string | null }
    | undefined;
  if (!project) return notFound();

  // Brownfield: resolve the analysis subject. The project's selected company wins;
  // otherwise the rank-1 shortlist target (the same ordering the target list uses).
  // No shortlist target → the project-level (market-capture) inputs, labelled.
  let inputs = caseInputsForProject((await params).id);
  let subject: { id: string; name: string } | null = null;
  if (project.track === "brownfield" && project.source_opportunity_id) {
    const subjects = listShortlistSubjects(db, project.source_opportunity_id);
    const picked =
      (project.company_id ? subjects.find((t) => t.companyId === project.company_id) : undefined) ?? subjects[0];
    if (picked) {
      inputs = caseInputsForTarget((await params).id, { id: picked.id, companyId: picked.companyId }, inputs);
      subject = { id: picked.id, name: picked.name };
    }
  }

  const scenarios = ["base", "downside", "upside"] as const;
  return ok({
    wacc: inputs.wacc,
    // Pricing semantics for the panel: an acquisition-priced case shows 인수가격(EV),
    // not a build-out 초기 투자.
    acquisition: inputs.acquisition
      ? { evRevenue: inputs.acquisition.evRevenue, source: inputs.acquisition.source }
      : null,
    subject,
    scenarios: Object.fromEntries(scenarios.map((s) => [s, deterministicCaseYearTable(inputs, s)])),
  }, 200);
}
