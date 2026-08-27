"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../lib/api.ts";

interface ProxyHop {
  id: string;
  from_industry_id: string;
  to_industry_id: string;
  hop_type: "engineering" | "statistical";
  coefficient: number | null;
  beta: number | null;
  r2: number | null;
  lag_months: number | null;
  ci_low: number | null;
  ci_high: number | null;
  evidence_ref: string;
}

interface ProxyChainGraded {
  id: string;
  target_industry_id: string;
  stored_grade: string;
  stored_rationale: string;
  recomputed_grade: string;
  recomputed_rationale: string;
  grade_mismatch: boolean;
  compounded_ci_low: number | null;
  compounded_ci_high: number | null;
  calibrated_at: string;
  hops: ProxyHop[];
}

const GRADE_STYLE: Record<string, { cls: string; label: string }> = {
  A: { cls: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20", label: "A (최상)" },
  B: { cls: "bg-amber-500/10 text-amber-400 border border-amber-500/20", label: "B (양호)" },
  C: { cls: "bg-rose-500/10 text-rose-400 border border-rose-500/20", label: "C (주의)" },
};

function GradeBadge({ grade }: { grade: string }) {
  const s = GRADE_STYLE[grade] ?? { cls: "grade-incomplete", label: grade };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${s.cls}`} aria-label={`신뢰등급 ${s.label}`}>
      {s.label}
    </span>
  );
}

export function ProxyChainGrade({ projectId }: { projectId: string }) {
  const [chains, setChains] = useState<ProxyChainGraded[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<{ chains: ProxyChainGraded[] }>(`/api/projects/${projectId}/proxy-chain-grade`)
      .then((res) => setChains(res.data.chains))
      .catch((err) => setError(err instanceof ApiError ? err.message : "프록시 체인 등급을 불러오지 못했습니다."));
  }, [projectId]);

  if (error) {
    return (
      <p role="alert" className="text-[color:var(--red-fg)]">
        {error}
      </p>
    );
  }
  if (chains === null) return <p>불러오는 중...</p>;
  if (chains.length === 0) {
    return (
      <div className="glass p-5 text-sm text-[color:var(--muted-fg)]">
        본 프로젝트의 대상 산업에 연결된 프록시 체인 데이터가 없습니다. (calibration 후 proxy_chain 레코드가 생성되어야 등급 뷰가 표시됩니다.)
      </div>
    );
  }

  return (
    <section aria-label="프록시 체인 신뢰등급" className="mt-6">
      <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
        프록시 체인 신뢰등급
        <span className="text-xs font-normal text-[color:var(--muted-fg)]">
          (저장된 등급 vs 재계산 등급 — db/lib/chain-grading.ts 기준)
        </span>
      </h3>
      <div className="space-y-4">
        {chains.map((chain) => (
          <div key={chain.id} className="glass p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">대상 산업 {chain.target_industry_id}</span>
                <GradeBadge grade={chain.stored_grade} />
                <span className="text-xs text-[color:var(--muted-fg)]">
                  재계산: <GradeBadge grade={chain.recomputed_grade} />
                </span>
              </div>
              {chain.grade_mismatch ? (
                <span className="flex items-center gap-1 text-xs text-[color:var(--red-fg)]" role="alert">
                  <AlertTriangle size={14} /> 저장 등급과 재계산 등급 불일치 — 재보정 권장
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-[color:var(--green-fg)]">
                  <CheckCircle2 size={14} /> 등급 일치
                </span>
              )}
            </div>

            <p className="text-sm text-[color:var(--muted-fg)] mt-2">{chain.stored_rationale}</p>

            {/* Chain diagram: hop sequence from→to with type + R², plus a
                compounded error-band bar (quadrature CI) under the chain. */}
            <div className="mt-3 flex items-center gap-1 flex-wrap" role="img" aria-label={`체인 다이어그램: ${chain.hops.length} 홉`}>
              {chain.hops.map((h, i) => (
                <span key={h.id} className="flex items-center gap-1">
                  <span
                    className="px-2 py-1 rounded-md text-xs font-mono bg-[color:var(--border-subtle)] border border-[color:var(--border)]"
                    title={`${h.from_industry_id} → ${h.to_industry_id} (${h.hop_type === "engineering" ? "공학" : "통계"})${h.r2 !== null ? `, R²=${h.r2.toFixed(3)}` : ""}`}
                  >
                    {h.from_industry_id}→{h.to_industry_id}
                  </span>
                  {h.hop_type === "statistical" && (
                    <span className="text-[0.7rem] text-[color:var(--muted-fg)]">
                      {h.r2 !== null ? `R² ${h.r2.toFixed(2)}` : "R²?"}
                    </span>
                  )}
                  {i < chain.hops.length - 1 && <span aria-hidden="true" className="text-[color:var(--muted-fg)]">→</span>}
                </span>
              ))}
              {chain.hops.length === 0 && <span className="text-xs text-[color:var(--muted-fg)]">홉 없음</span>}
            </div>

            {chain.compounded_ci_low !== null && chain.compounded_ci_high !== null && (() => {
              const lo = chain.compounded_ci_low;
              const hi = chain.compounded_ci_high;
              const mid = (lo + hi) / 2;
              const span = Math.max(hi - lo, 1e-9);
              const pct = (v: number) => `${((v - lo) / span) * 100}%`;
              return (
                <div className="mt-3" aria-label="복합 신뢰구간 error-band">
                  <div className="text-xs text-[color:var(--muted-fg)] mb-1">복합 신뢰구간 (error-band)</div>
                  <div className="relative h-3 rounded-full bg-[color:var(--border-subtle)]">
                    <div
                      className="absolute top-0 bottom-0 rounded-full bg-[color:var(--primary)]/30 border border-[color:var(--primary)]"
                      style={{ left: "0%", width: "100%" }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-[color:var(--primary)]"
                      style={{ left: pct(mid) }}
                      title={`점추정 ${mid.toFixed(3)}`}
                    />
                  </div>
                  <div className="flex justify-between text-[0.7rem] text-[color:var(--muted-fg)] mt-0.5 font-mono">
                    <span>{lo.toFixed(3)}</span>
                    <span>{hi.toFixed(3)}</span>
                  </div>
                </div>
              );
            })()}

            <div className="overflow-x-auto mt-3">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">프록시 체인 홉 상세</caption>
                <thead>
                  <tr className="text-left">
                    <th className="p-2 border-b border-[color:var(--border)]">#</th>
                    <th className="p-2 border-b border-[color:var(--border)]">From → To</th>
                    <th className="p-2 border-b border-[color:var(--border)]">유형</th>
                    <th className="p-2 border-b border-[color:var(--border)]">계수/β</th>
                    <th className="p-2 border-b border-[color:var(--border)]">R²</th>
                    <th className="p-2 border-b border-[color:var(--border)]">신뢰구간(하/상)</th>
                    <th className="p-2 border-b border-[color:var(--border)]">근거</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.hops.map((h, i) => (
                    <tr key={h.id} className="align-top">
                      <td className="p-2 border-b border-[color:var(--border-subtle)]">{i + 1}</td>
                      <td className="p-2 border-b border-[color:var(--border-subtle)] font-mono text-xs">
                        {h.from_industry_id} → {h.to_industry_id}
                      </td>
                      <td className="p-2 border-b border-[color:var(--border-subtle)]">
                        {h.hop_type === "engineering" ? "공학(고정계수)" : "통계(회귀)"}
                      </td>
                      <td className="p-2 border-b border-[color:var(--border-subtle)] font-mono">
                        {(h.beta ?? h.coefficient ?? "-").toString()}
                      </td>
                      <td className="p-2 border-b border-[color:var(--border-subtle)] font-mono">
                        {h.r2 !== null ? h.r2.toFixed(3) : "-"}
                      </td>
                      <td className="p-2 border-b border-[color:var(--border-subtle)] font-mono text-xs">
                        {h.ci_low !== null && h.ci_high !== null ? `${h.ci_low.toFixed(3)} / ${h.ci_high.toFixed(3)}` : "-"}
                      </td>
                      <td className="p-2 border-b border-[color:var(--border-subtle)] font-mono text-xs">{h.evidence_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {chain.compounded_ci_low !== null && chain.compounded_ci_high !== null && (
              <p className="text-xs text-[color:var(--muted-fg)] mt-2">
                복합 신뢰구간(quadrature): [{chain.compounded_ci_low.toFixed(3)}, {chain.compounded_ci_high.toFixed(3)}]
              </p>
            )}
            <p className="text-xs text-[color:var(--muted-fg)] mt-1">보정일: {chain.calibrated_at}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
