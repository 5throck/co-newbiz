import { useEffect, useState } from "react";
import { api, type PermitRow, type PermitsResponse } from "../api.ts";

// 법령·인허가 (Regulatory & Permits) tab — ui-spec §2: GET
// /api/projects/:id/permits?include_dag=1. Permits and certifications are
// rendered as clearly-separated parallel sections — never merged, per the
// non-negotiable boundary in CLAUDE.md / design §4-1 (a permit lets you
// operate, a certification lets you sell). The DAG is a hand-rolled layered
// list (Kahn's-algorithm layering computed client-side, mirroring the
// server's criticalPath()) — no graph/chart library, per the task scope.
// Critical-path permits get a border + badge, never color-only.

const STATUS_META: Record<string, { icon: string; label: string; className: string }> = {
  not_started: { icon: "○", label: "미착수", className: "status-not-started" },
  in_progress: { icon: "◐", label: "진행중", className: "status-in-progress" },
  submitted: { icon: "◐", label: "제출됨", className: "status-in-progress" },
  approved: { icon: "●", label: "승인됨", className: "status-approved" },
  granted: { icon: "●", label: "승인됨", className: "status-approved" },
  rejected: { icon: "■", label: "반려됨", className: "status-rejected" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { icon: "?", label: status, className: "status-unknown" };
}

/** Kahn's-algorithm topological layering: layer[v] = 1 + max(layer[u]) over predecessors u, 0 with none. */
function computeLayers(nodes: readonly { id: string }[], edges: readonly { from: string; to: string }[]): string[][] {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  const inDeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    preds.get(e.to)!.push(e.from);
    succs.get(e.from)!.push(e.to);
    inDeg.set(e.to, inDeg.get(e.to)! + 1);
  }
  const layerOf = new Map<string, number>();
  const queue = ids.filter((id) => inDeg.get(id) === 0);
  for (const id of queue) layerOf.set(id, 0);
  const processed: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    processed.push(u);
    for (const v of succs.get(u)!) {
      inDeg.set(v, inDeg.get(v)! - 1);
      const candidate = layerOf.get(u)! + 1;
      layerOf.set(v, Math.max(layerOf.get(v) ?? 0, candidate));
      if (inDeg.get(v) === 0) queue.push(v);
    }
  }
  // Nodes never reached by the topological pass (a cyclic subgraph — should
  // not occur for a valid DAG) still render, appended to their own trailing
  // layer rather than silently dropped.
  const maxLayer = Math.max(0, ...[...layerOf.values()]);
  const strandedLayer = maxLayer + 1;
  const layers: Map<number, string[]> = new Map();
  for (const id of ids) {
    const l = layerOf.get(id) ?? strandedLayer;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(id);
  }
  return [...layers.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}

function PermitSection({
  title,
  rows,
  edges,
  criticalPath,
}: {
  title: string;
  rows: PermitRow[];
  edges: { from: string; to: string }[];
  criticalPath: string[];
}) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const criticalSet = new Set(criticalPath);
  const layers = computeLayers(rows, edges);

  return (
    <section className="permit-section" aria-label={title}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="empty-state">데이터 없음 — 등록된 {title}이(가) 없습니다.</p>
      ) : (
        <>
          <table className="data-table permit-table">
            <caption className="sr-only">{title} 목록</caption>
            <thead>
              <tr>
                <th scope="col">명칭</th>
                <th scope="col">관할 기관</th>
                <th scope="col">법정 처리일</th>
                <th scope="col">상태</th>
                <th scope="col">임계 경로</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = statusMeta(r.status);
                const critical = criticalSet.has(r.id);
                return (
                  <tr key={r.id} className={critical ? "row-critical" : undefined}>
                    <td>{r.name}</td>
                    <td>{r.agency}</td>
                    <td>{r.statutory_days ?? "—"}</td>
                    <td>
                      <span className={`status-chip ${meta.className}`}>
                        <span aria-hidden="true">{meta.icon}</span> {meta.label}
                      </span>
                    </td>
                    <td>{critical && <span className="critical-badge">임계 경로</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {edges.length > 0 && (
            <div className="dag-view">
              <h3>선후행 관계 (DAG)</h3>
              <div className="dag-layers">
                {layers.map((layer, i) => (
                  <div key={i} className="dag-layer">
                    <span className="dag-layer-label">{i + 1}단계</span>
                    <ul className="dag-layer-nodes">
                      {layer.map((id) => {
                        const row = byId.get(id);
                        if (!row) return null;
                        const critical = criticalSet.has(id);
                        return (
                          <li key={id} className={`dag-node${critical ? " dag-node-critical" : ""}`}>
                            {row.name}
                            {critical && (
                              <span className="critical-badge critical-badge-inline">임계 경로</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              <ul className="dag-edge-list">
                {edges.map((e, i) => (
                  <li key={i}>
                    {byId.get(e.from)?.name ?? e.from} → {byId.get(e.to)?.name ?? e.to}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function PermitsTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PermitsResponse | null>(null);

  useEffect(() => {
    api
      .get<PermitsResponse>(`/api/projects/${projectId}/permits?include_dag=1`)
      .then((res) => setData(res.data))
      .catch(() => setData({ permits: [], certifications: [] }));
  }, [projectId]);

  if (data === null) {
    return <p>불러오는 중...</p>;
  }

  return (
    <div className="permits-tab">
      <PermitSection
        title="인허가 (Permits)"
        rows={data.permits}
        edges={data.dag?.permit_edges ?? []}
        criticalPath={data.dag?.permit_critical_path ?? []}
      />
      <PermitSection
        title="인증 (Certifications)"
        rows={data.certifications}
        edges={data.dag?.certification_edges ?? []}
        criticalPath={data.dag?.certification_critical_path ?? []}
      />
    </div>
  );
}
