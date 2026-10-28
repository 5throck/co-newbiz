"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { trackKeyParts, trackKeysText, resolveLabelTokens } from "../../../../lib/label-keys.ts";
import { api } from "../../../../lib/api.ts";

import { RawKey } from "../../../../components/RawKey.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { ColGroup } from "../../../../components/ui.tsx";

const KPI_COL_PCT = [45, 25, 30] as const;


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


function CharterViewInner() {
  const tr = useTranslations();
  const t = useTranslations("pages.projects.charter");
  const tc = useTranslations("common");
  /** Route-decision intent → catalog key (ko master wording mirrors the former labels.ts INTENT_LABEL). */
  const INTENT_KEY: Record<string, string> = { integration: "common.intentIntegration", capability_access: "common.capabilityApproach" };
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
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
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
      setNotice(t("baselineConfirmed"));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("baselineFailed"));
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
      setNotice(t("amended", { version: r.data.version }));
      setForm({ note: "", entryScope: "", purpose: "", kpis: "" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("amendFailed"));
    } finally {
      setBusy(false);
    }
  }

  const versions = [...(data?.versions ?? [])].sort((a, b) => b.version - a.version);
  const latest = versions[0];

  return (
    <main>
      <StageTabs projectId={projectId} />
      {/* Charter lives under the S12 tab group and feeds S11, so its tagline/rail follow S12 (not S8's "돈이 되는가?"). */}
      <StageFrame stageId="S12" subtitle={t("stageHeading")}>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("intro")}
          {data && (
            <>
              {" — "}
              {data.charter_confirmed_at ? (
                <span className="status-chip status-green">{t("confirmedChip", { date: data.charter_confirmed_at.slice(0, 10) })}</span>
              ) : (
                <span className="status-chip status-amber">{t("unconfirmedChip")}</span>
              )}
            </>
          )}
        </p>

        {canAct && data && latest && !data.charter_confirmed_at && (
          <div className="flex flex-wrap items-center gap-2 mt-2 mb-0">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void confirmBaseline()}>
              {busy ? t("confirming") : t("confirmBtn")}
            </button>
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("confirmHint")}
            </span>
          </div>
        )}

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}
        {!data && !error && <p className="text-[length:var(--fs-caption)]">{tc("loading")}</p>}

        {latest && (
          <section className="market-section sizing-step" aria-label={t("latestHeading", { version: latest.version })}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">
              {t("latestHeading", { version: latest.version })}
              <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {latest.source} · {latest.built_by} · {latest.built_at.slice(0, 10)}
              </span>
            </h3>
            <dl className="text-[length:var(--fs-caption)]" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 1rem" }}>
              <dt className="text-[color:var(--muted-fg)]">{t("dtPurpose")}</dt><dd>{latest.purpose}</dd>
              <dt className="text-[color:var(--muted-fg)]">{t("dtMarketScope")}</dt><dd>{latest.marketScope}</dd>
              <dt className="text-[color:var(--muted-fg)]">{t("dtValueChain")}</dt><dd>{latest.valueChainNode}</dd>
              <dt className="text-[color:var(--muted-fg)]">{t("dtTrack")}</dt>
              <dd>
                <span className={`status-chip ${latest.track === "brownfield" ? "status-amber" : "status-green"}`}>
                  {resolveLabelTokens(trackKeysText(latest.track, latest.subTrack), tr)}
                </span>
                {latest.track && (
                  <RawKey parts={trackKeyParts(latest.track, latest.subTrack).map((p2) => ({ label: "", raw: p2.raw, isFallback: p2.key === null }))} />
                )}
                {latest.intent && <span className="ml-1 text-[length:var(--fs-caption)]">{t("intentLine", { label: INTENT_KEY[latest.intent] ? tc(INTENT_KEY[latest.intent]) : latest.intent })}</span>}
                {latest.totalScore !== null && <span className="ml-1 tabular-nums text-[length:var(--fs-caption)]">{t("scoreLine", { score: latest.totalScore })}</span>}
              </dd>
              <dt className="text-[color:var(--muted-fg)]">{t("dtTrackRationale")}</dt><dd>{latest.trackRationale}</dd>
              <dt className="text-[color:var(--muted-fg)]">{t("dtEntryScope")}</dt><dd>{latest.entryScope}</dd>
            </dl>
          </section>
        )}

        {latest && latest.kpis.length > 0 && (
          <section className="market-section sizing-step mt-3" aria-label={t("kpiSectionAria")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("kpiHeading")}</h3>
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-32" aria-label={t("kpiSectionAria")}>
              <caption className="sr-only">{t("kpiCaption")}</caption>
              <ColGroup widths={KPI_COL_PCT} />
              <thead>
                <tr><th scope="col">{t("thKpi")}</th><th scope="col">{t("thKey")}</th><th scope="col">{t("thTarget")}</th></tr>
              </thead>
              <tbody>
                {latest.kpis.map((k) => (
                  <tr key={k.key}>
                    <td className="text-[length:var(--fs-caption)]">{k.label}</td>
                    <td className="text-[length:var(--fs-caption)] tabular-nums text-[color:var(--muted-fg)]">{k.key}</td>
                    <td className="text-[length:var(--fs-caption)] tabular-nums">{k.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
        )}

        {canAct && latest && (
          <section className="market-section sizing-step mt-3" aria-label={t("amendSectionAria")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("amendHeading")}</h3>
            <form className="sizing-new-form" onSubmit={amend}>
              <label className="block text-[length:var(--fs-caption)] mb-2">
                <span className="block mb-1">{t("lblNote")}</span>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} required className="sizing-new-input w-full" placeholder={t("phNote")} />
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]">
                  <span className="block mb-1">{t("lblEntryScope")}</span>
                  <input value={form.entryScope} onChange={(e) => setForm({ ...form, entryScope: e.target.value })} className="sizing-new-input w-full" />
                </label>
                <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]">
                  <span className="block mb-1">{t("lblPurpose")}</span>
                  <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="sizing-new-input w-full" />
                </label>
              </div>
              <label className="block text-[length:var(--fs-caption)] mb-2">
                <span className="block mb-1">{t("lblKpis")}</span>
                <textarea value={form.kpis} onChange={(e) => setForm({ ...form, kpis: e.target.value })} rows={3} className="sizing-new-input w-full" placeholder={t("phKpis")} />
              </label>
              <button type="submit" className="btn-ghost btn-sm" disabled={busy || !form.note.trim()}>
                {busy ? tc("recording") : t("amendBtn")}
              </button>
            </form>
          </section>
        )}

        {versions.length > 0 && (
          <section className="market-section sizing-step mt-3" aria-label={t("historyHeading")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("historyHeading")}</h3>
            <ul className="sizing-note-list">
              {versions.map((v) => (
                <li key={v.version}>
                  <strong>v{v.version}</strong>{" "}
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">
                    {v.source} · {v.built_by} · {v.built_at.slice(0, 10)}
                  </span>
                  {v.note && <span className="block text-[length:var(--fs-caption)]">{t("noteLine", { value: v.note })}</span>}
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
