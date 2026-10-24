"use client";

// WaiverPanel — S9 dd-waiver-review 활동의 표준 UI (skills/waiver-management).
// 요청(pending) → 승인(active) / 기각(rejected) / 철회(revoked), 만료는 날짜가
// 권위(ADR-0036) — 읽기 시점에 파생되어 'expired'로 표시된다(컬럼 재작성 없음).
// 경계 #2: 승인 권한 라우팅(규정 계층→그룹 투자심의위원회, 절차→PGM, 체크리스트→도메인 리드)은
// 프로세스 규율이며, 이 패널은 인간 판정을 기록한다.
import { TranslatorFn } from "../i18n/config.ts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteProject } from "../lib/project-write-access.ts";
import { useConfirm } from "./crud.tsx";
import { ColGroup } from "./ui.tsx";
import { useTranslations } from "next-intl";

// waiver 목록 — 규정·조항/사유/요청·승인이 긴 텍스트라 고정 비율 유지 (작업 열은 canAct일 때만).
const WAIVER_COL_PCT = [22, 12, 26, 20, 10, 10] as const;
const WAIVER_RO_COL_PCT = [24, 13, 29, 22, 12] as const;

interface WaiverRow {
  id: string;
  governance_doc_id: string;
  clause_ref: string;
  reason: string;
  requested_by: string;
  approver_role: string;
  approved_by: string | null;
  approved_at: string | null;
  expires_at: string;
  status: string;
  created_at: string;
  effective_status: "pending" | "active" | "expired" | "rejected" | "revoked";
}
interface GovernanceDocRef { id: string; layer: string; key: string; title: string }

const STATUS_META = (tr: TranslatorFn): Record<WaiverRow["effective_status"], { icon: string; label: string; cls: string }> => ({
  active: { icon: "✓", label: "components.waiver.panel.active", cls: "status-green" },
  pending: { icon: "◐", label: "components.waiver.panel.awaitingApproval", cls: "status-amber" },
  expired: { icon: "◌", label: "components.waiver.panel.expires", cls: "status-chip" },
  rejected: { icon: "✕", label: "common.dismiss", cls: "status-red" },
  revoked: { icon: "✕", label: "common.withdraw", cls: "status-red" },
});

export interface WaiverPrefill { clause: string; reason?: string; checklist_id?: string; item_id?: string }

/** The waiver request form - shared by the panel and the per-row dialog on S9. Layout wraps (auto-fit), never overlaps. */
export function WaiverRequestForm({ projectId, docs, prefill, targetId, onDone, onCancel }: {
  projectId: string;
  docs: GovernanceDocRef[];
  prefill?: WaiverPrefill | null;
  /** ADR-0157: an opened comparison target; omitted = the selected-target scope the gate judges. */
  targetId?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {const t = useTranslations("components.waiver.panel"); const tc = useTranslations("common");
  const [form, setForm] = useState({ doc: "", clause: prefill?.clause ?? "", reason: prefill?.reason ?? "", approverRole: "process-governance-manager", expiresAt: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // dd_item 요청(행 prefll 아님, R2-E)에서는 조항이 서버 파생이고 사유도 서버 기본값이 있어 필수가 아니다.
  const ddMode = Boolean(prefill?.checklist_id && prefill?.item_id);
  const missing = [!form.doc && t("policyDocuments"), !ddMode && !form.clause.trim() && t("clause"), !ddMode && !form.reason.trim() && tc("reason"), !form.expiresAt && t("expiryDate")].filter(Boolean) as string[];
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/waivers`, {
        governance_doc_id: form.doc,
        clause_ref: ddMode ? undefined : form.clause,
        reason: form.reason,
        dd_item: ddMode
          ? { checklist_id: prefill!.checklist_id!, item_id: prefill!.item_id! }
          : undefined,
        approver_role: form.approverRole,
        expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : "",
        target_id: targetId ?? undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("waiverRequestFailed"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="sizing-new-form mb-4" role="group" aria-label={t("requestWaiver")}>
      {error && <p role="alert" className="text-[length:var(--fs-caption)] mb-2" style={{ color: "var(--red-fg)" }}>{error}</p>}
      <div className="waiver-grid">
        <label className="text-[length:var(--fs-caption)]">
          {t("policyDocuments2")}
          <select className="sizing-new-input mt-1 w-full" value={form.doc} onChange={(e) => setForm((f) => ({ ...f, doc: e.target.value }))}>
            <option value="">{t("item")}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>{`[${d.layer}] ${d.key} — ${d.title}`}</option>
            ))}
          </select>
        </label>
        <label className="text-[length:var(--fs-caption)]">
          {t("clause2")}
          <input className="sizing-new-input mt-1 w-full" value={form.clause} onChange={(e) => setForm((f) => ({ ...f, clause: e.target.value }))} placeholder={t("eG1")} />
        </label>
        <label className="text-[length:var(--fs-caption)]">
          {t("expiryDateRequired")}
          <input type="date" className="sizing-new-input mt-1 w-full" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
        </label>
      </div>
      <label className="text-[length:var(--fs-caption)] block mt-2">
        {tc("reason")}
        <textarea className="sizing-new-input mt-1 w-full" rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t("whyThisClauseShouldBe")} />
      </label>
      <label className="text-[length:var(--fs-caption)] block mt-2">
        {t("approvalRolesPolicyHierarchyGroup")}
        <input className="sizing-new-input mt-1 w-full" value={form.approverRole} onChange={(e) => setForm((f) => ({ ...f, approverRole: e.target.value }))} />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
        {missing.length > 0 && <span id="waiver-req-reason" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("toRequest")} {missing.join(", ")}{t("enterIt")}</span>}
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>{tc("cancel")}</button>
        <button type="button" className="btn-premium btn-sm" disabled={saving || missing.length > 0} aria-describedby={missing.length > 0 ? "waiver-req-reason" : undefined} onClick={() => void submit()}>
          {t("request")}
        </button>
      </div>
    </div>
  );
}

export function WaiverPanel({ projectId, prefill, onRequested, targetId }: { projectId: string; prefill?: WaiverPrefill | null; onRequested?: () => void; targetId?: string | null }) {const tr = useTranslations(); const t = useTranslations("components.waiver.panel"); const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [waivers, setWaivers] = useState<WaiverRow[]>([]);
  const [docs, setDocs] = useState<GovernanceDocRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // A row-level "면제 요청" prefills and opens the form (R2-B item 5).
  useEffect(() => { if (prefill) setShowForm(true); }, [prefill]);

  const basePath = `/api/projects/${encodeURIComponent(projectId)}/waivers`;

  const load = useCallback(() => {
    api.get<{ waivers: WaiverRow[]; governanceDocs: GovernanceDocRef[] }>(targetId ? `${basePath}?target_id=${encodeURIComponent(targetId)}` : basePath)
      .then((r) => { setWaivers(r.data.waivers); setDocs(r.data.governanceDocs); })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheWaiver")));
  }, [basePath, targetId]);
  useEffect(() => { load(); }, [load]);

  const decide = (id: string, decision: "approve" | "reject" | "revoke") => {
    const run = async () => {
      setSaving(true); setError(null);
      try {
        await api.patch(`${basePath}/${encodeURIComponent(id)}`, { decision });
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("waiverJudgementFailed"));
      } finally {
        setSaving(false);
      }
    };
    if (decision === "approve") { void run(); return; }
    confirm(
      decision === "reject" ? t("dismissWaiver") : t("withdrawWaiver"),
      () => void run(),
      { body: decision === "reject" ? t("dismissThisRequest") : t("withdrawTheActiveWaiverWithdraw"), confirmLabel: decision === "reject" ? tc("dismiss") : tc("withdraw") },
    );
  };

  return (
    <section className="glass p-4" aria-label={t("waiverManagement")}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-label">{t("waiverManagementS9")}</h3>
        {canAct && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setShowForm((v) => !v)} disabled={saving}>
            {showForm ? tc("close") : t("requestWaiver2")}
          </button>
        )}
      </div>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
        {t("unmetRequiredItemsCannotPass")}
      </p>
      {error && <p className="text-[length:var(--fs-caption)] mb-2" style={{ color: "var(--red-fg)" }}>{error}</p>}

      {showForm && canAct && (
        <WaiverRequestForm
          projectId={projectId}
          docs={docs}
          prefill={prefill}
          targetId={targetId}
          onDone={() => { setShowForm(false); load(); onRequested?.(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {waivers.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{t("noWaiversRegistered")}</p>
      ) : (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-56">
            <caption className="sr-only">{t("projectWaiverListEffectiveStatus")}</caption>
            <ColGroup widths={canAct ? WAIVER_COL_PCT : WAIVER_RO_COL_PCT} />
            <thead>
              <tr>
                <th className="col-label">{t("rulesAndClauses")}</th><th>{tc("status")}</th><th className="col-text">{tc("reason")}</th><th>{t("requestAndApproval")}</th><th className="col-num">{t("expires2")}</th>{canAct && <th><span className="sr-only">{tc("actions")}</span></th>}
              </tr>
            </thead>
            <tbody>
              {waivers.map((w) => {
                const doc = docs.find((d) => d.id === w.governance_doc_id);
                const meta = STATUS_META(tr)[w.effective_status];
                return (
                  <tr key={w.id}>
                    <td className="col-label">{(doc ? doc.key : w.governance_doc_id) + " " + w.clause_ref}</td>
                    <td><span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                    <td className="col-text">{w.reason}</td>
                    <td>
                      <span className="text-[length:var(--fs-caption)]">{w.requested_by}</span>
                      {w.approved_by && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> → {w.approved_by}</span>}
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("approvingRole")} {w.approver_role}</span>
                    </td>
                    <td className="col-num">{w.expires_at.slice(0, 10)}</td>
                    {canAct && (
                      <td>
                        <span className="actions-row">
                          {w.effective_status === "pending" && (
                            <>
                              <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => decide(w.id, "approve")}>{tc("approve")}</button>
                              <button type="button" className="btn-danger btn-sm" disabled={saving} onClick={() => decide(w.id, "reject")}>{tc("dismiss")}</button>
                            </>
                          )}
                          {w.effective_status === "active" && (
                            <button type="button" className="btn-danger btn-sm" disabled={saving} onClick={() => decide(w.id, "revoke")}>{tc("withdraw")}</button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
