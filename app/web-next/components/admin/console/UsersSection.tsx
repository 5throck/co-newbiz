"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { Fragment } from "react";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ColGroup } from "../../ui.tsx";

// 사용자 API 토큰 6열 — 라벨·스코프가 긴 텍스트라 table-scroll 안에서 고정 비율 유지.
const USER_TOKEN_COL_PCT = [24, 26, 13, 15, 12, 10] as const;

export function UsersNoticePanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, notice, noticePinned, setNoticePinned, setNotice, createUserAccount, newUserId, setNewUserId, newUserRole, setNewUserRole, showCreateUser, setShowCreateUser } = ctx;
  return (
    <>{section === "users" && (
        <div>
          {notice && noticePinned && (
            <p role="status" className="mb-2 p-2 border border-[color:var(--green-border)] bg-[color:var(--green-bg)] rounded-lg text-[color:var(--green-fg)]">
              {notice}
              <button type="button" className="btn-ghost ml-2" onClick={() => { setNoticePinned(false); setNotice(null); }}>
                확인
              </button>
            </p>
          )}
          <div className="mb-3 flex justify-end">
            <button type="button" className="btn-ghost" aria-expanded={showCreateUser} onClick={() => setShowCreateUser((v) => !v)}>
              ＋ 사용자 등록
            </button>
          </div>
          {showCreateUser && (
          <form onSubmit={createUserAccount} aria-label="사용자 생성" className="sizing-new-form mb-4">
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="text"
                aria-label="새 사용자 아이디"
                placeholder="user@example.com"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                required
              />
              <select aria-label="역할" value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as "analyst" | "viewer" | "admin")}>
                <option value="analyst">analyst</option>
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
              </select>
              <button type="submit" className="btn-ghost" disabled={!!noticePinned}>
                등록
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowCreateUser(false)}>취소</button>
            </div>
          </form>
          )}
        </div>
      )}</>
  );
}

export function UsersTablePanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, users, me, approve, setRole, userAction, toggleTokenPanel, tokenPanelUser, tokenLabel, setTokenLabel, tokenWrite, setTokenWrite, tokenBusy, issueUserToken, userTokens, revokeUserToken } = ctx;
  return (
    <>{section === "users" &&
        (users === null ? (
          <p>불러오는 중...</p>
        ) : (
          <table className="data-table list-table">
            <caption className="sr-only">사용자 목록</caption>
            <thead>
              <tr>
                <th scope="col">아이디</th>
                <th scope="col" className="w-[6rem]">역할</th>
                <th scope="col" className="w-[8rem]">상태</th>
                <th scope="col" className="col-date">가입일</th>
                <th scope="col" className="w-[13rem]"><span className="sr-only">작업</span></th>
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
                      <select aria-label={`${u.user_id} 역할 변경`} value={u.role} onChange={(e) => void setRole(u.user_id, e.target.value)} className="sizing-new-input sizing-new-input-sm">
                        <option value="admin">admin</option>
                        <option value="analyst">analyst</option>
                        <option value="viewer">viewer</option>
                      </select>
                    )}
                  </td>
                  <td>{u.status === "disabled" ? <span className="status-chip status-not-started">disabled</span> : u.status}</td>
                  <td className="col-date">{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="sizing-actions-cell"><span className="actions-row">
                    {u.status === "pending" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => approve(u.user_id)}>
                        승인
                      </button>
                    )}
                    {u.status !== "pending" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "reset_password")}>
                        비밀번호 초기화
                      </button>
                    )}
                    {u.status === "active" && u.user_id !== me?.userId && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "disable")}>
                        비활성화
                      </button>
                    )}
                    {u.status === "disabled" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "enable")}>
                        활성화
                      </button>
                    )}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => toggleTokenPanel(u.user_id)}>
                      토큰
                    </button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => userAction(u.user_id, "delete")}>
                      삭제
                    </button>
                  </span></td>
                </tr>
                {tokenPanelUser === u.user_id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="sizing-new-form">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <input
                            aria-label="토큰 라벨"
                            placeholder="토큰 라벨 (예: mcp-cli)"
                            value={tokenLabel}
                            onChange={(e) => setTokenLabel(e.target.value)}
                            className="sizing-new-input sizing-new-input-sm"
                          />
                          <label className="text-[length:var(--fs-caption)] flex items-center gap-1">
                            <input type="checkbox" checked={tokenWrite} onChange={(e) => setTokenWrite(e.target.checked)} />
                            write 스코프 포함
                          </label>
                          <button type="button" className="btn-ghost btn-sm" disabled={tokenBusy || !tokenLabel.trim()} onClick={() => issueUserToken(u.user_id)}>
                            토큰 발급
                          </button>
                        </div>
                        {(userTokens[u.user_id] ?? []).length === 0 ? (
                          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-caption)] mb-0">발급된 토큰이 없습니다.</p>
                        ) : (
                          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                          <table className="data-table table-fixed-pct tmin-48" aria-label={`${u.user_id} API 토큰`}>
                            <caption className="sr-only">{u.user_id} API 토큰</caption>
                            <ColGroup widths={USER_TOKEN_COL_PCT} />
                            <thead><tr><th scope="col">라벨</th><th scope="col">스코프</th><th scope="col">생성일</th><th scope="col">마지막 사용</th><th scope="col">상태</th><th scope="col"><span className="sr-only">작업</span></th></tr></thead>
                            <tbody>
                              {(userTokens[u.user_id] ?? []).map((t) => (
                                <tr key={t.id}>
                                  <td className="cell-truncate">{t.label}</td>
                                  <td>{t.scopes}</td>
                                  <td className="tabular-nums">{t.created_at.slice(0, 10)}</td>
                                  <td className="tabular-nums">{t.last_used_at ? t.last_used_at.slice(0, 10) : "—"}</td>
                                  <td>{t.revoked_at ? <span className="status-chip status-not-started">폐기됨</span> : <span className="status-chip status-green">활성</span>}</td>
                                  <td>{!t.revoked_at && (
                                    <button type="button" className="btn-danger btn-sm" onClick={() => revokeUserToken(u.user_id, t.id)}>폐기</button>
                                  )}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                        <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                          발급 시 표시되는 토큰 평문은 다시 볼 수 없습니다 — CO_NEWBIZ_API_TOKEN으로 사용합니다.
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
