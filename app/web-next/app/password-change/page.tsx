"use client";

// Self-service password change — also the completion step of the forced
// must-change-password flow after an admin reset. Three fields: the
// current (or admin-issued temporary) password plus the new password with
// a confirmation field, so "same value in both boxes" can no longer be
// mistaken for a verify-and-confirm form.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";

export default function PasswordChangePage() {
  const { refresh } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("새 비밀번호와 새 비밀번호 확인이 일치하지 않습니다. 두 칸에 같은 새 비밀번호를 입력하세요.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("새 비밀번호는 현재(임시) 비밀번호와 다른 값이어야 합니다 — 임시 비밀번호는 재사용할 수 없습니다.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/password-change", { currentPassword, newPassword });
      await refresh();
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form onSubmit={onSubmit} className="login-form" aria-labelledby="pw-heading">
        <h1 id="pw-heading">비밀번호 변경</h1>
        <p>
          관리자가 발급한 임시 비밀번호로 로그인한 경우, 새 비밀번호로 바꿔야 다음 단계로 진행할 수 있습니다.
          임시 비밀번호는 새 비밀번호로 재사용할 수 없습니다.
        </p>
        <label htmlFor="currentPassword">현재(임시) 비밀번호</label>
        <input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        <label htmlFor="newPassword">새 비밀번호 (8자 이상)</label>
        <input id="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        <label htmlFor="confirmPassword">새 비밀번호 확인</label>
        <input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
        {error && (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "변경 중..." : "비밀번호 변경"}
        </button>
      </form>
    </main>
  );
}
