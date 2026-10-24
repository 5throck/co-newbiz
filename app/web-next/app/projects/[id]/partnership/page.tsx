"use client";

// 파트너 검토·JV (deal detail surface) — 파트너 후보(partner_candidate)와
// 실사 지적사항(partner_dd_finding), 그리고 파트너별 JV 조건(jv_term)을
// 한 화면에서 관리한다. /projects/[id] 하위 상세 화면으로 메뉴 등록
// 없이 StageTabs로 진입한다 (navigation.ts NON_MENU_ROUTES).
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { ColGroup } from "../../../../components/ui.tsx";

// 파트너 후보 12열 — 후보명·컴플라이언스 리스크·관리에 여유, 점수·상태·NDA는 좁게.
const PARTNER_COL_PCT = [13, 7, 7, 7, 7, 7, 8, 14, 9, 7, 7, 7] as const;
// JV 조건 9열 — 파트너에 여유, JSON·조항 텍스트 열에 균등한 몫.
const JV_TERM_COL_PCT = [12, 10, 12, 12, 12, 12, 10, 10, 10] as const;

interface Finding {
  id: string;
  partner_id: string;
  workstream: string;
  severity: string;
  description: string;
  created_at: string;
}
interface Partner {
  id: string;
  name: string;
  partner_type: string;
  region_code: string | null;
  capability_score: number | null;
  capacity_score: number | null;
  financial_score: number | null;
  compliance_risk: string | null;
  customer_base_fit: number | null;
  dependency_risk: string | null;
  status: string;
  nda_signed: number;
  evidence_ref: string | null;
  findings: Finding[];
}
interface JvTerm {
  id: string;
  partner_id: string;
  partner_name: string;
  equity_split: string | null;
  governance_json: string | null;
  veto_matters: string | null;
  contribution_json: string | null;
  exit_clause: string | null;
  deadlock_mechanism: string | null;
  non_compete_scope: string | null;
}
interface View { partners: Partner[]; terms: JvTerm[] }

const STATUS_KEY: Record<string, string> = {
  sourcing: "statusSourcing", contacted: "statusContacted", nda: "statusNda", dd: "statusDd", term_sheet: "statusTermSheet", selected: "statusSelected", dropped: "statusDropped",
};
const STATUS_CLASS: Record<string, string> = {
  sourcing: "status-not-started", contacted: "status-in-progress", nda: "status-in-progress",
  dd: "status-in-progress", term_sheet: "status-in-progress", selected: "status-green", dropped: "status-red",
};
const SEVERITY_KEY: Record<string, string> = { high: "severityHigh", medium: "severityMedium", low: "severityLow" };
const SEVERITY_CLASS: Record<string, string> = { high: "status-red", medium: "status-amber", low: "status-not-started" };

const emptyNew = {
  name: "", partner_type: "", region_code: "", capability_score: "", capacity_score: "",
  financial_score: "", customer_base_fit: "", compliance_risk: "", dependency_risk: "", evidence_ref: "",
};

export default function PartnershipPage() {
  const t = useTranslations("pages.projects.partnership");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPartner, setNewPartner] = useState(emptyNew);
  const [newFinding, setNewFinding] = useState<Record<string, { workstream: string; severity: string; description: string }>>({});
  const [newTerm, setNewTerm] = useState({ partner_id: "", equity_split: "", veto_matters: "", exit_clause: "", deadlock_mechanism: "", non_compete_scope: "" });

  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const load = useCallback(() => {
    Promise.all([
      api.get<{ partners: Partner[] }>(`${base}/partners`),
      api.get<{ terms: JvTerm[] }>(`${base}/jv-terms`),
    ])
      .then(([p, t]) => setData({ partners: p.data.partners, terms: t.data.terms }))
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  }, [base]);
  useEffect(() => { load(); }, [load]);

  async function send(method: "post" | "put" | "delete", path: string, body?: unknown) {
    setBusy(true); setError(null);
    try {
      await api[method](`${base}${path}`, body);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function addPartner() {
    if (!newPartner.name.trim() || !newPartner.partner_type.trim()) {
      setError(t("errPartnerRequired")); return;
    }
    const numOrNull = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
    void send("post", "/partners", {
      name: newPartner.name.trim(),
      partner_type: newPartner.partner_type.trim(),
      region_code: newPartner.region_code.trim() || null,
      capability_score: numOrNull(newPartner.capability_score),
      capacity_score: numOrNull(newPartner.capacity_score),
      financial_score: numOrNull(newPartner.financial_score),
      customer_base_fit: numOrNull(newPartner.customer_base_fit),
      compliance_risk: newPartner.compliance_risk.trim() || null,
      dependency_risk: newPartner.dependency_risk.trim() || null,
      evidence_ref: newPartner.evidence_ref.trim() || null,
    });
    setNewPartner(emptyNew);
  }

  function addFinding(partnerId: string) {
    const f = newFinding[partnerId];
    if (!f?.workstream.trim() || !f?.description.trim()) {
      setError(t("errFindingRequired")); return;
    }
    void send("post", `/partners/${partnerId}/findings`, { workstream: f.workstream.trim(), severity: f.severity || "medium", description: f.description.trim() });
    setNewFinding({ ...newFinding, [partnerId]: { workstream: "", severity: "medium", description: "" } });
  }

  function addTerm() {
    if (!newTerm.partner_id) { setError(t("errTermPartner")); return; }
    void send("post", "/jv-terms", {
      partner_id: newTerm.partner_id,
      equity_split: newTerm.equity_split.trim() || null,
      veto_matters: newTerm.veto_matters.trim() || null,
      exit_clause: newTerm.exit_clause.trim() || null,
      deadlock_mechanism: newTerm.deadlock_mechanism.trim() || null,
      non_compete_scope: newTerm.non_compete_scope.trim() || null,
    });
    setNewTerm({ partner_id: "", equity_split: "", veto_matters: "", exit_clause: "", deadlock_mechanism: "", non_compete_scope: "" });
  }

  return (
    <main className="market-page">
      <StageTabs projectId={projectId} />
      <header className="mb-3">
        <h1 className="text-[1.05rem] font-semibold">{t("h1")}</h1>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          {t("intro")}
        </p>
      </header>

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

      <section className="market-section mb-3" aria-label={t("partnerSection")}>
        <div className="section-toolbar">
          <h2 className="text-[length:var(--fs-body)] font-semibold">{t("partnerHeading", { p1: data?.partners.length ?? 0 })}</h2>
        </div>
        <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-64">
            <caption className="sr-only">{t("partnerTableCaption")}</caption>
            <ColGroup widths={PARTNER_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colName")}</th><th scope="col">{t("colType")}</th><th scope="col">{t("colRegion")}</th>
                <th scope="col">{t("colCapability")}</th><th scope="col">{t("colCapacity")}</th><th scope="col">{t("colFinancial")}</th>
                <th scope="col">{t("colCustomerFit")}</th><th scope="col">{t("colComplianceRisk")}</th>
                <th scope="col">{tc("status")}</th><th scope="col">NDA</th><th scope="col">{t("colFindings")}</th><th scope="col">{t("colManage")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.partners ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.partner_type}</td>
                  <td>{p.region_code ?? "—"}</td>
                  <td>{p.capability_score ?? "—"}</td>
                  <td>{p.capacity_score ?? "—"}</td>
                  <td>{p.financial_score ?? "—"}</td>
                  <td>{p.customer_base_fit ?? "—"}</td>
                  <td>{p.compliance_risk ?? "—"}</td>
                  <td><span className={`status-chip ${STATUS_CLASS[p.status] ?? "status-not-started"}`}>{STATUS_KEY[p.status] ? t(STATUS_KEY[p.status]) : p.status}</span></td>
                  <td>{p.nda_signed === 1 ? t("ndaSigned") : t("ndaUnsigned")}</td>
                  <td>{t("countSuffix", { p1: p.findings.length })}</td>
                  <td>
                    {canAct && (
                      <span className="flex gap-1">
                        <button type="button" className="btn-ghost btn-sm" disabled={busy}
                          onClick={() => confirm(t("deletePartnerTitle"), () => { void send("delete", `/partners/${p.id}`); }, { body: t("deletePartnerBody", { p1: p.name }), confirmLabel: tc("delete") })}>{tc("delete")}</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.partners.length === 0 && (
                <tr><td colSpan={12} className="text-[color:var(--muted-fg)]">{t("emptyPartners")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {canAct && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("registerPartner")}</summary>
            <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>{t("lblName")}<input className="sizing-new-input" value={newPartner.name} onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} /></label>
              <label>{t("lblType")}<input className="sizing-new-input" placeholder={t("phType")} value={newPartner.partner_type} onChange={(e) => setNewPartner({ ...newPartner, partner_type: e.target.value })} /></label>
              <label>{t("lblRegion")}<input className="sizing-new-input" value={newPartner.region_code} onChange={(e) => setNewPartner({ ...newPartner, region_code: e.target.value })} /></label>
              <label>{t("lblCapabilityScore")}<input className="sizing-new-input" type="number" step="0.1" value={newPartner.capability_score} onChange={(e) => setNewPartner({ ...newPartner, capability_score: e.target.value })} /></label>
              <label>{t("lblCapacityScore")}<input className="sizing-new-input" type="number" step="0.1" value={newPartner.capacity_score} onChange={(e) => setNewPartner({ ...newPartner, capacity_score: e.target.value })} /></label>
              <label>{t("lblFinancialScore")}<input className="sizing-new-input" type="number" step="0.1" value={newPartner.financial_score} onChange={(e) => setNewPartner({ ...newPartner, financial_score: e.target.value })} /></label>
              <label>{t("lblCustomerFit")}<input className="sizing-new-input" type="number" step="0.1" value={newPartner.customer_base_fit} onChange={(e) => setNewPartner({ ...newPartner, customer_base_fit: e.target.value })} /></label>
              <label>{t("lblCompliance")}<input className="sizing-new-input" value={newPartner.compliance_risk} onChange={(e) => setNewPartner({ ...newPartner, compliance_risk: e.target.value })} /></label>
              <label>{t("lblDependency")}<input className="sizing-new-input" value={newPartner.dependency_risk} onChange={(e) => setNewPartner({ ...newPartner, dependency_risk: e.target.value })} /></label>
              <label>{t("lblEvidence")}<input className="sizing-new-input" value={newPartner.evidence_ref} onChange={(e) => setNewPartner({ ...newPartner, evidence_ref: e.target.value })} /></label>
            </div>
            <button type="button" className="btn-ghost btn-sm mt-2" disabled={busy} onClick={addPartner}>{t("registerCta")}</button>
          </details>
        )}
      </section>

      <section className="market-section mb-3" aria-label={t("findingsSection")}>
        <h2 className="text-[length:var(--fs-body)] font-semibold mb-2">{t("findingsHeading")}</h2>
        {(data?.partners ?? []).filter((p) => p.findings.length > 0).map((p) => (
          <div key={p.id} className="sizing-grade-card mb-2">
            <p className="text-[length:var(--fs-body)] font-semibold mb-1">{p.name}</p>
            <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
              <table className="data-table">
                <caption className="sr-only">{t("findingTableCaption", { p1: p.name })}</caption>
                <thead>
                  <tr><th scope="col">{t("colWorkstream")}</th><th scope="col">{t("colSeverity")}</th><th scope="col">{t("colDescription")}</th><th scope="col">{t("colRegisteredDate")}</th><th scope="col">{t("colManage")}</th></tr>
                </thead>
                <tbody>
                  {p.findings.map((f) => (
                    <tr key={f.id}>
                      <td>{f.workstream}</td>
                      <td><span className={`status-chip ${SEVERITY_CLASS[f.severity] ?? "status-not-started"}`}>{SEVERITY_KEY[f.severity] ? t(SEVERITY_KEY[f.severity]) : f.severity}</span></td>
                      <td>{f.description}</td>
                      <td>{f.created_at.slice(0, 10)}</td>
                      <td>
                        {canAct && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm(t("deleteFindingTitle"), () => { void send("delete", `/partners/${p.id}/findings/${f.id}`); }, { confirmLabel: tc("delete") })}>{tc("delete")}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canAct && (
              <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
                <input className="sizing-new-input text-[length:var(--fs-caption)]" style={{ maxWidth: "10rem" }} placeholder={t("phWorkstream")}
                  value={newFinding[p.id]?.workstream ?? ""} onChange={(e) => setNewFinding({ ...newFinding, [p.id]: { ...(newFinding[p.id] ?? { severity: "medium", description: "" }), workstream: e.target.value } })} />
                <select className="sizing-new-input text-[length:var(--fs-caption)]" value={newFinding[p.id]?.severity ?? "medium"}
                  onChange={(e) => setNewFinding({ ...newFinding, [p.id]: { ...(newFinding[p.id] ?? { workstream: "", description: "" }), severity: e.target.value } })}>
                  <option value="high">{t("severityHigh")}</option><option value="medium">{t("severityMedium")}</option><option value="low">{t("severityLow")}</option>
                </select>
                <input className="sizing-new-input text-[length:var(--fs-caption)] flex-1" style={{ minWidth: "16rem" }} placeholder={t("phFinding")}
                  value={newFinding[p.id]?.description ?? ""} onChange={(e) => setNewFinding({ ...newFinding, [p.id]: { ...(newFinding[p.id] ?? { workstream: "", severity: "medium" }), description: e.target.value } })} />
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => addFinding(p.id)}>{t("addFindingCta")}</button>
              </div>
            )}
          </div>
        ))}
        {data && data.partners.filter((p) => p.findings.length > 0).length === 0 && (
          <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("emptyFindings")}</p>
        )}
      </section>

      <section className="market-section" aria-label={t("termSection")}>
        <h2 className="text-[length:var(--fs-body)] font-semibold mb-2">{t("termHeading", { p1: data?.terms.length ?? 0 })}</h2>
        <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-64">
            <caption className="sr-only">{t("termTableCaption")}</caption>
            <ColGroup widths={JV_TERM_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colPartner")}</th><th scope="col">{t("colEquitySplit")}</th><th scope="col">{t("colGovernance")}</th>
                <th scope="col">{t("colVeto")}</th><th scope="col">{t("colContribution")}</th><th scope="col">{t("colExit")}</th>
                <th scope="col">{t("colDeadlock")}</th><th scope="col">{t("colNonCompete")}</th><th scope="col">{t("colManage")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.terms ?? []).map((term) => (
                <tr key={term.id}>
                  <td>{term.partner_name}</td>
                  <td>{term.equity_split ?? "—"}</td>
                  <td>{term.governance_json ? <code className="text-[length:var(--fs-caption)]">{term.governance_json}</code> : "—"}</td>
                  <td>{term.veto_matters ?? "—"}</td>
                  <td>{term.contribution_json ? <code className="text-[length:var(--fs-caption)]">{term.contribution_json}</code> : "—"}</td>
                  <td>{term.exit_clause ?? "—"}</td>
                  <td>{term.deadlock_mechanism ?? "—"}</td>
                  <td>{term.non_compete_scope ?? "—"}</td>
                  <td>
                    {canAct && (
                      <button type="button" className="btn-ghost btn-sm" disabled={busy}
                        onClick={() => confirm(t("deleteTermTitle"), () => { void send("delete", `/jv-terms/${term.id}`); }, { body: t("deleteTermBody", { p1: term.partner_name }), confirmLabel: tc("delete") })}>{tc("delete")}</button>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.terms.length === 0 && (
                <tr><td colSpan={9} className="text-[color:var(--muted-fg)]">{t("emptyTerms")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {canAct && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("registerTerm")}</summary>
            <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>{t("lblTermPartner")}
                <select className="sizing-new-input ml-1" value={newTerm.partner_id} onChange={(e) => setNewTerm({ ...newTerm, partner_id: e.target.value })}>
                  <option value="">—</option>
                  {(data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>{t("colEquitySplit")}<input className="sizing-new-input" placeholder={t("phEquitySplit")} value={newTerm.equity_split} onChange={(e) => setNewTerm({ ...newTerm, equity_split: e.target.value })} /></label>
              <label>{t("colExit")}<input className="sizing-new-input" value={newTerm.exit_clause} onChange={(e) => setNewTerm({ ...newTerm, exit_clause: e.target.value })} /></label>
              <label>{t("colDeadlock")}<input className="sizing-new-input" value={newTerm.deadlock_mechanism} onChange={(e) => setNewTerm({ ...newTerm, deadlock_mechanism: e.target.value })} /></label>
              <label>{t("lblNonCompeteScope")}<input className="sizing-new-input" value={newTerm.non_compete_scope} onChange={(e) => setNewTerm({ ...newTerm, non_compete_scope: e.target.value })} /></label>
            </div>
            <label className="block mt-2 text-[length:var(--fs-caption)]">{t("colVeto")}
              <input className="sizing-new-input w-full" value={newTerm.veto_matters} onChange={(e) => setNewTerm({ ...newTerm, veto_matters: e.target.value })} />
            </label>
            <button type="button" className="btn-ghost btn-sm mt-2" disabled={busy} onClick={addTerm}>{t("registerCta")}</button>
          </details>
        )}
      </section>

      {confirmDialog}
    </main>
  );
}
