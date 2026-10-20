// S12 post-management read surface (ADR-0161 Row 2). GET only, members only.
// Reports which S12 items apply (portfolio-venture-monitoring incl. case_type
// greenfield, integration-monitoring, partnership-monitoring — all
// recommended, never blocking: S12 has no gate) and the read views over the
// EXISTING ledgers (pmi_synergy_certification, pmi_key_talent, jv_term,
// venture_scorecard). Greenfield ramp-up resolves goal:<metric_key> rows to
// ADR-0159 goals as reference evidence only. No new tables, no writes.
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../db/lib/access-control.ts";
import { baselineVariance } from "../../../../../lib/baseline-variance.ts";
import {
  greenfieldRampUpView,
  integrationMonitoringView,
  partnershipMonitoringView,
  postManagementApplicability,
} from "../../../../../lib/greenfield-execution.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  try {
    requireInsiderIfMnpi(getDb(), id, auth.auth.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const applicability = postManagementApplicability(id);
  return ok(
    {
      applicability,
      greenfield_ramp_up: greenfieldRampUpView(id),
      // 2026-10-21 — flow.spec S12 output "실행 기준선 대비 차이 (greenfield)": the
      // confirmed S11 baseline vs the latest cycle's scorecard (derived, reference only).
      baseline_variance: baselineVariance(getDb(), id),
      integration_monitoring: applicability.integration_monitoring ? integrationMonitoringView(id) : null,
      partnership_monitoring: applicability.partnership_monitoring ? partnershipMonitoringView(id) : null,
    },
    200,
  );
}
