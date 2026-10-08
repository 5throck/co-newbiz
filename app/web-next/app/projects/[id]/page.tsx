"use client";

// 프로젝트 개요 (ADR-0104) — StageTabs "개요" 진입점. 차터 최신본과
// S4~S12 프로세스 스냅샷을 한 화면에서 요약한다. 삭제는 /projects 목록의
// 행 액션(리드 전용)에서 수행한다.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api.ts";
import { StageTabs } from "../../../components/StageTabs.tsx";

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

const STATUS_LABEL: Record<StageView["status"], string> = {
  complete: "완료", current: "진행", blocked: "차단", locked: "대기", skipped: "미적용", terminated: "종료",
};
const STATUS_CLASS: Record<StageView["status"], string> = {
  complete: "status-green", current: "status-in-progress", blocked: "status-red",
  locked: "status-not-started", skipped: "status-not-started", terminated: "status-red",
};

export default function ProjectOverviewPage() {
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
      if (!charter && !process) { setError("프로젝트 정보를 불러오지 못했습니다."); return; }
      setData({ ...(charter ?? {}), process: process ?? null } as OverviewData);
    });
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <main className="p-6"><p role="alert" className="text-[color:var(--red-fg)]">{error}</p></main>;
  if (!data) return <main className="p-6"><p role="status">불러오는 중...</p></main>;

  const versions = data.versions ?? [];
  const latest = versions[versions.length - 1] ?? null;
  const process = data.process ?? null;

  return (
    <main className="p-6 space-y-4">
      <StageTabs projectId={projectId} />
      <header>
        <h1 className="text-[1.05rem] font-semibold">프로젝트 개요 — {data.project_name ?? projectId}</h1>
      </header>

      <section aria-label="추진계획 요약" className="market-section">
        <h2 className="text-[0.92rem] font-semibold mb-2">추진계획 요약 {latest ? `(v${latest.version})` : ""}</h2>
        {latest ? (
          <dl className="text-[length:var(--fs-body)] space-y-1">
            <div><dt className="inline font-semibold mr-1">목적:</dt><dd className="inline">{latest.purpose}</dd></div>
            <div><dt className="inline font-semibold mr-1">시장:</dt><dd className="inline">{latest.marketScope ?? "—"}</dd></div>
            <div><dt className="inline font-semibold mr-1">진출 범위:</dt><dd className="inline">{latest.entryScope}</dd></div>
            <div><dt className="inline font-semibold mr-1">KPI:</dt><dd className="inline">{latest.kpis?.length ? latest.kpis.map((k) => `${k.label}: ${k.target}`).join(" · ") : "미설정"}</dd></div>
          </dl>
        ) : (
          <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">추진계획이 아직 생성되지 않았습니다.</p>
        )}
      </section>

      {process && (
        <section aria-label="프로세스 스냅샷" className="market-section">
          <h2 className="text-[0.92rem] font-semibold mb-2">프로세스 현황</h2>
          <ol className="space-y-1 text-[length:var(--fs-body)]">
            {process.stages.map((s2) => (
              <li key={s2.id}>
                <span className={`status-chip ${STATUS_CLASS[s2.status]} w-[5.2rem] justify-center mr-2`}>{STATUS_LABEL[s2.status]}</span>
                <span className="font-semibold mr-1">{s2.id}</span> {s2.name}
              </li>
            ))}
          </ol>
          {process.track && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
              트랙: {process.track}{process.subTrack ? ` / ${process.subTrack}` : ""}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
