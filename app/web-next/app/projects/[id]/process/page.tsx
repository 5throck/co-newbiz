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
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { dealStageHref } from "../../../../lib/deal-links.ts";
import { DECISION_LABEL_KEY, GATE_LABEL_KEY, STAGE_STATUS_KEY } from "../../../../lib/label-keys.ts";
import { localizeRequirement } from "../../../../lib/labels.ts";
import { RECORD_KEY, trackKeyParts, trackKeysText, resolveLabelTokens } from "../../../../lib/label-keys.ts";
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

/** The flow spec lists required artifacts as Korean prose (not record keys); only unmapped non-prose tokens fall back to the placeholder. */
const isProseRequirement = (k: string): boolean => /[\uAC00-\uD7A3]/.test(k);

function StageList({ stages, gateStatus }: { stages: StageView[]; gateStatus: Record<string, string> }) {
  const tr = useTranslations();
  const t = useTranslations("pages.projects.process");
  return (
    <ol className="mt-2 space-y-1">
      {stages.map((s) => (
        <li key={s.id} className="flex flex-wrap items-start gap-2 text-[length:var(--fs-body)]">
          <span className={`status-chip ${STATUS_CLASS[s.status]} whitespace-nowrap justify-center`}>{tr(STAGE_STATUS_KEY[s.status] ?? s.status)}</span>
          <span className="w-8 font-semibold tabular-nums">{s.id}</span>
          <span className="flex-1 min-w-0">
            {s.name}
            {s.status === "current" && s.requiredArtifacts.length > 0 && (
              <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("requiredPrefix")}{s.requiredArtifacts.map((k) => (RECORD_KEY[k] ? tr(RECORD_KEY[k]) : isProseRequirement(k) ? localizeRequirement(k) : tr("common.unclassified"))).join(", ")}
                {s.requiredArtifacts.some((k) => !RECORD_KEY[k] && !isProseRequirement(k)) && (
                  <RawKey parts={s.requiredArtifacts.filter((k) => !RECORD_KEY[k] && !isProseRequirement(k)).map((k) => ({ label: "", raw: k, isFallback: true }))} />
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
                    title={`${tr(GATE_LABEL_KEY[g] ?? g)}: ${decision ? tr(DECISION_LABEL_KEY[decision] ?? decision) : t("unrecorded")}`}
                  >
                    {t("gateChip", { gate: tr(GATE_LABEL_KEY[g] ?? g) })}
                    {decision ? ` · ${tr(DECISION_LABEL_KEY[decision] ?? decision)}` : ""}
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
  const tr = useTranslations();
  const t = useTranslations("pages.projects.process");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  const [data, setData] = useState<ProcessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    api.get<ProcessView>(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => { setData(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <main className="p-6"><p role="alert" className="text-[color:var(--red-fg)]">{error}</p></main>;
  if (!data) return <main className="p-6"><p role="status">{tc("loading")}</p></main>;

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
        <PageHeader title={t("pageHeading", { project: data.project.project_no ?? data.project.id })} />
        {data.track && (
          <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("trackLine", { track: resolveLabelTokens(trackKeysText(data.track, data.subTrack), tr), current: stageNameOf(data.currentStage), next: stageNameOf(data.nextStage) })}
            {data.terminated && t("killSuffix")}
            <RawKey parts={trackKeyParts(data.track, data.subTrack).map((p2) => ({ label: "", raw: p2.raw, isFallback: p2.key === null }))} />
          </div>
        )}
      </header>

      {data.blockers.length > 0 && (
        <section aria-label={t("blockersHeading")} className="market-section">
          <h2 className="text-[length:var(--fs-body)] font-semibold mb-1">{t("blockersHeading")}</h2>
          <ul className="sizing-note-list text-[length:var(--fs-body)]">
            {data.blockers.map((b, i) => <li key={i}>{localizeRequirement(b)}</li>)}
          </ul>
        </section>
      )}

      <section aria-label={t("projectStagesAria")} className="market-section">
        <h2 className="text-[length:var(--fs-body)] font-semibold">{t("projectStagesHeading")}</h2>
        <StageList stages={stagesWithGates} gateStatus={data.gateStatus} />
      </section>

      {data.opportunity && (
        <section aria-label={t("opportunityStagesAria")} className="market-section">
          <h2 className="text-[length:var(--fs-body)] font-semibold">
            {t("opportunityStagesHeading")} <a className="text-[color:var(--accent)] underline text-[length:var(--fs-caption)]" href={dealStageHref(data.opportunity.id, opportunityStages?.find((s) => s.status === "current")?.id)}>{t("opportunityLink")}</a>
          </h2>
          <StageList stages={opportunityStages ?? []} gateStatus={data.opportunity.gateStatus} />
        </section>
      )}
    </main>
  );
}
