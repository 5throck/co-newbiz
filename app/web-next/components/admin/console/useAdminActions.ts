"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import type { useAdminData } from "./useAdminData.ts";

export function useAdminActions(prev: ReturnType<typeof useAdminData>) {
  const t = useTranslations("admin.actions");
  const { setNotice, setError, confirm, setUsers, setNoticePinned, jobs, setJobs, setRetentionFormError, setRetentionNotice, months, tableKey, basis, action, setTableKey, setBasis, setMonths, setRetention } = prev;

  const { panelRef: secretModalPanelRef, onKeyDown: secretModalKeyDown } = useModalFocus(
    () => setIssuedSecret(null),
  );

  // ── API 토큰 관리 (사용자별) ──
  const [tokenPanelUser, setTokenPanelUser] = useState<string | null>(null);
  const [userTokens, setUserTokens] = useState<Record<string, Array<{ id: string; label: string; scopes: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>>>({});
  const [tokenLabel, setTokenLabel] = useState("");
  const [tokenWrite, setTokenWrite] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  // 발급된 비밀 정보(토큰·임시 비밀번호) 1회 확인 모달 — 닫으면 영구 소멸
  const [issuedSecret, setIssuedSecret] = useState<{ kind: string; value: string; detail: string } | null>(null);

  function loadUserTokens(userId: string) {
    api.get<Array<{ id: string; label: string; scopes: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>>(`/api/admin/users/${encodeURIComponent(userId)}/tokens`)
      .then((r) => setUserTokens((prev) => ({ ...prev, [userId]: r.data })))
      .catch((e) => setNotice(e instanceof Error ? e.message : t("tokenListFailed")));
  }

  function toggleTokenPanel(userId: string) {
    const next = tokenPanelUser === userId ? null : userId;
    setTokenPanelUser(next);
    if (next) loadUserTokens(next);
  }

  async function issueUserToken(userId: string) {
    if (!tokenLabel.trim() || tokenBusy) return;
    setTokenBusy(true);
    setError(null);
    try {
      const scopes = tokenWrite ? ["read", "write"] : ["read"];
      const res = await api.post<{ token: string; label: string }>(`/api/admin/users/${encodeURIComponent(userId)}/tokens`, { label: tokenLabel.trim(), scopes });
      setIssuedSecret({ kind: t("issuedKindToken", { p1: userId, p2: res.data.label }), value: res.data.token, detail: t("issuedTokenDetail") });
      setTokenLabel("");
      setTokenWrite(false);
      loadUserTokens(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tokenIssueFailed"));
    } finally {
      setTokenBusy(false);
    }
  }

  function revokeUserToken(userId: string, tokenId: string) {
    confirm(t("revokeTokenTitle"), async () => {
      try {
        await api.delete(`/api/admin/users/${encodeURIComponent(userId)}/tokens?tokenId=${encodeURIComponent(tokenId)}`);
        loadUserTokens(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("tokenRevokeFailed"));
      }
    }, { body: t("revokeTokenBody"), confirmLabel: t("revokeLabel") });
  }

  async function setRole(userId: string, role: string) {
    setError(null);
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(userId)}`, { action: "set_role", role });
      setUsers(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("roleChangeFailed"));
      setUsers(null);
    }
  }

  function userAction(userId: string, action: "delete" | "reset_password" | "disable" | "enable") {
    if (action === "delete") {
      confirm(
        t("deleteAccountTitle", { p1: userId }),
        async () => {
          setNotice(null);
          try {
            await api.put(`/api/admin/users/${userId}`, { action: "delete" });
            setNotice(t("deleteAccountDone", { p1: userId }));
            setUsers(null);
          } catch (err) {
            setNotice(err instanceof Error ? err.message : t("actionFailed"));
          }
        },
        { body: t("deleteAccountBody") },
      );
      return;
    }
    void resetPassword(userId);
  }

  async function resetPassword(userId: string) {
    setNotice(null);
    try {
      const res = await api.put<{ temporary_password: string }>(`/api/admin/users/${userId}`, { action: "reset_password" });
      setNoticePinned(true);
      setIssuedSecret({ kind: t("tempPasswordKind", { p1: userId }), value: res.data.temporary_password, detail: t("tempPasswordDetail") });
      setUsers(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  // Optimistic enable/disable: flip locally, revert to the pre-toggle
  // snapshot when the server rejects (admin-only is already enforced
  // server-side, so a failure here is a real failure, not a permissions UI).
  async function toggleJob(jobKey: string, next: boolean) {
    const snapshot = jobs;
    setJobs((rows) => rows?.map((j) => (j.job_key === jobKey ? { ...j, enabled: next ? 1 : 0 } : j)) ?? rows);
    try {
      await api.put(`/api/admin/schedule-jobs/${encodeURIComponent(jobKey)}`, { enabled: next });
    } catch (err) {
      setJobs(snapshot);
      setError(err instanceof Error ? err.message : t("jobToggleFailed"));
    }
  }

  async function saveRetention(e: FormEvent) {
    e.preventDefault();
    setRetentionFormError(null);
    setRetentionNotice(null);
    const monthsValue = Number(months);
    if (!tableKey.trim() || !basis.trim()) {
      setRetentionFormError(t("errTableKeyBasis"));
      return;
    }
    if (!Number.isInteger(monthsValue) || monthsValue < 0) {
      setRetentionFormError(t("errMonthsInteger"));
      return;
    }
    try {
      await api.post("/api/admin/retention", {
        table_key: tableKey.trim(),
        basis: basis.trim(),
        retention_months: monthsValue,
        action,
      });
      setRetentionNotice(t("savedNotice", { p1: tableKey.trim() }));
      setTableKey("");
      setBasis("");
      setMonths("");
      setRetention(null); // re-fetch through the section effect
    } catch (err) {
      setRetentionFormError(err instanceof ApiError ? err.message : t("saveFailed"));
    }
  }
  return { issuedSecret, secretModalKeyDown, secretModalPanelRef, setIssuedSecret, showCreateUser, setShowCreateUser, setRole, userAction, toggleTokenPanel, tokenPanelUser, tokenLabel, setTokenLabel, tokenWrite, setTokenWrite, tokenBusy, issueUserToken, userTokens, revokeUserToken, toggleJob, saveRetention };
}

export type AdminConsoleState = ReturnType<typeof useAdminData> & ReturnType<typeof useAdminActions>;
