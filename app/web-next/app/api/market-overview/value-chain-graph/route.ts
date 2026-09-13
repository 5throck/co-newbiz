// 산업 간 가치사슬 관계도 — 큐레이션된 수요 산업 연계(proxy_link, ADR-0129)를
// 전체 산업 마스터 범위에서 그래프로 내려준다. S1 산업 목록 화면의 SVG
// 관계도가 이 데이터로 전방/전전방/후방/후후방 연결을 그린다.
// relation이 태깅되지 않은 레거시 행(ADR-0126)은 사람이 검토하기 전까지
// 그래프에 나타나면 안 되므로 제외한다(related-candidates와 동일한 원칙).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

interface Edge { from: string; to: string; relation: string; hopDistance: number | null }
interface Node { id: string; name_ko: string; analyzed: boolean; layer: number }

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();

  const edgeRows = db
    .query(
      `SELECT pl.from_industry_id AS from_id, pl.to_industry_id AS to_id, pl.relation, pl.hop_distance
       FROM proxy_link pl
       WHERE pl.status = 'active' AND pl.relation IS NOT NULL`,
    )
    .all() as Array<{ from_id: string; to_id: string; relation: string; hop_distance: number | null }>;

  if (edgeRows.length === 0) return ok({ nodes: [], edges: [] });

  const nodeIds = new Set<string>();
  for (const e of edgeRows) { nodeIds.add(e.from_id); nodeIds.add(e.to_id); }

  const namesRows = db
    .query(`SELECT id, name_ko FROM md_industry WHERE id IN (${[...nodeIds].map(() => "?").join(",")})`)
    .all(...nodeIds) as Array<{ id: string; name_ko: string }>;
  const nameOf = new Map(namesRows.map((r) => [r.id, r.name_ko]));

  const analyzedRows = db
    .query("SELECT DISTINCT industry_id FROM market_sizing_analysis WHERE status = 'completed'")
    .all() as Array<{ industry_id: string }>;
  const analyzedSet = new Set(analyzedRows.map((r) => r.industry_id));

  // Kahn 레이어링(from→to 방향) — 프로젝트 스코프의 value-chain-topology.ts와
  // 같은 아이디어지만, 사람이 독립적으로 등록한 연계를 전체 산업 그래프로
  // 합치면 사이클이 생길 수 있어(A→B→C→A) 사이클에서 예외를 던지지 않고
  // 남은 노드를 마지막 레이어에 몰아넣어 그래프가 항상 그려지게 한다.
  const successors = new Map<string, string[]>([...nodeIds].map((n) => [n, []]));
  const inDeg = new Map<string, number>([...nodeIds].map((n) => [n, 0]));
  for (const e of edgeRows) {
    successors.get(e.from_id)!.push(e.to_id);
    inDeg.set(e.to_id, (inDeg.get(e.to_id) ?? 0) + 1);
  }
  const layerOf = new Map<string, number>();
  let frontier = [...nodeIds].filter((n) => (inDeg.get(n) ?? 0) === 0);
  if (frontier.length === 0) frontier = [[...nodeIds][0]]; // 전부 사이클인 극단적 경우 대비
  for (const n of frontier) layerOf.set(n, 0);
  const remainingInDeg = new Map(inDeg);
  let guard = 0;
  while (frontier.length > 0 && guard < nodeIds.size + 1) {
    guard += 1;
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of successors.get(u) ?? []) {
        const candidate = (layerOf.get(u) ?? 0) + 1;
        if ((layerOf.get(v) ?? -1) < candidate) layerOf.set(v, candidate);
        remainingInDeg.set(v, (remainingInDeg.get(v) ?? 1) - 1);
        if ((remainingInDeg.get(v) ?? 0) <= 0 && !next.includes(v)) next.push(v);
      }
    }
    frontier = next;
  }
  const maxLayer = Math.max(0, ...[...layerOf.values()]);
  for (const n of nodeIds) if (!layerOf.has(n)) layerOf.set(n, maxLayer + 1); // 사이클에 갇힌 노드

  const nodes: Node[] = [...nodeIds].map((id) => ({
    id,
    name_ko: nameOf.get(id) ?? id,
    analyzed: analyzedSet.has(id),
    layer: layerOf.get(id) ?? 0,
  }));
  const edges: Edge[] = edgeRows.map((e) => ({ from: e.from_id, to: e.to_id, relation: e.relation, hopDistance: e.hop_distance }));

  return ok({ nodes, edges }, 200, { count: nodes.length });
}
