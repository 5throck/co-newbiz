"use client";

// WaiverPanel — S9 dd-waiver-review 활동의 표준 UI (skills/waiver-management).
// 요청(pending) → 승인(active) / 기각(rejected) / 철회(revoked), 만료는 날짜가
// 권위(ADR-0036) — 읽기 시점에 파생되어 'expired'로 표시된다(컬럼 재작성 없음).
// 경계 #2: 승인 권한 라우팅(규정 계층→Group IC, 절차→PGM, 체크리스트→도메인 리드)은
// 프로세스 규율이며, 이 패널은 인간 판정을 기록한다.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteProject } from "../lib/project-write-access.ts";
import { useConfirm } from "./crud.tsx";

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

const STATUS_META: Record<WaiverRow["effective_status"], { icon: string; label: string; cls: string }> = {
  active: { icon: "✓", label: "활성", cls: "status-green" },
  pending: { icon: "◐", label: "승인 대기", cls: "status-amber" },
  expired: { icon: "◌", label: "만료", cls: "status-chip" },
  rejected: { icon: "✕", label: "기각", cls: "status-red" },
  revoked: { icon: "✕", label: "철회", cls: "status-red" },
};

export interface WaiverPrefill { clause: string; reason?: string }

/** The waiver request form - shared by the panel and the per-row dialog on S9. Layout wraps (auto-fit), never overlaps. */
export function WaiverRequestForm({ projectId, docs, prefill, onDone, onCancel }: {
  projectId: string;
  docs: GovernanceDocRef[];
  prefill?: WaiverPrefill | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ doc: "", clause: prefill?.clause ?? "", reason: prefill?.reason ?? "", approverRole: "process-governance-manager", expiresAt: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = [!form.doc && "규정 문서", !form.clause.trim() && "조항", !form.reason.trim() && "사유", !form.expiresAt && "만료일"].filter(Boolean) as string[];
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/waivers`, {
        governance_doc_id: form.doc,
        clause_ref: form.clause,
        reason: form.reason,
        approver_role: form.approverRole,
        expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : "",
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "waiver 요청 실패");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="sizing-new-form mb-4" role="group" aria-label="waiver 요청">
      {error && <p role="alert" className="text-[length:var(--fs-caption)] mb-2" style={{ color: "var(--red-fg)" }}>{error}</p>}
      <div className="waiver-grid">
        <label className="text-[length:var(--fs-caption)]">
          규정 문서
          <select className="sizing-new-input mt-1 w-full" value={form.doc} onChange={(e) => setForm((f) => ({ ...f, doc: e.target.value }))}>
            <option value="">선택…</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>{`[${d.layer}] ${d.key} — ${d.title}`}</option>
            ))}
          </select>
        </label>
        <label className="text-[length:var(--fs-caption)]">
          조항 (clause_ref)
          <input className="sizing-new-input mt-1 w-full" value={form.clause} onChange={(e) => setForm((f) => ({ ...f, clause: e.target.value }))} placeholder="예: §4-2.1" />
        </label>
        <label className="text-[length:var(--fs-caption)]">
          만료일 (필수)
          <input type="date" className="sizing-new-input mt-1 w-full" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
        </label>
      </div>
      <label className="text-[length:var(--fs-caption)] block mt-2">
        사유
        <textarea className="sizing-new-input mt-1 w-full" rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="왜 이 조항을 면제해야 하는가" />
      </label>
      <label className="text-[length:var(--fs-caption)] block mt-2">
        승인 역할 (규정 계층→Group IC · 절차→process-governance-manager · 체크리스트→도메인 리드)
        <input className="sizing-new-input mt-1 w-full" value={form.approverRole} onChange={(e) => setForm((f) => ({ ...f, approverRole: e.target.value }))} />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
        {missing.length > 0 && <span id="waiver-req-reason" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">요청하려면 {missing.join(", ")}을(를) 입력하세요.</span>}
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>취소</button>
        <button type="button" className="btn-premium btn-sm" disabled={saving || missing.length > 0} aria-describedby={missing.length > 0 ? "waiver-req-reason" : undefined} onClick={() => void submit()}>
          요청
        </button>
      </div>
    </div>
  );
}

export function WaiverPanel({ projectId, prefill, onRequested }: { projectId: string; prefill?: WaiverPrefill | null; onRequested?: () => void }) {
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
    api.get<{ waivers: WaiverRow[]; governanceDocs: GovernanceDocRef[] }>(basePath)
      .then((r) => { setWaivers(r.data.waivers); setDocs(r.data.governanceDocs); })
      .catch((e) => setError(e instanceof Error ? e.message : "waiver 목록 불러오기 실패"));
  }, [basePath]);
  useEffect(() => { load(); }, [load]);

  const decide = (id: string, decision: "approve" | "reject" | "revoke") => {
    const run = async () => {
      setSaving(true); setError(null);
      try {
        await api.patch(`${basePath}/${encodeURIComponent(id)}`, { decision });
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "waiver 판정 실패");
      } finally {
        setSaving(false);
      }
    };
    if (decision === "approve") { void run(); return; }
    confirm(
      decision === "reject" ? "waiver 기각" : "waiver 철회",
      () => void run(),
      { body: decision === "reject" ? "이 요청을 기각 처리하시겠습니까?" : "활성 waiver를 철회하시겠습니까? 정당성 상실 시에만 철회하세요 — 만료가 기본 집행 수단입니다.", confirmLabel: decision === "reject" ? "기각" : "철회" },
    );
  };

  return (
    <section className="glass p-4" aria-label="waiver 관리">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-label">Waiver 관리 (S9 dd-waiver-review)</h3>
        {canAct && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setShowForm((v) => !v)} disabled={saving}>
            {showForm ? "닫기" : "＋ waiver 요청"}
          </button>
        )}
      </div>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
        필수 항목 미충족은 활성 waiver 없이는 DD 진행을 통과할 수 없다. 만료일이 권위이며, 경과 시 상태와 무관하게 만료로 표시된다.
      </p>
      {error && <p className="text-[length:var(--fs-caption)] mb-2" style={{ color: "var(--red-fg)" }}>{error}</p>}

      {showForm && canAct && (
        <WaiverRequestForm
          projectId={projectId}
          docs={docs}
          prefill={prefill}
          onDone={() => { setShowForm(false); load(); onRequested?.(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {waivers.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">등록된 waiver가 없습니다.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">프로젝트 waiver 목록 — 실효 상태는 만료일 기준으로 파생</caption>
            <thead>
              <tr>
                <th className="col-label">규정·조항</th><th>상태</th><th className="col-text">사유</th><th>요청·승인</th><th className="col-num">만료</th>{canAct && <th><span className="sr-only">작업</span></th>}
              </tr>
            </thead>
            <tbody>
              {waivers.map((w) => {
                const doc = docs.find((d) => d.id === w.governance_doc_id);
                const meta = STATUS_META[w.effective_status];
                return (
                  <tr key={w.id}>
                    <td className="col-label">{(doc ? doc.key : w.governance_doc_id) + " " + w.clause_ref}</td>
                    <td><span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                    <td className="col-text">{w.reason}</td>
                    <td>
                      <span className="text-[length:var(--fs-caption)]">{w.requested_by}</span>
                      {w.approved_by && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> → {w.approved_by}</span>}
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">승인역할 {w.approver_role}</span>
                    </td>
                    <td className="col-num">{w.expires_at.slice(0, 10)}</td>
                    {canAct && (
                      <td>
                        <span className="actions-row">
                          {w.effective_status === "pending" && (
                            <>
                              <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => decide(w.id, "approve")}>승인</button>
                              <button type="button" className="btn-danger btn-sm" disabled={saving} onClick={() => decide(w.id, "reject")}>기각</button>
                            </>
                          )}
                          {w.effective_status === "active" && (
                            <button type="button" className="btn-danger btn-sm" disabled={saving} onClick={() => decide(w.id, "revoke")}>철회</button>
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
