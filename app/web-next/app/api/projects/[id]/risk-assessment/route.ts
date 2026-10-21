// GET/PUT /api/projects/[id]/risk-assessment — the person's likelihood/impact
// assessment for the S9 risk heatmap (2026-10-19 decider question: the
// auto-derived heatmap had hardcoded likelihood). GET returns the latest
// assessment per item (with mitigation) plus the append-only history; PUT
// records one assessment (analyst+ person-only, audited — boundary #2) as a
// new ledger row (migration 0160, ADR-0122 #2 "risk ledger"; the 0156 sidecar
// was folded into the ledger by 0164). The auto-derived values remain the
// default display when no assessment exists.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  latestRiskAssessments,
  recordRiskAssessment,
  riskAssessmentHistory,
  validateRiskAssessmentInput,
  RiskAssessmentValidationError,
} from "../../../../../lib/risk-assessment.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? undefined;
  return ok({ overrides: latestRiskAssessments(db, id), history: riskAssessmentHistory(db, id, key) }, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "리스크 판정 기록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { key?: unknown; likelihood?: unknown; impact?: unknown; mitigation?: unknown } | null;
  try {
    const v = validateRiskAssessmentInput({ key: body?.key, likelihood: body?.likelihood, impact: body?.impact, mitigation: body?.mitigation });
    const rec = recordRiskAssessment(getDb(), { projectId: id, key: v.key, likelihood: v.likelihood, impact: v.impact, mitigation: v.mitigation, by: auth.auth.userId });
    return ok({ id: rec.id, key: v.key, likelihood: v.likelihood, impact: v.impact, mitigation: v.mitigation, recorded_at: rec.at }, 201);
  } catch (err) {
    if (err instanceof RiskAssessmentValidationError) return badRequest("invalid_request", err.message);
    console.error("risk-assessment PUT failed", err);
    return fail(500, "internal_error", "리스크 판정 저장에 실패했습니다.");
  }
}
