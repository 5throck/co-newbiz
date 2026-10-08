"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { StageFrame } from "../../../../components/StageFrame.tsx";

// 프로젝트 추진계획 (ADR-0104) — 최신 추진계획 버전 열람 + KPI 사전 확정(pre-commit)표
// + 버전 이력 + 수정안(amendment) 제출. 추진계획 수정은 append-only: 기존 버전을
// 덮어쓰지 않고 새 버전이 추가되며, note(변경 사유)가 필수다 — 스코프 크리프를
// 추적하기 위해서다 (C3). 수정 기록은 analyst+ 인간 행위다.

interface CharterKpi { key: string; label: string; target: string }
interface CharterVersion {
  version: number;
  purpose: string;
  marketScope: string;
  valueChainNode: string;
  track: string;
  subTrack: string | null;
  intent: string | null;
  totalScore: number | null;
  trackRationale: string;
  entryScope: string;
  kpis: CharterKpi[];
  built_by: string;
  built_at: string;
  source: string;
  note?: string;
}
interface CharterView {
  project_name: string | null;
  charter_confirmed_at: string | null;
  versions: CharterVersion[];
}

function parseKpis(text: string): CharterKpi[] {
  return text
    .split("\n")
    .map((line) => line.split("|").map((s) => s.trim()))
    .filter((parts) => parts.length >= 3 && parts[0] !== "" && parts[2] !== "")
    .map((parts) => ({ key: parts[0], label: parts[1] ?? parts[0], target: parts[2] }));
}

const TRACK_LABEL: Record<string, string> = { greenfield: "Greenfield", brownfield: "Brownfield" };

function CharterViewInner() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [data, setData] = useState<CharterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ note: string; entryScope: string; purpose: string; kpis: string }>({
    note: "", entryScope: "", purpose: "", kpis: "",
  });

  const load = useCallback(() => {
    api.get<CharterView>(`/api/projects/${encodeURIComponent(projectId)}/charter`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "차터를 불러오지 못했습니다."));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // 차터 기준선 확정 — S11 완료기준("기준선이 확정되고 append-only 변경 이력이
  // 시작되었다")의 인적 행위 표면. 승격 시 생성된 차터를 사람이 확정한다;
  // 수정안 반영 후 재확정하면 최신 버전으로 재기준된다 (idempotent 재기록).
  async function confirmBaseline() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.post<{ charter_confirmed_at: string }>(`/api/projects/${encodeURIComponent(projectId)}/charter/confirm`, {});
      setNotice("차터 기준선이 확정되었습니다 — S11 투자심사(IC) 입력 요건이 충족됩니다.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "기준선 확정 실패");
    } finally {
      setBusy(false);
    }
  }

  async function amend(e: React.FormEvent) {
    e.preventDefault();
    if (!data || busy || !form.note.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const kpis = parseKpis(form.kpis);
      const patch: { entryScope?: string; purpose?: string; kpis?: CharterKpi[] } = {};
      if (form.entryScope.trim()) patch.entryScope = form.entryScope.trim();
      if (form.purpose.trim()) patch.purpose = form.purpose.trim();
      if (kpis.length > 0) patch.kpis = kpis;
      const r = await api.post<{ version: number }>(`/api/projects/${encodeURIComponent(projectId)}/charter`, {
        note: form.note.trim(),
        patch,
      });
      setNotice(`수정안이 새 버전 v${r.data.version}으로 기록되었습니다 (append-only — 기존 버전은 보존됩니다).`);
      setForm({ note: "", entryScope: "", purpose: "", kpis: "" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정안 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  const versions = [...(data?.versions ?? [])].sort((a, b) => b.version - a.version);
  const latest = versions[0];

  return (
    <main>
      <StageTabs projectId={projectId} />
      <StageFrame stageId="S8" heading="프로젝트 추진계획 — 목적·범위·KPI 사전 확정">
        <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-2">
          추진계획은 프로젝트의 목적·시장 범위·밸류체인 노드·진입 범위·KPI를 진행 심의 전에
          문서로 고정합니다. 수정은 append-only 버전으로만 이루어지며 변경 사유(note)가 필수입니다.
          {data && (
            <>
              {" — "}
              {data.charter_confirmed_at ? (
                <span className="status-chip status-green">✓ 확정됨 · {data.charter_confirmed_at.slice(0, 10)}</span>
              ) : (
                <span className="status-chip status-amber">○ 미확정</span>
              )}
            </>
          )}
        </p>

        {canAct && data && latest && !data.charter_confirmed_at && (
          <div className="flex flex-wrap items-center gap-2 mt-2 mb-0">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void confirmBaseline()}>
              {busy ? "확정 처리 중..." : "✓ 차터 기준선 확정 (S11 입력)"}
            </button>
            <span className="text-[0.72rem] text-[color:var(--muted-fg)]">
              미확정 상태에서는 S11 투자심사 완료 요건이 충족되지 않습니다. 확정 후 수정안을 반영하면 다시 확정해야 합니다.
            </span>
          </div>
        )}

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[0.82rem] mb-2">✓ {notice}</p>}
        {!data && !error && <p className="text-[0.82rem]">불러오는 중...</p>}

        {latest && (
          <section className="market-section sizing-step" aria-label={`최신 추진계획 v${latest.version}`}>
            <h3 className="sizing-step-title text-[0.9rem]">
              최신 추진계획 v{latest.version}
              <span className="ml-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                {latest.source} · {latest.built_by} · {latest.built_at.slice(0, 10)}
              </span>
            </h3>
            <dl className="text-[0.82rem]" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 1rem" }}>
              <dt className="text-[color:var(--muted-fg)]">목적</dt><dd>{latest.purpose}</dd>
              <dt className="text-[color:var(--muted-fg)]">시장 범위</dt><dd>{latest.marketScope}</dd>
              <dt className="text-[color:var(--muted-fg)]">밸류체인 노드</dt><dd>{latest.valueChainNode}</dd>
              <dt className="text-[color:var(--muted-fg)]">트랙</dt>
              <dd>
                <span className={`status-chip ${latest.track === "brownfield" ? "status-amber" : "status-green"}`}>
                  {TRACK_LABEL[latest.track] ?? latest.track}{latest.subTrack ? ` · ${latest.subTrack}` : ""}
                </span>
                {latest.intent && <span className="ml-1 text-[0.75rem]">{latest.intent === "integration" ? "통합 의도" : "역량접근 의도"}</span>}
                {latest.totalScore !== null && <span className="ml-1 tabular-nums text-[0.75rem]">채점 {latest.totalScore}/3.0</span>}
              </dd>
              <dt className="text-[color:var(--muted-fg)]">트랙 근거</dt><dd>{latest.trackRationale}</dd>
              <dt className="text-[color:var(--muted-fg)]">진입 범위</dt><dd>{latest.entryScope}</dd>
            </dl>
          </section>
        )}

        {latest && latest.kpis.length > 0 && (
          <section className="market-section sizing-step mt-3" aria-label="KPI 사전 확정">
            <h3 className="sizing-step-title text-[0.9rem]">KPI 사전 확정 (pre-commit)</h3>
            <table className="data-table" aria-label="KPI 사전 확정">
              <caption className="sr-only">KPI 사전 확정 — 목표값</caption>
              <thead>
                <tr><th scope="col">KPI</th><th scope="col">키</th><th scope="col">목표값</th></tr>
              </thead>
              <tbody>
                {latest.kpis.map((k) => (
                  <tr key={k.key}>
                    <td className="text-[0.8rem]">{k.label}</td>
                    <td className="text-[0.72rem] tabular-nums text-[color:var(--muted-fg)]">{k.key}</td>
                    <td className="text-[0.8rem] tabular-nums">{k.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {canAct && latest && (
          <section className="market-section sizing-step mt-3" aria-label="차터 수정안">
            <h3 className="sizing-step-title text-[0.9rem]">차터 수정안 (append-only · analyst+)</h3>
            <form className="sizing-new-form" onSubmit={amend}>
              <label className="block text-[0.78rem] mb-2">
                <span className="block mb-1">변경 사유 (note) * — 스코프 크리프 추적을 위해 기록됩니다</span>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} required className="sizing-new-input w-full" placeholder="예: 엔터티 IC HOLD 근거에 따라 진입 범위를 1개 국가로 축소" />
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                <label className="text-[0.78rem] flex-1 min-w-[16rem]">
                  <span className="block mb-1">진입 범위 (entryScope) — 변경 시에만 입력</span>
                  <input value={form.entryScope} onChange={(e) => setForm({ ...form, entryScope: e.target.value })} className="sizing-new-input w-full" />
                </label>
                <label className="text-[0.78rem] flex-1 min-w-[16rem]">
                  <span className="block mb-1">목적 (purpose) — 변경 시에만 입력</span>
                  <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="sizing-new-input w-full" />
                </label>
              </div>
              <label className="block text-[0.78rem] mb-2">
                <span className="block mb-1">KPI — 한 줄에 하나, "key | label | target" 형식 (변경 시에만 입력)</span>
                <textarea value={form.kpis} onChange={(e) => setForm({ ...form, kpis: e.target.value })} rows={3} className="sizing-new-input w-full" placeholder={"npv_upside | NPV 상승분 | 150억 이상\npayback | 투자 회수 | 5년 이내"} />
              </label>
              <button type="submit" className="btn-ghost btn-sm" disabled={busy || !form.note.trim()}>
                {busy ? "기록 중..." : "수정안 기록 (새 버전)"}
              </button>
            </form>
          </section>
        )}

        {versions.length > 0 && (
          <section className="market-section sizing-step mt-3" aria-label="버전 이력">
            <h3 className="sizing-step-title text-[0.9rem]">버전 이력</h3>
            <ul className="sizing-note-list">
              {versions.map((v) => (
                <li key={v.version}>
                  <strong>v{v.version}</strong>{" "}
                  <span className="text-[0.72rem] text-[color:var(--muted-fg)] tabular-nums">
                    {v.source} · {v.built_by} · {v.built_at.slice(0, 10)}
                  </span>
                  {v.note && <span className="block text-[0.75rem]">사유: {v.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </StageFrame>
    </main>
  );
}

export default function CharterPage() {
  return (
    <Suspense fallback={null}>
      <CharterViewInner />
    </Suspense>
  );
}
