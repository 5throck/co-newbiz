import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.ts";
import { useAuth } from "../auth.tsx";

// Forced password-change screen — reached whenever the API returns
// must_change_password (security-model §4: an admin reset or first login
// blocks every other route until this completes).
export function PasswordChange() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/auth/password-change", { currentPassword, newPassword });
      await refresh();
      navigate("/projects");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form onSubmit={onSubmit} className="login-form" aria-labelledby="pw-heading">
        <h1 id="pw-heading">비밀번호 변경이 필요합니다</h1>
        <p>다음 단계로 진행하기 전에 비밀번호를 변경해야 합니다.</p>
        <label htmlFor="currentPassword">현재 비밀번호</label>
        <input id="currentPassword" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        <label htmlFor="newPassword">새 비밀번호</label>
        <input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        {error && (
          <p role="alert" className="form-error">
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
