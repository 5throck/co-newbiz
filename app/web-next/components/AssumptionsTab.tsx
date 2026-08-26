"use client";

import { useEffect, useState } from "react";
import { api, type AssumptionRow, type RunSummary } from "../lib/api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { GlossaryText } from "../lib/glossary-provider.tsx";

// 가정 (Assumptions) tab — ui-spec §2: read-only registry for the
// project's latest run (GET /api/projects/:id/runs, newest-first — the
// first row is the latest, per analysis.ts's ORDER BY created_at DESC).
// kind renders as a chip (live/user/derived/assumed); assumed rows must
// visibly show rationale (FR-DATA-07) — not hidden behind a tooltip.
// Write form (POST /api/assumptions) is deliberately deferred; see the
// ui-spec §2 delta note.

const KIND_META: Record<string, { label: string; className: string }> = {
  live: { label: "실시간", className: "kind-live" },
  user: { label: "사용자 입력", className: "kind-user" },
  derived: { label: "파생값", className: "kind-derived" },
  assumed: { label: "가정값", className: "kind-assumed" },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, className: "kind-unknown" };
}

export function AssumptionsTab({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [assumptions, setAssumptions] = useState<AssumptionRow[] | null>(null);

  useEffect(() => {
    api
      .get<RunSummary[]>(`/api/projects/${projectId}/runs`)
      .then((res) => setRuns(res.data))
      .catch(() => setRuns([]));
  }, [projectId]);

  const latestRun = runs && runs.length > 0 ? runs[0] : null;

  useEffect(() => {
    if (!latestRun) {
      setAssumptions(runs === null ? null : []);
      return;
    }
    api
      .get<AssumptionRow[]>(`/api/assumptions?run_id=${encodeURIComponent(latestRun.id)}`)
      .then((res) => setAssumptions(res.data))
      .catch(() => setAssumptions([]));
    // runs is stable once fetched; latestRun.id is the actual dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun?.id]);

  if (runs === null) {
    return <p>불러오는 중...</p>;
  }

  if (!latestRun) {
    return <p className="empty-state">데이터 없음 — 이 프로젝트에 생성된 분석 실행(run)이 없습니다.</p>;
  }

  return (
    <div className="assumptions-tab">
      <p className="assumptions-run-note">
        최신 분석 실행: <strong>{latestRun.label}</strong> ({new Date(latestRun.created_at).toLocaleString("ko-KR")})
      </p>
      {assumptions === null ? (
        <p>불러오는 중...</p>
      ) : assumptions.length === 0 ? (
        <p className="empty-state">데이터 없음 — 이 실행에 등록된 가정이 없습니다.</p>
      ) : (
        <table className="data-table assumptions-table">
          <caption className="sr-only">가정 목록</caption>
          <thead>
            <tr>
              <th scope="col">가정 키</th>
              <th scope="col">종류</th>
              <th scope="col">값</th>
              <th scope="col">제공 시점</th>
              <th scope="col">유효기간(일)</th>
              <th scope="col">근거</th>
            </tr>
          </thead>
          <tbody>
            {assumptions.map((a) => {
              const meta = kindMeta(a.kind);
              const provenance = { assumption_key: a.assumption_key, as_of: a.as_of, anchor_ref: a.anchor_ref ?? undefined };
              return (
                <tr key={a.id}>
                  <td>{a.assumption_key}</td>
                  <td>
                    <span className={`kind-chip ${meta.className}`}>{meta.label}</span>
                  </td>
                  <td>
                    <SourceTooltip provenance={provenance}>{a.value}</SourceTooltip>
                  </td>
                  <td>{new Date(a.as_of).toLocaleDateString("ko-KR")}</td>
                  <td>{a.ttl_days ?? "—"}</td>
                  <td>
                    {a.kind === "assumed" ? (
                      a.rationale?.trim() ? (
                        <p className="assumption-rationale">
                          <GlossaryText text={a.rationale.trim()} />
                        </p>
                      ) : (
                        <p className="assumption-rationale">근거 미기재</p>
                      )
                    ) : a.rationale?.trim() ? (
                      <GlossaryText text={a.rationale.trim()} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
