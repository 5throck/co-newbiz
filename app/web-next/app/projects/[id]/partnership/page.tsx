"use client";

// 파트너 검토·JV (deal detail surface) — 파트너 후보(partner_candidate)와
// 실사 지적사항(partner_dd_finding), 그리고 파트너별 JV 조건(jv_term)을
// 한 화면에서 관리한다. /projects/[id] 하위 상세 화면으로 메뉴 등록
// 없이 StageTabs로 진입한다 (navigation.ts NON_MENU_ROUTES).
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
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

const STATUS_LABEL: Record<string, string> = {
  sourcing: "소싱", contacted: "접촉", nda: "NDA", dd: "실사", term_sheet: "조건서", selected: "선정", dropped: "탈락",
};
const STATUS_CLASS: Record<string, string> = {
  sourcing: "status-not-started", contacted: "status-in-progress", nda: "status-in-progress",
  dd: "status-in-progress", term_sheet: "status-in-progress", selected: "status-green", dropped: "status-red",
};
const SEVERITY_LABEL: Record<string, string> = { high: "높음", medium: "보통", low: "낮음" };
const SEVERITY_CLASS: Record<string, string> = { high: "status-red", medium: "status-amber", low: "status-not-started" };

const emptyNew = {
  name: "", partner_type: "", region_code: "", capability_score: "", capacity_score: "",
  financial_score: "", customer_base_fit: "", compliance_risk: "", dependency_risk: "", evidence_ref: "",
};

export default function PartnershipPage() {
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
      .catch((e) => setError(e instanceof Error ? e.message : "파트너 데이터를 불러오지 못했습니다."));
  }, [base]);
  useEffect(() => { load(); }, [load]);

  async function send(method: "post" | "put" | "delete", path: string, body?: unknown) {
    setBusy(true); setError(null);
    try {
      await api[method](`${base}${path}`, body);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  function addPartner() {
    if (!newPartner.name.trim() || !newPartner.partner_type.trim()) {
      setError("후보명과 제휴 유형은 필수입니다."); return;
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
      setError("워크스트림과 지적 내용은 필수입니다."); return;
    }
    void send("post", `/partners/${partnerId}/findings`, { workstream: f.workstream.trim(), severity: f.severity || "medium", description: f.description.trim() });
    setNewFinding({ ...newFinding, [partnerId]: { workstream: "", severity: "medium", description: "" } });
  }

  function addTerm() {
    if (!newTerm.partner_id) { setError("JV 조건을 등록할 파트너를 선택하세요."); return; }
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
        <h1 className="text-[1.05rem] font-semibold">파트너 검토·JV 조건</h1>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          제휴 파트너 후보와 실사 지적사항을 관리하고, 선정 파트너별 JV 조건(지분·거버넌스·엑싯)을 기록합니다.
        </p>
      </header>

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

      <section className="market-section mb-3" aria-label="파트너 후보">
        <div className="section-toolbar">
          <h2 className="text-[0.92rem] font-semibold">파트너 후보 ({data?.partners.length ?? 0}건)</h2>
        </div>
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-64">
            <caption className="sr-only">파트너 후보 목록</caption>
            <ColGroup widths={PARTNER_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">후보명</th><th scope="col">유형</th><th scope="col">지역</th>
                <th scope="col">역량</th><th scope="col">용량</th><th scope="col">재무</th>
                <th scope="col">고객 적합</th><th scope="col">컴플라이언스 리스크</th>
                <th scope="col">상태</th><th scope="col">NDA</th><th scope="col">지적사항</th><th scope="col">관리</th>
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
                  <td><span className={`status-chip ${STATUS_CLASS[p.status] ?? "status-not-started"}`}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                  <td>{p.nda_signed === 1 ? "서명" : "미서명"}</td>
                  <td>{p.findings.length}건</td>
                  <td>
                    {canAct && (
                      <span className="flex gap-1">
                        <button type="button" className="btn-ghost btn-sm" disabled={busy}
                          onClick={() => confirm("파트너 후보 삭제", () => { void send("delete", `/partners/${p.id}`); }, { body: `'${p.name}'과(와) 그 실사 지적사항이 삭제됩니다.`, confirmLabel: "삭제" })}>삭제</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.partners.length === 0 && (
                <tr><td colSpan={12} className="text-[color:var(--muted-fg)]">등록된 파트너 후보가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {canAct && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">파트너 후보 등록</summary>
            <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>후보명 (필수)<input className="sizing-new-input" value={newPartner.name} onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} /></label>
              <label>제휴 유형 (필수)<input className="sizing-new-input" placeholder="예: JV / 유통 / 기술제휴" value={newPartner.partner_type} onChange={(e) => setNewPartner({ ...newPartner, partner_type: e.target.value })} /></label>
              <label>지역<input className="sizing-new-input" value={newPartner.region_code} onChange={(e) => setNewPartner({ ...newPartner, region_code: e.target.value })} /></label>
              <label>역량 점수<input className="sizing-new-input" type="number" step="0.1" value={newPartner.capability_score} onChange={(e) => setNewPartner({ ...newPartner, capability_score: e.target.value })} /></label>
              <label>용량 점수<input className="sizing-new-input" type="number" step="0.1" value={newPartner.capacity_score} onChange={(e) => setNewPartner({ ...newPartner, capacity_score: e.target.value })} /></label>
              <label>재무 점수<input className="sizing-new-input" type="number" step="0.1" value={newPartner.financial_score} onChange={(e) => setNewPartner({ ...newPartner, financial_score: e.target.value })} /></label>
              <label>고객 적합도<input className="sizing-new-input" type="number" step="0.1" value={newPartner.customer_base_fit} onChange={(e) => setNewPartner({ ...newPartner, customer_base_fit: e.target.value })} /></label>
              <label>컴플라이언스 리스크<input className="sizing-new-input" value={newPartner.compliance_risk} onChange={(e) => setNewPartner({ ...newPartner, compliance_risk: e.target.value })} /></label>
              <label>의존도 리스크<input className="sizing-new-input" value={newPartner.dependency_risk} onChange={(e) => setNewPartner({ ...newPartner, dependency_risk: e.target.value })} /></label>
              <label>근거 참조<input className="sizing-new-input" value={newPartner.evidence_ref} onChange={(e) => setNewPartner({ ...newPartner, evidence_ref: e.target.value })} /></label>
            </div>
            <button type="button" className="btn-ghost btn-sm mt-2" disabled={busy} onClick={addPartner}>등록</button>
          </details>
        )}
      </section>

      <section className="market-section mb-3" aria-label="실사 지적사항">
        <h2 className="text-[0.92rem] font-semibold mb-2">파트너 실사 지적사항</h2>
        {(data?.partners ?? []).filter((p) => p.findings.length > 0).map((p) => (
          <div key={p.id} className="sizing-grade-card mb-2">
            <p className="text-[length:var(--fs-body)] font-semibold mb-1">{p.name}</p>
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table">
                <caption className="sr-only">{p.name} 실사 지적사항</caption>
                <thead>
                  <tr><th scope="col">워크스트림</th><th scope="col">심각도</th><th scope="col">내용</th><th scope="col">등록일</th><th scope="col">관리</th></tr>
                </thead>
                <tbody>
                  {p.findings.map((f) => (
                    <tr key={f.id}>
                      <td>{f.workstream}</td>
                      <td><span className={`status-chip ${SEVERITY_CLASS[f.severity] ?? "status-not-started"}`}>{SEVERITY_LABEL[f.severity] ?? f.severity}</span></td>
                      <td>{f.description}</td>
                      <td>{f.created_at.slice(0, 10)}</td>
                      <td>
                        {canAct && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm("지적사항 삭제", () => { void send("delete", `/partners/${p.id}/findings/${f.id}`); }, { confirmLabel: "삭제" })}>삭제</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canAct && (
              <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
                <input className="sizing-new-input text-[length:var(--fs-caption)]" style={{ maxWidth: "10rem" }} placeholder="워크스트림 (예: 재무)"
                  value={newFinding[p.id]?.workstream ?? ""} onChange={(e) => setNewFinding({ ...newFinding, [p.id]: { ...(newFinding[p.id] ?? { severity: "medium", description: "" }), workstream: e.target.value } })} />
                <select className="sizing-new-input text-[length:var(--fs-caption)]" value={newFinding[p.id]?.severity ?? "medium"}
                  onChange={(e) => setNewFinding({ ...newFinding, [p.id]: { ...(newFinding[p.id] ?? { workstream: "", description: "" }), severity: e.target.value } })}>
                  <option value="high">높음</option><option value="medium">보통</option><option value="low">낮음</option>
                </select>
                <input className="sizing-new-input text-[length:var(--fs-caption)] flex-1" style={{ minWidth: "16rem" }} placeholder="지적 내용"
                  value={newFinding[p.id]?.description ?? ""} onChange={(e) => setNewFinding({ ...newFinding, [p.id]: { ...(newFinding[p.id] ?? { workstream: "", severity: "medium" }), description: e.target.value } })} />
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => addFinding(p.id)}>지적사항 추가</button>
              </div>
            )}
          </div>
        ))}
        {data && data.partners.filter((p) => p.findings.length > 0).length === 0 && (
          <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">등록된 실사 지적사항이 없습니다 — 파트너 행에서 추가하세요.</p>
        )}
      </section>

      <section className="market-section" aria-label="JV 조건">
        <h2 className="text-[0.92rem] font-semibold mb-2">JV 조건 ({data?.terms.length ?? 0}건)</h2>
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-64">
            <caption className="sr-only">JV 조건 목록</caption>
            <ColGroup widths={JV_TERM_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">파트너</th><th scope="col">지분 구조</th><th scope="col">거버넌스</th>
                <th scope="col">거부권 사항</th><th scope="col">출자</th><th scope="col">엑싯 조항</th>
                <th scope="col">교착 해소</th><th scope="col">경업 금지</th><th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {(data?.terms ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.partner_name}</td>
                  <td>{t.equity_split ?? "—"}</td>
                  <td>{t.governance_json ? <code className="text-[length:var(--fs-caption)]">{t.governance_json}</code> : "—"}</td>
                  <td>{t.veto_matters ?? "—"}</td>
                  <td>{t.contribution_json ? <code className="text-[length:var(--fs-caption)]">{t.contribution_json}</code> : "—"}</td>
                  <td>{t.exit_clause ?? "—"}</td>
                  <td>{t.deadlock_mechanism ?? "—"}</td>
                  <td>{t.non_compete_scope ?? "—"}</td>
                  <td>
                    {canAct && (
                      <button type="button" className="btn-ghost btn-sm" disabled={busy}
                        onClick={() => confirm("JV 조건 삭제", () => { void send("delete", `/jv-terms/${t.id}`); }, { body: `'${t.partner_name}'의 JV 조건이 삭제됩니다.`, confirmLabel: "삭제" })}>삭제</button>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.terms.length === 0 && (
                <tr><td colSpan={9} className="text-[color:var(--muted-fg)]">등록된 JV 조건이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {canAct && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">JV 조건 등록</summary>
            <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>파트너 (필수)
                <select className="sizing-new-input ml-1" value={newTerm.partner_id} onChange={(e) => setNewTerm({ ...newTerm, partner_id: e.target.value })}>
                  <option value="">—</option>
                  {(data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>지분 구조<input className="sizing-new-input" placeholder="예: 51:49" value={newTerm.equity_split} onChange={(e) => setNewTerm({ ...newTerm, equity_split: e.target.value })} /></label>
              <label>엑싯 조항<input className="sizing-new-input" value={newTerm.exit_clause} onChange={(e) => setNewTerm({ ...newTerm, exit_clause: e.target.value })} /></label>
              <label>교착 해소<input className="sizing-new-input" value={newTerm.deadlock_mechanism} onChange={(e) => setNewTerm({ ...newTerm, deadlock_mechanism: e.target.value })} /></label>
              <label>경업 금지 범위<input className="sizing-new-input" value={newTerm.non_compete_scope} onChange={(e) => setNewTerm({ ...newTerm, non_compete_scope: e.target.value })} /></label>
            </div>
            <label className="block mt-2 text-[length:var(--fs-caption)]">거부권 사항
              <input className="sizing-new-input w-full" value={newTerm.veto_matters} onChange={(e) => setNewTerm({ ...newTerm, veto_matters: e.target.value })} />
            </label>
            <button type="button" className="btn-ghost btn-sm mt-2" disabled={busy} onClick={addTerm}>등록</button>
          </details>
        )}
      </section>

      {confirmDialog}
    </main>
  );
}
