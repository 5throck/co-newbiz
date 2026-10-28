"use client";

// PMI 사후통합 (deal detail surface) — 핵심인력 잔존(pmi_key_talent)과
// 시너지 인증(pmi_synergy_certification)을 관리한다. /projects/[id] 하위
// 상세 화면으로 메뉴 등록 없이 StageTabs로 진입한다.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { useConfirm } from "../../../../components/crud.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { KEY_TALENT_STATUS_KEY } from "../../../../lib/label-keys.ts";
import { PMI_HIDDEN_NOTE, pmiErrorI18n } from "../../../../lib/post-management-view.ts";
import { resolveI18n } from "../../../../lib/execution-baseline-view.ts";
import { ColGroup } from "../../../../components/ui.tsx";

// 시너지 인증 6열 — 인증자·관리에 여유, 나머지는 날짜·수치 열로 좁게.
const PMI_CERT_COL_PCT = [20, 12, 18, 17, 17, 16] as const;

interface Talent {
  id: string;
  role_ref: string;
  status: string;
  exit_date: string | null;
  locked_at: string;
  created_at: string;
}
interface Certification {
  id: string;
  run_rate_bp: number;
  sustained_quarters: number;
  certified_by: string;
  baseline_locked_at: string;
  signed_at: string;
  created_at: string;
}

// pmi_key_talent.status allows exactly active | departed_regretted | departed_planned (DB CHECK).
const TALENT_STATUS_CLASS: Record<string, string> = { active: "status-green", departed_regretted: "status-red", departed_planned: "status-amber" };
const TALENT_STATUS_ICON: Record<string, string> = { active: "●", departed_regretted: "✕", departed_planned: "◐" };

function bpToPercent(bp: number): string {
  return `${(bp / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

export default function PmiPage() {
  const tr = useTranslations();
  const t = useTranslations("pages.projects.pmi");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  // ADR-0161: PMI writes are refused (403 not_applicable_track) for greenfield and non-PMI sub-tracks.
  const [pmiApplies, setPmiApplies] = useState<boolean | null>(null);
  const canAct = canWriteProject(me?.role) && pmiApplies !== false;
  const { confirm, confirmDialog } = useConfirm();
  const [talents, setTalents] = useState<Talent[] | null>(null);
  const [certs, setCerts] = useState<Certification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTalent, setNewTalent] = useState("");
  const [newCert, setNewCert] = useState({ run_rate_bp: "", sustained_quarters: "", baseline_locked_at: "" });

  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const load = useCallback(() => {
    Promise.all([
      api.get<{ talents: Talent[] }>(`${base}/pmi/key-talent`),
      api.get<{ certifications: Certification[] }>(`${base}/pmi/synergy-certifications`),
    ])
      .then(([talRes, certRes]) => { setTalents(talRes.data.talents); setCerts(certRes.data.certifications); })
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  }, [base]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<{ applicability: { pmi_applies: boolean } }>(`${base}/post-management`)
      .then((r) => setPmiApplies(r.data.applicability.pmi_applies))
      .catch(() => { /* unknown: keep today's behaviour; the server still guards every write */ });
  }, [base]);

  async function send(method: "post" | "put" | "delete", path: string, body?: unknown) {
    setBusy(true); setError(null);
    try {
      await api[method](`${base}${path}`, body);
      load();
    } catch (e) {
      setError(resolveI18n(pmiErrorI18n((e as { code?: string } | null)?.code, e instanceof Error ? e.message : undefined, t("saveFailed")), tr));
    } finally {
      setBusy(false);
    }
  }

  function addTalent() {
    if (!newTalent.trim()) { setError(t("errRoleRequired")); return; }
    void send("post", "/pmi/key-talent", { role_ref: newTalent.trim() });
    setNewTalent("");
  }

  function addCert() {
    const bp = Number(newCert.run_rate_bp);
    const q = Number(newCert.sustained_quarters);
    if (!Number.isInteger(bp) || bp <= 0 || !Number.isInteger(q) || q <= 0) {
      setError(t("errCertPositive")); return;
    }
    void send("post", "/pmi/synergy-certifications", {
      run_rate_bp: bp,
      sustained_quarters: q,
      baseline_locked_at: newCert.baseline_locked_at.trim() || undefined,
    });
    setNewCert({ run_rate_bp: "", sustained_quarters: "", baseline_locked_at: "" });
  }

  return (
    <main className="market-page">
      <StageTabs projectId={projectId} />
      <header className="mb-3">
        <h1 className="text-[1.05rem] font-semibold">{t("heading")}</h1>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          {t("intro")}
        </p>
      </header>

      {pmiApplies === false && (
        <p role="note" className="text-[length:var(--fs-caption)] mb-2" data-testid="pmi-not-applicable">
          <span className="status-chip status-not-started">{t("notApplicableChip")}</span>
          <span className="block mt-1 text-[color:var(--muted-fg)]">{PMI_HIDDEN_NOTE}</span>
        </p>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

      <section className="market-section mb-3" aria-label={t("talentSectionAria")}>
        <h2 className=" font-semibold mb-2">{t("talentHeading", { count: talents?.length ?? 0 })}</h2>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table">
            <caption className="sr-only">{t("captionTalent")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("thRole")}</th><th scope="col">{tc("status")}</th><th scope="col">{t("thExitDate")}</th>
                <th scope="col">{t("thCreated")}</th><th scope="col">{t("thManage")}</th>
              </tr>
            </thead>
            <tbody>
              {(talents ?? []).map((tal) => (
                <tr key={tal.id}>
                  <td>{tal.role_ref}</td>
                  <td><span className={`status-chip ${TALENT_STATUS_CLASS[tal.status] ?? "status-not-started"}`}>{TALENT_STATUS_ICON[tal.status] ?? "?"} {tr(KEY_TALENT_STATUS_KEY[tal.status] ?? tal.status)}</span></td>
                  <td>{tal.exit_date ? tal.exit_date.slice(0, 10) : "—"}</td>
                  <td>{tal.created_at.slice(0, 10)}</td>
                  <td>
                    {canAct && (
                      <span className="flex gap-1">
                        {tal.status !== "active" && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm(t("confirmReactivateTitle"), () => { void send("put", `/pmi/key-talent/${tal.id}`, { status: "active" }); }, { body: t("reactivateBody"), tone: "neutral", confirmLabel: t("reactivateConfirmLabel") })}>{t("reactivateBtn")}</button>
                        )}
                        {tal.status !== "departed_regretted" && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm(t("confirmRegretTitle"), () => { void send("put", `/pmi/key-talent/${tal.id}`, { status: "departed_regretted" }); }, { body: t("regretBody") })}>{t("regretBtn")}</button>
                        )}
                        {tal.status !== "departed_planned" && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm(t("confirmPlannedTitle"), () => { void send("put", `/pmi/key-talent/${tal.id}`, { status: "departed_planned" }); }, { body: t("plannedBody") })}>{t("plannedBtn")}</button>
                        )}
                        <button type="button" className="btn-ghost btn-sm" disabled={busy}
                          onClick={() => confirm(t("confirmDeleteTitle"), () => { void send("delete", `/pmi/key-talent/${tal.id}`); }, { body: t("deleteBody", { role: tal.role_ref }), confirmLabel: tc("delete") })}>{tc("delete")}</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {talents && talents.length === 0 && (
                <tr><td colSpan={5} className="text-[color:var(--muted-fg)]">{t("emptyTalents")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canAct && (
          <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
            <input className="sizing-new-input" placeholder={t("phTalent")} value={newTalent} onChange={(e) => setNewTalent(e.target.value)} />
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={addTalent}>{tc("register")}</button>
          </div>
        )}
      </section>

      <section className="market-section" aria-label={t("certSectionAria")}>
        <h2 className=" font-semibold mb-2">{t("certHeading", { count: certs?.length ?? 0 })}</h2>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-48">
            <caption className="sr-only">{t("captionCert")}</caption>
            <ColGroup widths={PMI_CERT_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("thRunRate")}</th><th scope="col">{t("thQuarters")}</th><th scope="col">{t("thCertifier")}</th>
                <th scope="col">{t("thBaseline")}</th><th scope="col">{t("thSigned")}</th><th scope="col">{t("thManage")}</th>
              </tr>
            </thead>
            <tbody>
              {(certs ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{bpToPercent(c.run_rate_bp)} ({c.run_rate_bp.toLocaleString("ko-KR")}bp)</td>
                  <td>{t("quartersCell", { n: c.sustained_quarters })}</td>
                  <td>{c.certified_by}</td>
                  <td>{c.baseline_locked_at.slice(0, 10)}</td>
                  <td>{c.signed_at.slice(0, 10)}</td>
                  <td>
                    {canAct && (
                      <button type="button" className="btn-ghost btn-sm" disabled={busy}
                        onClick={() => confirm(t("confirmReleaseTitle"), () => { void send("delete", `/pmi/synergy-certifications/${c.id}`); }, { body: t("releaseBody"), confirmLabel: t("releaseConfirmLabel") })}>{t("releaseBtn")}</button>
                    )}
                  </td>
                </tr>
              ))}
              {certs && certs.length === 0 && (
                <tr><td colSpan={6} className="text-[color:var(--muted-fg)]">{t("emptyCerts")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canAct && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("certSummary")}</summary>
            <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>{t("lblRunRate")}
                <input className="sizing-new-input" type="number" min={1} step={1} value={newCert.run_rate_bp}
                  onChange={(e) => setNewCert({ ...newCert, run_rate_bp: e.target.value })} />
              </label>
              <label>{t("lblQuarters")}
                <input className="sizing-new-input" type="number" min={1} step={1} value={newCert.sustained_quarters}
                  onChange={(e) => setNewCert({ ...newCert, sustained_quarters: e.target.value })} />
              </label>
              <label>{t("lblBaseline")}
                <input className="sizing-new-input" type="date" value={newCert.baseline_locked_at}
                  onChange={(e) => setNewCert({ ...newCert, baseline_locked_at: e.target.value })} />
              </label>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={addCert}>{t("certBtn")}</button>
            </div>
          </details>
        )}
      </section>

      {confirmDialog}
    </main>
  );
}
