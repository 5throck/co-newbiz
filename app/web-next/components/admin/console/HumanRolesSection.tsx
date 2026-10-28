"use client";

// Reviewer grants (second reviewer / stop-condition exception). Lists, issues and revokes grants; a refused
// issuance (for example a reviewer who would countersign their own GO) shows the server's localized text.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../../lib/api.ts";
import type { AdminConsoleState } from "./useAdminActions.ts";

interface Grant { id: string; user_id: string; role_key: string; granted_by: string; granted_at: string; revoked_at: string | null; revoked_by: string | null }
interface GrantsResponse { grants: Grant[]; grantable_roles: string[] }

export function HumanRolesPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.humanRoles");
  const { section, users, confirm } = ctx;
  const [data, setData] = useState<GrantsResponse | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const active = section === "users";
  const load = useCallback(() => {
    api.get<GrantsResponse>(`/api/admin/human-roles${showRevoked ? "?include_revoked=1" : ""}`).then((r) => setData(r.data)).catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : "" }));
  }, [showRevoked]);
  useEffect(() => { if (active) load(); }, [active, load]);
  if (!active) return null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: t("done") }); setUserId(""); setRole(""); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "" }); } finally { setBusy(false); load(); }
  }
  const roles = data?.grantable_roles ?? [];
  const roleLabel = (k: string) => (roles.includes(k) || k.endsWith("-ic-reviewer") ? t(`role.${k}` as never) : k);
  return (
    <section className="market-section mt-4" aria-label={t("heading")} data-testid="human-roles-panel">
      <h2 className=" font-semibold">{t("heading")}</h2>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("intro")}</p>
      {(data?.grants.length ?? 0) === 0 ? <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("empty")}</p> : (
        <div className="table-scroll" role="region" aria-label={t("heading")} tabIndex={0}>
          <table className="data-table" aria-label={t("heading")}>
            <caption className="sr-only">{t("heading")}</caption>
            <thead><tr><th scope="col">{t("colUser")}</th><th scope="col">{t("colRole")}</th><th scope="col">{t("colGranted")}</th><th scope="col">{t("colStatus")}</th><th scope="col">{t("colAction")}</th></tr></thead>
            <tbody>
              {data!.grants.map((g) => (
                <tr key={g.id}>
                  <td>{g.user_id}</td>
                  <td>{roleLabel(g.role_key)}</td>
                  <td className="text-[length:var(--fs-caption)]">{t("grantedBy", { by: g.granted_by, date: g.granted_at.slice(0, 10) })}</td>
                  <td>{g.revoked_at
                    ? <span className="status-chip status-not-started"><span aria-hidden="true">✕</span> {t("revoked")}<span className="sr-only"> {t("revokedBy", { by: g.revoked_by ?? "" })}</span></span>
                    : <span className="status-chip status-green"><span aria-hidden="true">●</span> {t("active")}</span>}</td>
                  <td>{!g.revoked_at && (
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={`${t("revoke")}: ${g.user_id} · ${roleLabel(g.role_key)}`}
                      onClick={() => confirm(t("confirmRevoke"), () => void run(() => api.post(`/api/admin/human-roles/${encodeURIComponent(g.id)}/revoke`, {})), { body: `${g.user_id} · ${roleLabel(g.role_key)}`, confirmLabel: t("revoke"), tone: "danger" })}>{t("revoke")}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label className="flex items-center gap-2 text-[length:var(--fs-caption)] mt-1"><input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />{t("showRevoked")}</label>
      <form className="sizing-new-form mt-3" aria-label={t("issue")} onSubmit={(e) => {
        e.preventDefault();
        if (!userId || !role) { setMsg({ ok: false, text: t("needBoth") }); return; }
        confirm(t("confirmIssue"), () => void run(() => api.post("/api/admin/human-roles", { user_id: userId, role_key: role })), { body: `${userId} · ${roleLabel(role)}` });
      }}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("issueUser")}</span>
            <select className="sizing-new-input sizing-new-input-sm" value={userId} onChange={(e) => setUserId(e.target.value)} aria-required="true">
              <option value="">{t("issueUserPlaceholder")}</option>
              {(users ?? []).filter((u) => u.status === "active" || u.status === "approved").map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name ? `${u.display_name} (${u.user_id})` : u.user_id}</option>)}
            </select>
          </label>
          <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("issueRole")}</span>
            <select className="sizing-new-input sizing-new-input-sm" value={role} onChange={(e) => setRole(e.target.value)} aria-required="true">
              <option value="">—</option>
              {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </label>
          <button type="submit" className="btn-ghost" disabled={busy}>{t("issue")}</button>
        </div>
      </form>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[length:var(--fs-caption)] mt-1 ${msg.ok ? "text-[color:var(--green-fg)]" : "text-[color:var(--red-fg)]"}`}>{msg.ok ? "✓" : "✕"} {msg.text}</p>}
    </section>
  );
}
