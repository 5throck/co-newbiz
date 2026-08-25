// Port of app/server/deal-review.ts GET /api/projects/:id/permits
// criticalPath() ported verbatim (Kahn's algorithm + one relaxation pass) —
// see the Hono original for the full algorithm-choice explanation.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

function criticalPath(
  nodes: readonly { id: string; statutory_days: number | null }[],
  edges: readonly { from: string; to: string }[],
): string[] {
  const days = new Map(nodes.map((n) => [n.id, n.statutory_days ?? 0]));
  const succs = new Map<string, string[]>([...days.keys()].map((id) => [id, [] as string[]]));
  const preds = new Map<string, string[]>([...days.keys()].map((id) => [id, [] as string[]]));
  const inDeg = new Map<string, number>([...days.keys()].map((id) => [id, 0]));
  for (const e of edges) {
    if (!days.has(e.from) || !days.has(e.to)) continue;
    succs.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
    inDeg.set(e.to, inDeg.get(e.to)! + 1);
  }
  const order: string[] = [];
  const queue = [...inDeg.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of succs.get(u)!) {
      inDeg.set(v, inDeg.get(v)! - 1);
      if (inDeg.get(v) === 0) queue.push(v);
    }
  }
  const best = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const v of order) {
    let b = days.get(v)!;
    let p: string | null = null;
    for (const u of preds.get(v)!) {
      const candidate = best.get(u)! + days.get(v)!;
      if (candidate > b) {
        b = candidate;
        p = u;
      }
    }
    best.set(v, b);
    prev.set(v, p);
  }
  let end: string | null = null;
  let endBest = -1;
  for (const [id, b] of best) {
    if (b > endBest) {
      endBest = b;
      end = id;
    }
  }
  const path: string[] = [];
  for (let cur = end; cur !== null; cur = prev.get(cur) ?? null) path.push(cur);
  return path.reverse();
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const db = getDb();
  const permits = db
    .query("SELECT id, name, agency, statutory_days, status FROM permit WHERE project_id = ? ORDER BY name")
    .all(project.id) as { id: string; statutory_days: number | null }[];
  const certifications = db
    .query("SELECT id, name, agency, statutory_days, status FROM certification WHERE project_id = ? ORDER BY name")
    .all(project.id) as { id: string; statutory_days: number | null }[];
  const data: Record<string, unknown> = { permits, certifications };
  const url = new URL(request.url);
  if (["1", "true"].includes(url.searchParams.get("include_dag") ?? "")) {
    const permitEdges = (
      db
        .query(
          `SELECT pe.from_permit_id, pe.to_permit_id FROM permit_edge pe
           JOIN permit p ON p.id = pe.from_permit_id WHERE p.project_id = ?`,
        )
        .all(project.id) as { from_permit_id: string; to_permit_id: string }[]
    ).map((e) => ({ from: e.from_permit_id, to: e.to_permit_id }));
    const certificationEdges = (
      db
        .query(
          `SELECT ce.from_certification_id, ce.to_certification_id FROM certification_edge ce
           JOIN certification cr ON cr.id = ce.from_certification_id WHERE cr.project_id = ?`,
        )
        .all(project.id) as { from_certification_id: string; to_certification_id: string }[]
    ).map((e) => ({ from: e.from_certification_id, to: e.to_certification_id }));
    data.dag = {
      permit_edges: permitEdges,
      permit_critical_path: criticalPath(permits, permitEdges),
      certification_edges: certificationEdges,
      certification_critical_path: criticalPath(certifications, certificationEdges),
    };
  }
  return ok(data, 200, { permit_count: permits.length, certification_count: certifications.length });
}
