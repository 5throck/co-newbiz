// GET /api/projects/[id]/business-case/bep — 재무분석 탭 (BEP Analysis · 연도별
// 재무 명세, 2026-10-19 decider ask). Read-only compute from the SAME case inputs
// the generator uses (caseInputsForProject) — nothing is persisted, no gate
// impact. Returns per-scenario year tables (매출·운영비·설비투자·순현금흐름·누적
// 할인 FCF) plus BEP 요약 (회수 연도, 계획 고정비가 있는 해의 손익분기 매출).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { caseInputsForProject, deterministicCaseYearTable } from "../../../../../../lib/business-case-generator.ts";
import { ok, notFound } from "../../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (!visibleProject(auth.auth, (await params).id)) return notFound();
  const db = getDb();
  if (!db.query("SELECT id FROM md_project WHERE id = ?").get((await params).id)) return notFound();
  const inputs = caseInputsForProject((await params).id);
  const scenarios = ["base", "downside", "upside"] as const;
  return ok({
    wacc: inputs.wacc,
    scenarios: Object.fromEntries(scenarios.map((s) => [s, deterministicCaseYearTable(inputs, s)])),
  }, 200);
}
