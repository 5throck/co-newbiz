"use client";

// Overview tab — gate progression + RAG sparkline + compliance status
// M3: consumed by projects/[id]/page.tsx overview tab

import { useEffect, useState } from "react";
import { api, type ProvenanceMeta, type RagDimension } from "../lib/api.ts";
import { RagSignalCard, GradeBadge } from "./RagCard.tsx";
import { GateProgress } from "./GateProgress.tsx";
import { SourceTooltip } from "./SourceTooltip.tsx";

interface ApprovalChainRow {
  level: string;
  gate: string;
  sequence: number;
  status: string;
  decision: string | null;
  decided_at: string | null;
  blocked_reason: string | null;
}

interface RagTransition {
  from_grade: string | null;
  to_grade: string;
  at: string;
  reason: string | null;
}

interface ComplianceCheck {
  check_key: string;
  result: string;
  rationale: string | null;
}

interface Waiver {
  id: string;
  check_key: string;
  reason: string;
  expires_at: string;
}

export function OverviewTab({
  projectId,
  dimensions,
  ragProvenance,
}: {
  projectId: string;
  dimensions: RagDimension[];
  ragProvenance: ProvenanceMeta;
}) {
  const [approvalChain, setApprovalChain] = useState<ApprovalChainRow[]>([]);
  const [ragHistory, setRagHistory] = useState<RagTransition[]>([]);
  const [complianceChecks, setComplianceChecks] = useState<ComplianceCheck[]>([]);
  const [waivers, setWaivers] = useState<Waiver[]>([]);

  useEffect(() => {
    if (!projectId) return;
    api.get<ApprovalChainRow[]>(`/api/projects/${projectId}/approval-chain`)
      .then((res) => setApprovalChain(res.data))
      .catch(() => setApprovalChain([]));
    api.get<RagTransition[]>(`/api/projects/${projectId}/rag/history`)
      .then((res) => setRagHistory(res.data))
      .catch(() => setRagHistory([]));
    api.get<ComplianceCheck[]>(`/api/projects/${projectId}/compliance-checks`)
      .then((res) => setComplianceChecks(res.data))
      .catch(() => setComplianceChecks([]));
    api.get<Waiver[]>(`/api/projects/${projectId}/waivers`)
      .then((res) => setWaivers(res.data))
      .catch(() => setWaivers([]));
  }, [projectId]);

  const currentGateStage = (() => {
    const entityRow = approvalChain.find((r) => r.level === "entity" && r.status === "approved");
    if (entityRow) return "entity_ic";
    const groupRow = approvalChain.find((r) => r.level === "group" && r.status === "approved");
    if (groupRow) return "group_ic";
    const pendingEntity = approvalChain.find((r) => r.level === "entity" && r.status === "pending");
    if (pendingEntity) return "dd";
    return "screening";
  })();

  const failedChecks = complianceChecks.filter((c) => c.result === "fail");
  const activeWaivers = waivers.filter((w) => new Date(w.expires_at) > new Date());

  return (
    <div className="overview-tab space-y-6">
      {/* Gate Progress */}
      <section className="glass p-4" aria-label="게이트 진행 상태">
        <h3 className="text-label mb-2">게이트 진행</h3>
        <GateProgress currentStage={currentGateStage} />
      </section>

      {/* RAG Signal Card */}
      <section aria-label="RAG 신호등">
        <RagSignalCard dimensions={dimensions} provenance={ragProvenance} />
      </section>

      {/* RAG History Sparkline */}
      {ragHistory.length > 0 && (
        <section className="glass p-4" aria-label="RAG 등급 이력">
          <h3 className="text-label mb-2">등급 변경 이력</h3>
          <div className="rag-sparkline flex gap-2 overflow-x-auto pb-2">
            {ragHistory.slice(0, 10).map((t, i) => (
              <div key={i} className="rag-spark-item flex flex-col items-center gap-1 min-w-[60px]">
                <GradeBadge grade={t.to_grade} />
                <span className="text-xs text-[color:var(--muted-fg)]">
                  {new Date(t.at).toLocaleDateString("ko-KR")}
                </span>
                {t.reason && (
                  <span className="text-xs text-[color:var(--muted-fg)] max-w-[80px] truncate" title={t.reason}>
                    {t.reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Compliance & Waivers */}
      {(failedChecks.length > 0 || activeWaivers.length > 0) && (
        <section className="glass p-4" aria-label="컴플라이언스 상태">
          <h3 className="text-label mb-2">컴플라이언스</h3>
          {failedChecks.length > 0 && (
            <div className="mb-2">
              <span className="text-sm text-[color:var(--red-fg)] font-semibold">차단 항목:</span>
              <ul className="list-disc list-inside text-sm mt-1">
                {failedChecks.map((c) => (
                  <li key={c.check_key} className="text-[color:var(--red-fg)]">
                    {c.check_key}
                    {c.rationale && <span className="text-[color:var(--muted-fg)]"> — {c.rationale}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {activeWaivers.length > 0 && (
            <div>
              <span className="text-sm text-[color:var(--amber-fg)] font-semibold">활성 와이버:</span>
              <ul className="list-disc list-inside text-sm mt-1">
                {activeWaivers.map((w) => (
                  <li key={w.id} className="text-[color:var(--amber-fg)]">
                    {w.check_key} — {w.reason}
                    <span className="text-[color:var(--muted-fg)]">
                      {" "}(만료: {new Date(w.expires_at).toLocaleDateString("ko-KR")})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
