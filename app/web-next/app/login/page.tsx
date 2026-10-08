"use client";

// Port of app/web/src/pages/Login.tsx — useNavigate -> useRouter().push.
// 신규사업 검토 프로세스(S1~S3 기회 발굴) 플랫폼의 진입 화면: 배경 이미지(가치사슬/항만 모티프)와
// 계정 신청 안내 링크를 제공한다. 계정 신청은 /register → 관리자 승인.
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, describeAuthError } from "../../lib/auth-client.tsx";

const LOGIN_BACKGROUNDS = [
  { src: "/login-bg.svg", label: "항만·가치사슬" },
  { src: "/login-bg-2.svg", label: "도시·인프라" },
  { src: "/login-bg-3.svg", label: "스마트 제조·로봇" },
] as const;

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 배경 롤링 (ADR-0105 보완) — 신규사업 모티프 3장을 7초 간격 크로스페이드.
  // prefers-reduced-motion 사용자에게는 정적 첫 장면만 유지한다.
  const [bgIndex, setBgIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setBgIndex((i) => (i + 1) % LOGIN_BACKGROUNDS.length), 7000);
    return () => clearInterval(timer);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(userId, password);
      // ADR-0154: return to a pending OAuth consent; only same-origin /oauth/ paths.
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next && (next.startsWith("/oauth/") || next.startsWith("/proposals/")) && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page login-page-rich">
      <div className="login-hero-stack" aria-hidden="true">
        {LOGIN_BACKGROUNDS.map((bg, i) => (
          <div key={bg.src} className={`login-hero-bg ${i === bgIndex ? "is-active" : ""}`} style={{ backgroundImage: `url("${bg.src}")` }} />
        ))}
        <div className="login-hero-veil" />
      </div>
      <div className="login-hero" aria-hidden="true">
        <p className="login-hero-title">신규사업 검토 AI 플랫폼</p>
        <p className="login-hero-sub">시장분석 → 기회발굴 → 시너지 → 트랙결정 → 사업성·밸류에이션 → 실사 → 투자심사</p>
      </div>
      <div className="login-panel">
        <form onSubmit={onSubmit} className="login-form" aria-labelledby="login-heading">
          <h1 id="login-heading">co-newbiz 로그인</h1>
          <label htmlFor="userId">아이디</label>
          <input id="userId" name="userId" autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} required />
          <label htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && (
            <p role="alert" className="text-[color:var(--red-fg)]">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "로그인 중..." : "로그인"}
          </button>
        </form>
        <div className="login-assist">
          <Link href="/register" className="login-link">
            계정이 없으신가요? 계정 신청 →
          </Link>
          <p className="login-hint">계정 신청 후 관리자 승인이 완료되면 로그인할 수 있습니다.</p>
        </div>
      </div>
    </main>
  );
}
