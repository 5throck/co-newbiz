// Port of app/server/market.ts GET /api/projects/:id/value-chain/topology
import { resolveChainTopology } from "../../../../../../../../db/lib/value-chain-topology.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  try {
    const topology = resolveChainTopology(getDb(), project.id);
    return ok(topology, 200, { layer_count: topology.layers.length });
  } catch (err) {
    return badRequest("topology_cycle", err instanceof Error ? err.message : "Chain topology failed.");
  }
}
