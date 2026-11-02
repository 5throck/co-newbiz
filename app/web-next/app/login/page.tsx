"use client";

// Port of app/web/src/pages/Login.tsx — useNavigate -> useRouter().push.
// 신규사업 검토 프로세스(S1~S3 기회 발굴) 플랫폼의 진입 화면: 배경 이미지(가치사슬/항만 모티프).
// OWNER DECISION 2026-11-02 (access tightening, Option A): self-registration is
// closed — the 계정 신청(/register) 링크는 제거되었고 계정은 관리자가 발급한다.
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth, describeAuthError } from "../../lib/auth-client.tsx";

const LOGIN_BACKGROUNDS = ["/login-bg.svg", "/login-bg-2.svg", "/login-bg-3.svg"] as const;

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { login } = useAuth();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // T-20261022-020: until React attaches onSubmit, a submit (button click or
  // Enter) would fire the NATIVE form submission. The form therefore declares
  // method="post" + action="/api/auth/login" so a pre-hydration submit POSTs
  // (credentials never land in the URL query) — the login route only parses a
  // JSON body, so the form-encoded native POST is refused with 400 and never
  // processed. The submit button stays disabled until hydration, and once the
  // handler is attached preventDefault keeps the fetch-based flow below.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

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
      await login(userId.trim(), password);
      // ADR-0154: return to a pending OAuth consent; only same-origin /oauth/ paths.
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(
        next && (next.startsWith("/oauth/") || next.startsWith("/proposals/")) && !next.startsWith("//") ? next : "/",
      );
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
          <div
            key={bg}
            className={`login-hero-bg ${i === bgIndex ? "is-active" : ""}`}
            style={{ backgroundImage: `url("${bg}")` }}
          />
        ))}
        <div className="login-hero-veil" />
      </div>
      <div className="login-hero" aria-hidden="true">
        <p className="login-hero-title">{tc("appName")}</p>
        <p className="login-hero-sub">{t("processFlow")}</p>
      </div>
      <div className="login-panel">
        <form
          onSubmit={onSubmit}
          method="post"
          action="/api/auth/login"
          className="login-form"
          aria-labelledby="login-heading"
        >
          <h1 id="login-heading">{t("loginHeading")}</h1>
          <label htmlFor="userId">{t("userId")}</label>
          <input
            id="userId"
            name="userId"
            autoComplete="username"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
          />
          <label htmlFor="password">{t("password")}</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && (
            <p role="alert" className="text-[color:var(--red-fg)]">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !hydrated}>
            {busy ? t("signingIn") : t("signIn")}
          </button>
        </form>
      </div>
    </main>
  );
}
