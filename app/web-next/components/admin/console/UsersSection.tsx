"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDate } from "../../../lib/format.ts";

// 사용자 API 토큰 6열 — 라벨·스코프가 긴 텍스트라 table-scroll 안에서 고정 비율 유지.
const USER_TOKEN_COL_PCT = [24, 26, 13, 15, 12, 10] as const;

export function UsersNoticePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
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
            <button type="button" className="btn-ghost" aria-expanded={showCreateUser} onClick={() => setShowCreateUser((v) => !v)}>
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
                <option value="analyst">analyst</option>
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
              </select>
              <button type="submit" className="btn-ghost" disabled={!!noticePinned}>
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
  const { section, users, me, approve, setRole, userAction, toggleTokenPanel, tokenPanelUser, tokenLabel, setTokenLabel, tokenWrite, setTokenWrite, tokenBusy, issueUserToken, userTokens, revokeUserToken } = ctx;
  return (
    <>{section === "users" &&
        (users === null ? (
          <p>{tc("loading")}</p>
        ) : (
          <table className="data-table list-table">
            <caption className="sr-only">{t("usersCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colUserId")}</th>
                <th scope="col" className="w-[6rem]">{t("colRole")}</th>
                <th scope="col" className="w-[8rem]">{tc("status")}</th>
                <th scope="col" className="col-date">{t("colJoined")}</th>
                <th scope="col" className="w-[13rem]"><span className="sr-only">{tc("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.user_id}>
                <tr>
                  <td>{u.user_id}</td>
                  <td>
                    {u.user_id === me?.userId ? (
                      u.role
                    ) : (
                      <select aria-label={t("roleChangeAria", { p1: u.user_id })} value={u.role} onChange={(e) => void setRole(u.user_id, e.target.value)} className="sizing-new-input sizing-new-input-sm">
                        <option value="admin">admin</option>
                        <option value="analyst">analyst</option>
                        <option value="viewer">viewer</option>
                      </select>
                    )}
                  </td>
                  <td>{u.status === "disabled" ? <span className="status-chip status-not-started">disabled</span> : u.status}</td>
                  <td className="col-date">{formatDate(u.created_at, locale)}</td>
                  <td className="sizing-actions-cell"><span className="actions-row">
                    {u.status === "pending" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => approve(u.user_id)}>
                        {t("approve")}
                      </button>
                    )}
                    {u.status !== "pending" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "reset_password")}>
                        {t("resetPassword")}
                      </button>
                    )}
                    {u.status === "active" && u.user_id !== me?.userId && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "disable")}>
                        {t("deactivate")}
                      </button>
                    )}
                    {u.status === "disabled" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "enable")}>
                        {t("activate")}
                      </button>
                    )}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => toggleTokenPanel(u.user_id)}>
                      {t("tokensButton")}
                    </button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => userAction(u.user_id, "delete")}>
                      {tc("delete")}
                    </button>
                  </span></td>
                </tr>
                {tokenPanelUser === u.user_id && (
                  <tr>
                    <td colSpan={5}>
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
          </table>
        ))}</>
  );
}
