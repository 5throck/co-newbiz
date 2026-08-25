"use client";

// Port of app/web/src/pages/Login.tsx — useNavigate -> useRouter().push.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth, describeAuthError } from "../../lib/auth-client.tsx";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(userId, password);
      router.push("/projects");
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form onSubmit={onSubmit} className="login-form" aria-labelledby="login-heading">
        <h1 id="login-heading">co-newbiz 로그인</h1>
        <label htmlFor="userId">아이디</label>
        <input id="userId" name="userId" autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} required />
        <label htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </main>
  );
}
