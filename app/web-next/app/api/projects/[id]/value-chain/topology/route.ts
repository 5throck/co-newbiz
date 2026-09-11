// GET /api/projects/[id]/value-chain/topology — Kahn layering over the
// project's value_chain_link rows (the endpoint the
// value-chain-stage-financials skill has referenced since it was written).
// Cycles throw in the topology lib and surface as 400.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { resolveChainTopology } from "../../../../../../../../db/lib/value-chain-topology.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  try {
    const topology = resolveChainTopology(getDb(), id);
    return ok(topology, 200, { layer_count: topology.layers?.length ?? 0 });
  } catch (err) {
    return badRequest("topology_failed", err instanceof Error ? err.message : "토폴로지 해석에 실패했습니다.");
  }
}
