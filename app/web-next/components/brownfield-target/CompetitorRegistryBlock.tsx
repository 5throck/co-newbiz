"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { useState, useCallback, useEffect } from "react";
import { api } from "../../lib/api.ts";

// ── 경쟁사 레지스트리 블록 (ADR-0142 후속) — md_company 주체 관리 표면.
// 확정 목록·payload 제안 수용·수작업 등록·제외/복원을 이 화면에서 끝낸다.
// 수용·등록은 사람의 행위(경계 #2) — 제안은 어디까지나 제안이다.
export function CompetitorRegistryBlock({ companyId, payloadCompetitors }: {
  companyId: string;
  payloadCompetitors: Array<{ name: string; note: string }>;
}) {
  interface Row { id: string; name: string; dart_corp_code: string | null; note: string | null; status: "confirmed" | "excluded"; exclusion_reason: string | null; discovery_source: "manual" | "ai_proposal"; proposal_accepted_at: string; crosscheck_verdict: string | null }
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<{ id: string; reason: string } | null>(null);
  const [form, setForm] = useState({ name: "", dart_corp_code: "", note: "" });

  const load = useCallback(() => {
    api.get<{ competitors: Row[] }>(`/api/companies/${encodeURIComponent(companyId)}/competitors?includeExcluded=1`)
      .then((r) => setRows(r.data.competitors ?? []))
      .catch(() => setRows([]));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const confirmed = (rows ?? []).filter((r) => r.status === "confirmed");
  const excluded = (rows ?? []).filter((r) => r.status === "excluded");
  const confirmedNames = new Set(confirmed.map((c) => c.name));
  const openProposals = payloadCompetitors.filter((p) => !confirmedNames.has(p.name));

  async function post(url: string, body: unknown) {
    setBusy(true); setError(null);
    try {
      await api.post(url, body);
      load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
      return false;
    } finally { setBusy(false); }
  }

  return (
    <div className="market-section mt-2">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h4 className="text-[0.88rem] font-semibold m-0">확정 경쟁사</h4>
        <span className="status-chip status-green">{confirmed.length}건</span>
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">AI 제안 수용 또는 수작업 등록으로만 생긴다 (ADR-0142)</span>
      </div>
      {error && <p role="alert" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{error}</p>}
      {confirmed.length === 0 ? (
        <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">아래 AI 제안을 수용하거나 직접 등록하세요.</p>
      ) : (
        <ul className="sizing-note-list mb-2">
          {confirmed.map((c) => (
            <li key={c.id}>
              <b>{c.name}</b> — {c.note || "—"}{" "}
              <span className={`status-chip ml-1 ${c.discovery_source === "ai_proposal" ? "status-in-progress" : "status-not-started"}`}>{c.discovery_source === "ai_proposal" ? "AI 제안 수용" : "수작업"}</span>
              {excluding?.id === c.id ? (
                <span className="actions-row ml-2">
                  <input value={excluding.reason} onChange={(e) => setExcluding({ ...excluding, reason: e.target.value })} className="sizing-new-input" style={{ width: "10rem" }} placeholder="제외 사유 *" aria-label="제외 사유" />
                  <button type="button" className="btn-danger btn-sm" disabled={busy || !excluding.reason.trim()} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors/${encodeURIComponent(c.id)}/exclude`, { reason: excluding.reason.trim() }).then((ok) => { if (ok) setExcluding(null); })}>확인</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setExcluding(null)}>취소</button>
                </span>
              ) : !canAct ? null : (
                <button type="button" className="btn-ghost btn-sm ml-1" onClick={() => setExcluding({ id: c.id, reason: "" })}>제외</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {excluded.length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">제외됨 {excluded.length}건</summary>
          <ul className="sizing-note-list">
            {excluded.map((c) => (
              <li key={c.id}>{c.name} — {c.exclusion_reason ?? "사유 없음"}{" "}
                {canAct && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors/${encodeURIComponent(c.id)}/restore`, {})}>복원</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {openProposals.length > 0 && (
        <div className="mb-2">
          <p className="text-[length:var(--fs-caption)] font-semibold mb-1">AI 제안 (미확정) {openProposals.length}건</p>
          <ul className="sizing-note-list mb-0">
            {openProposals.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b> — {p.note || "—"}{" "}
                {canAct && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors`, { name: p.name, note: p.note || null, discovery_source: "ai_proposal" })}>수용</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canAct && <div className="flex flex-wrap items-center gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="sizing-new-input" style={{ width: "12rem" }} placeholder="경쟁사명 *" aria-label="경쟁사명" />
        <input value={form.dart_corp_code} onChange={(e) => setForm({ ...form, dart_corp_code: e.target.value })} className="sizing-new-input" style={{ width: "9rem" }} placeholder="DART 고유번호 (선택)" aria-label="경쟁사 DART 고유번호" />
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 10rem" }} placeholder="경쟁 관계 (선택)" aria-label="경쟁 관계" />
        <button type="button" className="btn-ghost btn-sm" disabled={busy || !form.name.trim()} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors`, { name: form.name, dart_corp_code: form.dart_corp_code || null, note: form.note || null, discovery_source: "manual" }).then((ok) => { if (ok) setForm({ name: "", dart_corp_code: "", note: "" }); })}>등록</button>
      </div>}
    </div>
  );
}