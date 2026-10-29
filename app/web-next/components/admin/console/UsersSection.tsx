"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { api, ApiError } from "../../../lib/api.ts";
import { ListSearch, Pager, matchesQuery, usePaged, useAdminLabel } from "./admin-ui.tsx";

const USERS_PAGE_SIZE = 15;

interface UserEdit { userId: string; displayName: string; role: "admin" | "analyst" | "viewer"; status: string; original: { displayName: string; role: string; status: string } }

// 사용자 API 토큰 6열 — 라벨·스코프가 긴 텍스트라 table-scroll 안에서 고정 비율 유지.
const USER_TOKEN_COL_PCT = [24, 26, 13, 15, 12, 10] as const;

export function UsersNoticePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const { section, notice, noticePinned, setNoticePinned, setNotice, createUserAccount, newUserId, setNewUserId, newUserRole, setNewUserRole, showCreateUser, setShowCreateUser } = ctx;
  return (
    <>{section === "users" && (
        <div>
          {notice && noticePinned && (
            <p role="status" className="mb-2 p-2 border border-[color:var(--green-border)] bg-[color:var(--green-bg)] rounded-lg text-[color:var(--green-fg)]">
              {notice}
              <button type="button" className="btn-ghost ml-2" onClick={() => { setNoticePinned(false); setNotice(null); }}>
                {tc("confirm")}
              </button>
            </p>
          )}
          <div className="mb-3 flex justify-end">
            <button type="button" className={showCreateUser ? "btn-ghost" : "btn-primary"} aria-expanded={showCreateUser} onClick={() => setShowCreateUser((v) => !v)}>
              {t("addUserButton")}
            </button>
          </div>
          {showCreateUser && (
          <form onSubmit={createUserAccount} aria-label={t("createFormAria")} className="sizing-new-form mb-4">
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="text"
                aria-label={t("newUserIdAria")}
                placeholder="user@example.com"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                required
              />
              <select aria-label={t("roleAria")} value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as "analyst" | "viewer" | "admin")}>
                <option value="analyst">{label("role", "analyst")}</option>
                <option value="viewer">{label("role", "viewer")}</option>
                <option value="admin">{label("role", "admin")}</option>
              </select>
              <button type="submit" className="btn-primary" disabled={!!noticePinned}>
                {t("registerButton")}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowCreateUser(false)}>{tc("cancel")}</button>
            </div>
          </form>
          )}
        </div>
      )}</>
  );
}

export function UsersTablePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAdminLabel();
  const tl = useTranslations("admin.list");
  const { section, users, me, approve, userAction, resettingUser, toggleTokenPanel, tokenPanelUser, tokenLabel, setTokenLabel, tokenWrite, setTokenWrite, tokenBusy, issueUserToken, userTokens, revokeUserToken, setUsers } = ctx;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<UserEdit | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const filtered = useMemo(() => (users ?? []).filter((u) => matchesQuery(query, u.user_id, u.display_name, label("role", u.role))), [users, query, label]);
  const paged = usePaged(filtered, USERS_PAGE_SIZE);

  function startEdit(u: { user_id: string; display_name: string | null; role: "admin" | "analyst" | "viewer"; status: string }) {
    setEditMsg(null);
    const displayName = u.display_name ?? u.user_id;
    setEditing({ userId: u.user_id, displayName, role: u.role, status: u.status, original: { displayName, role: u.role, status: u.status } });
  }

  async function saveEdit() {
    if (!editing) return;
    const o = editing.original;
    const path = `/api/admin/users/${encodeURIComponent(editing.userId)}`;
    const name = editing.displayName.trim();
    const changed = name !== o.displayName || editing.role !== o.role || editing.status !== o.status;
    if (!changed) { setEditMsg({ ok: false, text: t("noChanges") }); return; }
    setEditBusy(true);
    setEditMsg(null);
    try {
      if (name !== o.displayName) await api.put(path, { action: "set_display_name", display_name: name });
      if (editing.role !== o.role) await api.put(path, { action: "set_role", role: editing.role });
      if (editing.status !== o.status) await api.put(path, { action: editing.status === "disabled" ? "disable" : "enable" });
      setEditMsg({ ok: true, text: t("updatedNotice", { p1: editing.userId }) });
      setEditing(null);
      setUsers(null);
    } catch (err) {
      setEditMsg({ ok: false, text: err instanceof ApiError || err instanceof Error ? err.message : t("updateFailed") });
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <>{section === "users" &&
        (users === null ? (
          <p>{tc("loading")}</p>
        ) : (
          <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchAria")} placeholder={t("searchPlaceholder")} />
          </div>
          {editMsg && <p role={editMsg.ok ? "status" : "alert"} className={editMsg.ok ? "text-[color:var(--green-fg)]" : "text-[color:var(--red-fg)]"}>{editMsg.text}</p>}
          {users.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{t("emptyUsers")}</p>
          ) : filtered.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p>
          ) : (
          <>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table list-table">
            <caption className="sr-only">{t("usersCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colUserId")}</th>
                <th scope="col">{t("colDisplayName")}</th>
                <th scope="col" className="w-[7rem]">{t("colRole")}</th>
                <th scope="col" className="w-[8rem]">{tc("status")}</th>
                <th scope="col" className="col-date">{t("colJoined")}</th>
                <th scope="col" className="w-[14rem]"><span className="sr-only">{tc("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((u) => (
                <Fragment key={u.user_id}>
                <tr>
                  <td>{u.user_id}</td>
                  <td>{u.display_name ?? "—"}</td>
                  <td>{label("role", u.role)}</td>
                  <td>
                    {u.status === "active" ? <span className="status-chip status-green">{label("userStatus", u.status)}</span>
                      : u.status === "pending" ? <span className="status-chip status-amber">{label("userStatus", u.status)}</span>
                      : <span className="status-chip status-not-started">{label("userStatus", u.status)}</span>}
                  </td>
                  <td className="col-date">{formatDate(u.created_at, locale)}</td>
                  <td className="sizing-actions-cell"><span className="actions-row">
                    {u.status === "pending" && (
                      <button type="button" className="btn-ghost btn-sm" aria-label={t("approveAria", { p1: u.user_id })} onClick={() => approve(u.user_id)}>
                        {t("approve")}
                      </button>
                    )}
                    <button type="button" className="btn-ghost btn-sm" aria-label={t("editAria", { p1: u.user_id })} aria-expanded={editing?.userId === u.user_id} onClick={() => (editing?.userId === u.user_id ? setEditing(null) : startEdit(u))}>
                      {t("editButton")}
                    </button>
                    {u.status !== "pending" && (
                      <button type="button" className="btn-ghost btn-sm" aria-label={t("resetAria", { p1: u.user_id })} disabled={resettingUser !== null} onClick={() => userAction(u.user_id, "reset_password")}>
                        {t("resetPassword")}
                      </button>
                    )}
                    <button type="button" className="btn-ghost btn-sm" aria-label={t("tokensAria", { p1: u.user_id })} onClick={() => toggleTokenPanel(u.user_id)}>
                      {t("tokensButton")}
                    </button>
                    <button type="button" className="btn-danger btn-sm" aria-label={t("deleteAria", { p1: u.user_id })} onClick={() => userAction(u.user_id, "delete")}>
                      {tc("delete")}
                    </button>
                  </span></td>
                </tr>
                {editing?.userId === u.user_id && (
                  <tr>
                    <td colSpan={6}>
                      <form
                        className="sizing-new-form"
                        aria-label={t("editFormAria")}
                        onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
                      >
                        <p className="m-0 mb-2 font-semibold">{t("editHeading", { p1: u.user_id })}</p>
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("displayNameLabel")}</span>
                            <input className="sizing-new-input sizing-new-input-sm" value={editing.displayName} maxLength={60} required onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} />
                          </label>
                          <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("roleLabel")}</span>
                            <select className="sizing-new-input sizing-new-input-sm" value={editing.role} disabled={u.user_id === me?.userId} onChange={(e) => setEditing({ ...editing, role: e.target.value as UserEdit["role"] })}>
                              <option value="admin">{label("role", "admin")}</option>
                              <option value="analyst">{label("role", "analyst")}</option>
                              <option value="viewer">{label("role", "viewer")}</option>
                            </select>
                          </label>
                          <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("statusLabel")}</span>
                            <select className="sizing-new-input sizing-new-input-sm" value={editing.status} disabled={u.user_id === me?.userId || u.status === "pending"} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                              {u.status === "pending" && <option value="pending">{label("userStatus", "pending")}</option>}
                              <option value="active">{label("userStatus", "active")}</option>
                              <option value="disabled">{label("userStatus", "disabled")}</option>
                            </select>
                          </label>
                          <button type="submit" className="btn-primary btn-sm" disabled={editBusy || !editing.displayName.trim()}>{editBusy ? tc("saving") : t("saveEdit")}</button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>{t("cancelEdit")}</button>
                        </div>
                        {(u.user_id === me?.userId || u.status === "pending") && (
                          <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {u.user_id === me?.userId ? t("selfHint") : t("pendingHint")}
                          </p>
                        )}
                      </form>
                    </td>
                  </tr>
                )}
                {tokenPanelUser === u.user_id && (
                  <tr>
                    <td colSpan={6}>
                      <div className="sizing-new-form">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <input
                            aria-label={t("tokenLabelAria")}
                            placeholder={t("tokenLabelPlaceholder")}
                            value={tokenLabel}
                            onChange={(e) => setTokenLabel(e.target.value)}
                            className="sizing-new-input sizing-new-input-sm"
                          />
                          <label className="text-[length:var(--fs-caption)] flex items-center gap-1">
                            <input type="checkbox" checked={tokenWrite} onChange={(e) => setTokenWrite(e.target.checked)} />
                            {t("writeScopeCheckbox")}
                          </label>
                          <button type="button" className="btn-ghost btn-sm" disabled={tokenBusy || !tokenLabel.trim()} onClick={() => issueUserToken(u.user_id)}>
                            {t("issueToken")}
                          </button>
                        </div>
                        {(userTokens[u.user_id] ?? []).length === 0 ? (
                          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-caption)] mb-0">{t("noTokens")}</p>
                        ) : (
                          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                          <table className="data-table table-fixed-pct tmin-48" aria-label={t("userTokensAria", { p1: u.user_id })}>
                            <caption className="sr-only">{t("userTokensCaption", { p1: u.user_id })}</caption>
                            <ColGroup widths={USER_TOKEN_COL_PCT} />
                            <thead><tr><th scope="col">{t("colLabel")}</th><th scope="col">{t("colScopes")}</th><th scope="col">{t("colCreated")}</th><th scope="col">{t("colLastUsed")}</th><th scope="col">{tc("status")}</th><th scope="col"><span className="sr-only">{tc("actions")}</span></th></tr></thead>
                            <tbody>
                              {(userTokens[u.user_id] ?? []).map((tok) => (
                                <tr key={tok.id}>
                                  <td className="cell-truncate">{tok.label}</td>
                                  <td>{tok.scopes}</td>
                                  <td className="tabular-nums">{tok.created_at.slice(0, 10)}</td>
                                  <td className="tabular-nums">{tok.last_used_at ? tok.last_used_at.slice(0, 10) : "—"}</td>
                                  <td>{tok.revoked_at ? <span className="status-chip status-not-started">{t("revoked")}</span> : <span className="status-chip status-green">{t("active")}</span>}</td>
                                  <td>{!tok.revoked_at && (
                                    <button type="button" className="btn-danger btn-sm" onClick={() => revokeUserToken(u.user_id, tok.id)}>{t("revokeButton")}</button>
                                  )}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                        <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                          {t("plainTokenNote")}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table></div>
          <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} />
          </>
          )}
          </>
        ))}</>
  );
}
