// GET /api/admin/review-audit — the "AI 검토 신뢰도" governance KPI
// (design of record §6.6, ADR-0153 §4.6): the agreement rate of human-recorded
// review_audit_sample rows, overall + per reviewer domain + per quarter.
// Read-only, admin-only. The suggested 10% sample rate is a prompt, not a
// quota; nothing here touches a decision table.
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { auditAgreementSummary } from "../../../../../../db/repositories/review-audit.repository.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const summary = auditAgreementSummary();
  const sampled = summary.overall.sampled;
  return ok({
    ...summary,
    suggested_sample_rate: 0.1,
    note:
      sampled === 0
        ? "아직 검표 표본이 없습니다 — AI 2차 검토 행에 대해 사람의 동의/비동의 검표를 기록하면 집계됩니다."
        : null,
  });
}
