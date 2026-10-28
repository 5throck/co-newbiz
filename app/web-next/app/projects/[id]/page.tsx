"use client";

// 프로젝트 개요 (ADR-0104) — StageTabs "개요" 진입점. 차터 최신본과
// S4~S12 프로세스 스냅샷을 한 화면에서 요약한다. 삭제는 /projects 목록의
// 행 액션(리드 전용)에서 수행한다.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { STAGE_STATUS_KEY, trackKeyParts, trackKeysText, resolveLabelTokens } from "../../../lib/label-keys.ts";
import { api } from "../../../lib/api.ts";
import { StageTabs } from "../../../components/StageTabs.tsx";

import { RawKey } from "../../../components/RawKey.tsx";
import { ReconfirmNotice } from "../../../components/ReconfirmNotice.tsx";

interface CharterKpi { key: string; label: string; target: string }
interface CharterVersion {
  version: number;
  purpose: string;
  marketScope: string | null;
  entryScope: string;
  track: string | null;
  subTrack: string | null;
  totalScore: number | null;
  built_at: string;
  kpis?: CharterKpi[];
}
interface StageView {
  id: string;
  name: string;
  status: "complete" | "current" | "blocked" | "locked" | "skipped" | "terminated";
}
interface CharterData { project_name: string | null; charter_confirmed_at: string | null; versions: CharterVersion[] }
interface ProcessData { currentStage: string | null; nextStage: string | null; track: string | null; subTrack: string | null; stages: StageView[] }
interface OverviewData { project_name: string | null; charter_confirmed_at: string | null; versions: CharterVersion[]; process: ProcessData | null }

const STATUS_CLASS: Record<StageView["status"], string> = {
  complete: "status-green", current: "status-in-progress", blocked: "status-red",
  locked: "status-not-started", skipped: "status-not-started", terminated: "status-red",
};

export default function ProjectOverviewPage() {
  const tr = useTranslations();
  const t = useTranslations("pages.projects.overview");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const projectId = params?.id as string;
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    Promise.all([
      api.get<CharterData>(`/api/projects/${encodeURIComponent(projectId)}/charter`).then((r) => r.data).catch(() => null),
      api.get<ProcessData>(`/api/projects/${encodeURIComponent(projectId)}/process`).then((r) => r.data).catch(() => null),
    ]).then(([charter, process]) => {
      if (!charter && !process) { setError(t("loadFailed")); return; }
      setData({ ...(charter ?? {}), process: process ?? null } as OverviewData);
    });
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <main className="p-6"><p role="alert" className="text-[color:var(--red-fg)]">{error}</p></main>;
  if (!data) return <main className="p-6"><p role="status">{tc("loading")}</p></main>;

  const versions = data.versions ?? [];
  const latest = versions[versions.length - 1] ?? null;
  const process = data.process ?? null;

  return (
    <main className="p-6 space-y-4">
      <StageTabs projectId={projectId} />
      <header>
        <h1 className="text-[1.05rem] font-semibold">{t("heading", { name: data.project_name ?? projectId })}</h1>
      </header>
      <ReconfirmNotice projectId={projectId} />

      <section aria-label={t("charterSectionAria")} className="market-section">
        <h2 className=" font-semibold mb-2">{t("charterHeading", { suffix: latest ? `(v${latest.version})` : "" })}</h2>
        {latest ? (
          <dl className="text-[length:var(--fs-body)] space-y-1">
            <div><dt className="inline font-semibold mr-1">{t("dtPurpose")}</dt><dd className="inline">{latest.purpose}</dd></div>
            <div><dt className="inline font-semibold mr-1">{t("dtMarket")}</dt><dd className="inline">{latest.marketScope ?? "—"}</dd></div>
            <div><dt className="inline font-semibold mr-1">{t("dtEntryScope")}</dt><dd className="inline">{latest.entryScope}</dd></div>
            <div><dt className="inline font-semibold mr-1">{t("dtKpi")}</dt><dd className="inline">{latest.kpis?.length ? latest.kpis.map((k) => `${k.label}: ${k.target}`).join(" · ") : t("kpisUnset")}</dd></div>
          </dl>
        ) : (
          <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{t("noCharter")}</p>
        )}
      </section>

      {process && (
        <section aria-label={t("processSectionAria")} className="market-section">
          <h2 className=" font-semibold mb-2">{t("processHeading")}</h2>
          <ol className="space-y-1 text-[length:var(--fs-body)]">
            {process.stages.map((s2) => (
              <li key={s2.id}>
                <span className={`status-chip ${STATUS_CLASS[s2.status]} w-[5.2rem] justify-center mr-2`}>{tr(STAGE_STATUS_KEY[s2.status] ?? s2.status)}</span>
                <span className="font-semibold mr-1">{s2.id}</span> {s2.name}
              </li>
            ))}
          </ol>
          {process.track && (
            <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
              {t("trackLine", { track: resolveLabelTokens(trackKeysText(process.track, process.subTrack), tr) })}
              <RawKey parts={trackKeyParts(process.track, process.subTrack).map((p2) => ({ label: "", raw: p2.raw, isFallback: p2.key === null }))} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
