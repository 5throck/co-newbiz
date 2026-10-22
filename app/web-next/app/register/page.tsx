"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "../../lib/api.ts";

// 계정 신청 (/register) — 로그인 화면의 안내 링크에서 진입. 신규 계정은
// 'pending' 상태로 생성되며 관리자 승인 후 로그인할 수 있다(security-model
// 짠4: self-signup → admin approval 진행).
export default function RegisterPage() {
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // T-20261022-034: React가 onSubmit을 부착하기 전 제출(버튼 클릭·Enter)은
  // 네이티브 form 제출로 진행된다. form이 method="post" + action="/api/auth/register"를
  // 선언해 선(先)하이드레이션 제출이 POST로 나가도록 한다(자격 증명이 URL 쿼리에
  // 기록되지 않음) — register 라우트는 JSON 본문만 파싱하므로 form 인코딩 네이티브
  // POST는 400으로 거부된다. 버튼은 하이드레이션 전까지 비활성이며, 핸들러 부착 후에는
  // preventDefault로 아래 fetch 기반 흐름을 유지한다.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/register", { userId, password, displayName: displayName || undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "신청 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page login-page-rich">
      <div className="login-panel" role="main">
        <h1>계정 신청</h1>
        {done ? (
          <div role="status">
            <p className="form-success">
              신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다 (승인까지 로그인 화면에서 대기해 주세요).
            </p>
            <Link href="/login" className="login-link">
              ← 로그인 화면으로
            </Link>
          </div>
        ) : (
          <>
            <p className="login-hint">
              신규 계정은 <strong>viewer(열람)</strong> 권한으로 생성되며, 관리자 승인 시 역할이 부여됩니다.
            </p>
            <form onSubmit={onSubmit} method="post" action="/api/auth/register" aria-labelledby="register-heading">
              <h2 id="register-heading" className="sr-only">
                계정 신청 양식
              </h2>
              <label htmlFor="reg-userId">아이디 (이메일)</label>
              <input id="reg-userId" type="email" autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} required />
              <label htmlFor="reg-displayName">이름 (선택)</label>
              <input id="reg-displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <label htmlFor="reg-password">비밀번호 (8자 이상)</label>
              <input id="reg-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
              <label htmlFor="reg-passwordConfirm">비밀번호 확인</label>
              <input id="reg-passwordConfirm" type="password" autoComplete="new-password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required />
              {error && (
                <p role="alert" className="text-[color:var(--red-fg)]">
                  {error}
                </p>
              )}
              <button type="submit" className="btn-ghost" disabled={busy || !hydrated}>
                {busy ? "신청 중..." : "계정 신청"}
              </button>
            </form>
            <Link href="/login" className="login-link">
              ← 로그인 화면으로
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
