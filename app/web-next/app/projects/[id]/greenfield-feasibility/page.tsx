"use client";

// Greenfield 실현가능성 검증 — greenfield-feasibility-checklist 렌더링.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api.ts";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";

interface ChecklistItem { id: string; text: string; mandatory: boolean; waiver_eligible: boolean; state: string | null }
interface DomainView { domain: string; checklistId: string; title: string; items: ChecklistItem[] }
interface DdWorkspace { domains: DomainView[]; completion: { total: number; pending: number; mandatoryUnmet: number } }

const STATE_CLS: Record<string, string> = { pass: "status-green", fail: "status-red", na: "status-not-started", waived: "status-amber", pending: "status-not-started" };

export default function GreenfieldFeasibilityPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id as string;
  const [data, setData] = useState<DdWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    api.get<DdWorkspace>(`/api/projects/${encodeURIComponent(projectId)}/dd`)
      .then((r) => setData(r.data)).catch((e) => setError(e instanceof Error ? e.message : "로딩 실패"));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  return (
    <main className="p-6 space-y-4">
      <ProjectSubNav projectId={projectId} />
      <h1 className="text-[1.05rem] font-semibold">실현가능성 검증 — Greenfield</h1>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {data?.domains.map((domain) => (
        <section key={domain.domain} className="market-section" aria-label={domain.title}>
          <h2 className="text-[0.92rem] font-semibold mb-2">{domain.title}</h2>
          <table className="data-table" aria-label={`${domain.title} 체크리스트`}>
            <caption className="sr-only">{domain.title} 판정</caption>
            <thead><tr><th scope="col">항목</th><th scope="col">필수</th><th scope="col">판정</th></tr></thead>
            <tbody>
              {domain.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.text}</td>
                  <td>{item.mandatory ? "필수" : "선택"}</td>
                  <td><span className={`status-chip ${item.state ? (STATE_CLS[item.state] ?? "status-not-started") : "status-not-started"}`}>{item.state ?? "pending"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
