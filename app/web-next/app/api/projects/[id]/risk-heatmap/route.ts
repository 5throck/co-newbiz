// GET /api/projects/[id]/risk-heatmap — the S9 deal risk heatmap (ADR-0122
// #2) built server-side from dd_finding, contract_coc, incentive and the
// covenant headroom of the latest simulation, with the person's latest
// assessment applied per item. The same builder feeds the IC package and the
// monitoring brief, so what the page shows is what the committees get.
// Read-only; members only (FR-SEC-01).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { buildRiskHeatmap } from "../../../../../lib/risk-heatmap.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const heatmap = buildRiskHeatmap(getDb(), id);
  return ok(heatmap, 200, { count: heatmap.items.length });
});
