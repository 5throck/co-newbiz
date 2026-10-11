"use client";

// Project process view — full S1~S12 chain (opportunity backlink + project
// branch) from GET /api/projects/[id]/process. One screen answers "지금 어디
// 스코" for a promoted deal: stage statuses, live blockers, and recorded
// gate verdicts. Read-only — gate recording stays on the stage pages
// (GateDecisionPanel, boundary #2).
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { PageHeader } from "../../../../components/layout.tsx";
import { api } from "../../../../lib/api.ts";
import { dealStageHref } from "../../../../lib/deal-links.ts";
import { DECISION_LABEL, GATE_LABEL, RECORD_KEY_LABEL, STAGE_STATUS_LABEL, labelText, resolveLabel, trackLabel, trackLabelParts } from "../../../../lib/labels.ts";
import { RawKey } from "../../../../components/RawKey.tsx";

interface StageView {
  id: string;
  name: string;
  status: "complete" | "current" | "blocked" | "locked" | "skipped" | "terminated";
  requiredArtifacts: string[];
  gateIds?: string[];
}
interface ProcessView {
  project: { id: string; project_no: string | null };
  stages: StageView[];
  currentStage: string | null;
  completedStages: string[];
  nextStage: string | null;
  blockers: string[];
  requiredArtifacts: string[];
  gateStatus: Record<string, string>;
  terminated: boolean;
  track: string | null;
  subTrack: string | null;
  opportunity: {
    id: string;
    stages: StageView[];
    currentStage: string | null;
    blockers: string[];
    gateStatus: Record<string, string>;
  } | null;
}

const STATUS_LABEL = STAGE_STATUS_LABEL as Record<StageView["status"], string>;
const STATUS_CLASS: Record<StageView["status"], string> = {
  complete: "status-green",
  current: "status-in-progress",
  blocked: "status-red",
  locked: "status-not-started",
  skipped: "status-not-started",
  terminated: "status-red",
};

// flow.spec v2.0.0 — stage -> gate ids (chip placement on this view).
const GATES_BY_STAGE: Record<string, string[]> = {
  S1: ["screening"],
  S2: ["screening"],
  S3: ["screening"],
  S4: ["screening", "pre_fs"],
  S5: ["pre_fs"],
  S6: ["pre_fs"],
  S7: ["target_screening"],
  S8: ["fs"],
  S9: ["dd"],
  S11: ["entity_ic", "group_ic"],
  S12: [],
};

function StageList({ stages, gateStatus }: { stages: StageView[]; gateStatus: Record<string, string> }) {
  return (
    <ol className="mt-2 space-y-1">
      {stages.map((s) => (
        <li key={s.id} className="flex flex-wrap items-start gap-2 text-[0.88rem]">
          <span className={`status-chip ${STATUS_CLASS[s.status]} whitespace-nowrap justify-center`}>{STATUS_LABEL[s.status]}</span>
          <span className="w-8 font-semibold tabular-nums">{s.id}</span>
          <span className="flex-1 min-w-0">
            {s.name}
            {s.status === "current" && s.requiredArtifacts.length > 0 && (
              <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                필요: {s.requiredArtifacts.map((k) => labelText(RECORD_KEY_LABEL, k)).join(", ")}
                {s.requiredArtifacts.some((k) => resolveLabel(RECORD_KEY_LABEL, k).isFallback) && (
                  <RawKey parts={s.requiredArtifacts.map((k) => resolveLabel(RECORD_KEY_LABEL, k))} />
                )}
              </span>
            )}
          </span>
          {s.gateIds && s.gateIds.length > 0 && (
            <span className="flex flex-wrap gap-1 basis-full sm:basis-auto">
              {s.gateIds.map((g: string) => {
                const decision = gateStatus[g];
                return (
                  <span
                    key={g}
                    className={`status-chip whitespace-nowrap ${decision === "go" ? "status-green" : decision === "hold" ? "status-in-progress" : decision === "kill" ? "status-red" : "status-not-started"}`}
                    title={`${GATE_LABEL[g] ?? g}: ${decision ? labelText(DECISION_LABEL, decision) : "미기록"}`}
                  >
                    게이트 {GATE_LABEL[g] ?? g}
                    {decision ? ` · ${labelText(DECISION_LABEL, decision)}` : ""}
                  </span>
                );
              })}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function ProjectProcessPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  const [data, setData] = useState<ProcessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    api.get<ProcessView>(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => { setData(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "프로세스 정보를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <main className="p-6"><p role="alert" className="text-[color:var(--red-fg)]">{error}</p></main>;
  if (!data) return <main className="p-6"><p role="status">불러오는 중...</p></main>;

  const stagesWithGates = data.stages.map((s) => ({
    ...s,
    // gate chip placement: attach each recorded gate to its owning stage per flow.spec
    gateIds: GATES_BY_STAGE[s.id] ?? [],
  }));
  const opportunityStages = data.opportunity?.stages.map((s) => ({
    ...s,
    gateIds: GATES_BY_STAGE[s.id] ?? [],
  }));
  const stageNameOf = (id: string | null): string => {
    if (!id) return "—";
    const hit = [...data.stages, ...(data.opportunity?.stages ?? [])].find((x) => x.id === id);
    return hit ? `${hit.id} ${hit.name}` : id;
  };

  return (
    <main className="p-6 space-y-4">
      <StageTabs projectId={projectId} />
      <header>
        <PageHeader title={`프로세스 현황 — ${data.project.project_no ?? data.project.id}`} />
        {data.track && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            트랙: {trackLabel(data.track, data.subTrack)} · 현재 {stageNameOf(data.currentStage)} · 다음 {stageNameOf(data.nextStage)}
            {data.terminated && " · KILL로 종료됨"}
            <RawKey parts={trackLabelParts(data.track, data.subTrack)} />
          </p>
        )}
      </header>

      {data.blockers.length > 0 && (
        <section aria-label="현재 차단 요건" className="market-section">
          <h2 className="text-[0.92rem] font-semibold mb-1">현재 차단 요건</h2>
          <ul className="sizing-note-list text-[length:var(--fs-body)]">
            {data.blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </section>
      )}

      <section aria-label="프로젝트 단계 (S4~S12)" className="market-section">
        <h2 className="text-[0.92rem] font-semibold">프로젝트 단계</h2>
        <StageList stages={stagesWithGates} gateStatus={data.gateStatus} />
      </section>

      {data.opportunity && (
        <section aria-label="기회 단계 (S1~S4)" className="market-section">
          <h2 className="text-[0.92rem] font-semibold">
            기회 단계 <a className="text-[color:var(--accent)] underline text-[length:var(--fs-caption)]" href={dealStageHref(data.opportunity.id, opportunityStages?.find((s) => s.status === "current")?.id)}>기회 화면 →</a>
          </h2>
          <StageList stages={opportunityStages ?? []} gateStatus={data.opportunity.gateStatus} />
        </section>
      )}
    </main>
  );
}
