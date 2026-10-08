"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import type { useAdminData } from "./useAdminData.ts";

export function useAdminActions(prev: ReturnType<typeof useAdminData>) {
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
      .catch((e) => setNotice(e instanceof Error ? e.message : "토큰 목록 조회 실패"));
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
      setIssuedSecret({ kind: `API 토큰 — ${userId} / ${res.data.label}`, value: res.data.token, detail: "이 토큰은 CO_NEWBIZ_API_TOKEN으로 사용합니다." });
      setTokenLabel("");
      setTokenWrite(false);
      loadUserTokens(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "토큰 발급 실패");
    } finally {
      setTokenBusy(false);
    }
  }

  function revokeUserToken(userId: string, tokenId: string) {
    confirm("API 토큰 폐기", async () => {
      try {
        await api.delete(`/api/admin/users/${encodeURIComponent(userId)}/tokens?tokenId=${encodeURIComponent(tokenId)}`);
        loadUserTokens(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "토큰 폐기 실패");
      }
    }, { body: "폐기된 토큰은 즉시 무효화되며 되돌릴 수 없습니다.", confirmLabel: "폐기" });
  }

  async function setRole(userId: string, role: string) {
    setError(null);
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(userId)}`, { action: "set_role", role });
      setUsers(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "역할 변경 실패");
      setUsers(null);
    }
  }

  function userAction(userId: string, action: "delete" | "reset_password" | "disable" | "enable") {
    if (action === "delete") {
      confirm(
        `${userId} 계정 삭제`,
        async () => {
          setNotice(null);
          try {
            await api.put(`/api/admin/users/${userId}`, { action: "delete" });
            setNotice(`${userId} 삭제됨`);
            setUsers(null);
          } catch (err) {
            setNotice(err instanceof Error ? err.message : "작업 실패");
          }
        },
        { body: "세션·토큰도 함께 삭제되며 감사 로그에 기록됩니다." },
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
      setIssuedSecret({ kind: `임시 비밀번호 — ${userId}`, value: res.data.temporary_password, detail: "다음 로그인 시 비밀번호 변경이 요구됩니다." });
      setUsers(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "작업 실패");
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
      setError(err instanceof Error ? err.message : "작업 토글에 실패했습니다.");
    }
  }

  async function saveRetention(e: FormEvent) {
    e.preventDefault();
    setRetentionFormError(null);
    setRetentionNotice(null);
    const monthsValue = Number(months);
    if (!tableKey.trim() || !basis.trim()) {
      setRetentionFormError("테이블 키와 근거를 모두 입력하세요.");
      return;
    }
    if (!Number.isInteger(monthsValue) || monthsValue < 0) {
      setRetentionFormError("보존 기간(개월)은 0 이상의 정수여야 합니다.");
      return;
    }
    try {
      await api.post("/api/admin/retention", {
        table_key: tableKey.trim(),
        basis: basis.trim(),
        retention_months: monthsValue,
        action,
      });
      setRetentionNotice(`저장되었습니다 (${tableKey.trim()}).`);
      setTableKey("");
      setBasis("");
      setMonths("");
      setRetention(null); // re-fetch through the section effect
    } catch (err) {
      setRetentionFormError(err instanceof ApiError ? err.message : "정책 저장에 실패했습니다.");
    }
  }
  return { issuedSecret, secretModalKeyDown, secretModalPanelRef, setIssuedSecret, showCreateUser, setShowCreateUser, setRole, userAction, toggleTokenPanel, tokenPanelUser, tokenLabel, setTokenLabel, tokenWrite, setTokenWrite, tokenBusy, issueUserToken, userTokens, revokeUserToken, toggleJob, saveRetention };
}

export type AdminConsoleState = ReturnType<typeof useAdminData> & ReturnType<typeof useAdminActions>;
