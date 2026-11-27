"use client";

// OAuth 동의 화면 — ADR-0154 §2, design 2026-11-19-oauth-consent-screen-redesign.
// MCP 커넥터(ChatGPT·Claude.ai 등)가 로그인한 사용자를 대신해 co-newbiz에
// 접근하도록 허용할지 사람이 자기 웹 세션에서 결정한다. 화면 로드만으로는
// 아무 일도 일어나지 않으며(no action on load), 기본 동작은 하나("허용")다.
// 미검증 클라이언트는 텍스트 배지로 표시한다(색상만으로 구분하지 않음).
//
// 레이아웃(2026-11-19 재설계): 워크스페이스 크롬 없이(AppShell bare 경로)
// 32rem 중앙 정렬 카드 3블록 — 신원(누가 묻는가) → 권한(무엇을 얻는가) →
// 경계 노트(무엇을 못 하는가). 피싱 판별 핵심인 리다이렉트 돌아갈 주소는
// 모노스페이스 대형 블록으로 승격한다. 거부(btn-danger)가 DOM/탭 순서에서
// 먼저 온다(습관적 Enter가 안전 쪽에 떨어지게).
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "../../../lib/api.ts";
import Link from "next/link";
import { Button, PageState, PrimaryAction } from "../../../components/ui.tsx";

interface ConsentInfo {
  valid: boolean;
  error?: string;
  error_description?: string;
  redirect_to?: string;
  client?: { client_id: string; name: string; verified: boolean };
  redirect_host?: string;
  scopes?: Array<{ scope: "read" | "write" | "propose"; allowed: boolean }>;
  user_id?: string;
}

// i18n: scope descriptions resolve through pages.oauthAuthorize.scope* keys at render time.
const SCOPE_KEY: Record<string, string> = {
  read: "scopeRead",
  write: "scopeWrite",
  propose: "scopePropose",
};

const PARAM_KEYS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"];

export default function OAuthAuthorizePage() {
  const t = useTranslations("pages.oauthAuthorize");
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // G1 (design 2026-11-27-admin-oauth-client-stop-start): the authorize GET answers
  // 400 client_stopped (redirectSafe:false) when an admin stopped the client — a
  // dedicated honest state instead of the generic invalid one; never a redirect.
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api
      .get<ConsentInfo>(`/api/oauth/authorize${window.location.search}`)
      .then((r) => setInfo(r.data))
      .catch((e) => {
        if (e instanceof ApiError && e.code === "client_stopped") setStopped(true);
        else setError(e instanceof ApiError ? e.message : t("loadFailed"));
      });
  }, []);

  useEffect(() => {
    if (info || error || stopped) headingRef.current?.focus();
  }, [info, error, stopped]);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setStatus(decision === "approve" ? t("approving") : t("denying"));
    try {
      const params = new URLSearchParams(window.location.search);
      const body: Record<string, string> = { decision };
      for (const k of PARAM_KEYS) {
        const v = params.get(k);
        if (v !== null) body[k] = v;
      }
      const r = await api.post<{ redirect_to: string }>("/api/oauth/authorize", body);
      setStatus(t("returning"));
      window.location.assign(r.data.redirect_to);
    } catch (e) {
      // The same G1 door re-validates on decision: a stop racing the human's
      // choice lands here — show the stopped state, not the generic invalid one.
      if (e instanceof ApiError && e.code === "client_stopped") {
        setStopped(true);
      } else {
        setError(e instanceof ApiError ? e.message : t("decideFailed"));
      }
      setStatus("");
      setBusy(false);
    }
  }

  const blocked = info?.scopes?.some((s) => !s.allowed) ?? false;
  // R2-C 10: a missing or invalid request is an error state, never a consent screen.
  const failed = !!error || stopped || (info !== null && !info.valid);

  return (
    <main aria-labelledby="consent-heading" className="oauth-consent">
      <h1 id="consent-heading" ref={headingRef} tabIndex={-1}>
        {failed ? t("headingFailed") : t("heading")}
      </h1>
      <p aria-live="polite" className="sr-only">{status}</p>
      {!info && !error && !stopped && (
        <div className="card">
          <PageState state="loading" />
        </div>
      )}
      {stopped && (
        // 중단된 앱 — icon + text (§3.2, never color-only); the settings page link is
        // the state's single action. Stays inside the chromeless consent card.
        <section aria-labelledby="stopped-heading" className="card">
          <h2 id="stopped-heading">{t("stoppedHeading")}</h2>
          <p role="alert">
            <span aria-hidden="true">✕</span> {t("stoppedBody")}
          </p>
          <div className="page-header-actions">
            <Link href="/settings/connected-apps" className="btn-primary">
              {t("viewConnectedApps")}
            </Link>
          </div>
        </section>
      )}
      {error && (
        <section aria-labelledby="invalid-heading" className="card">
          <h2 id="invalid-heading">{t("invalidHeading")}</h2>
          <p role="alert">{t("invalidMissingBody")}</p>
          <details className="review-dev"><summary>{t("devNote")}</summary><span>{error}</span></details>
          <div className="page-header-actions">
            <Link href="/settings/connected-apps" className="btn-primary">{t("viewConnectedApps")}</Link>
            <Link href="/deals" className="btn-ghost">{t("goDealBoard")}</Link>
          </div>
        </section>
      )}
      {info && !info.valid && (
        <section aria-labelledby="invalid-heading" className="card">
          <h2 id="invalid-heading">{t("invalidHeading")}</h2>
          <p role="alert">{t("invalidBody")}</p>
          {info.error_description && <details className="review-dev"><summary>{t("devNote")}</summary><span>{info.error_description}</span></details>}
          {info.redirect_to && (
            <Button onClick={() => window.location.assign(info.redirect_to ?? "")}>{t("backToApp")}</Button>
          )}
        </section>
      )}
      {info?.valid && info.client && (
        <>
          {/* 신원 카드 — 누가 묻는가: 이름+검증 배지, 계정, 돌아갈 주호스트. */}
          <section aria-labelledby="client-heading" className="card">
            <h2 id="client-heading">
              {info.client.name}{" "}
              <span className={`status-chip ${info.client.verified ? "status-green" : "status-amber"}`}>
                {info.client.verified ? t("chipVerified") : t("chipUnverified")}
              </span>
            </h2>
            <p className="oauth-lead">{t("consentLead")}</p>
            {!info.client.verified && (
              <p className="oauth-warning">
                <span aria-hidden="true">⚠</span> {t("unverifiedNote")}
              </p>
            )}
            <dl className="oauth-facts">
              <div className="oauth-fact">
                <dt className="oauth-fact-label">{t("accountLabel")}</dt>
                <dd className="oauth-fact-value">{info.user_id}</dd>
              </div>
            </dl>
            {/* 돌아갈 주소 블록 — 서버가 등록 redirect URI에서 뽑은 호스트.
                링크가 아니라 증거다: 클릭 대상·복사 단축 없이 평문으로만 렌더. */}
            <div className="oauth-host-block">
              <dl className="oauth-facts">
                <div className="oauth-fact">
                  <dt className="oauth-fact-label">
                    <span aria-hidden="true">↗ </span>{t("redirectHostLabel")}
                  </dt>
                  <dd className="oauth-host-value">{info.redirect_host}</dd>
                </div>
              </dl>
              <p className="oauth-host-caution">{t("redirectHostCaution")}</p>
            </div>
          </section>
          {/* 권한 카드 — 무엇을 얻는가: 구분선 리스트, 역할이 못 주는 권한은 배지. */}
          <section aria-labelledby="scopes-heading" className="card">
            <h3 id="scopes-heading">{t("requestedScopesHeading")}</h3>
            <dl className="oauth-scopes">
              {info.scopes?.map((s) => (
                <div key={s.scope} className="oauth-scope-row">
                  <dt className="oauth-scope-name">{s.scope}</dt>
                  <dd className="oauth-scope-desc">
                    {t(SCOPE_KEY[s.scope])}
                    {!s.allowed && <span className="status-chip status-red">{t("scopeNotAllowedChip")}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <p className="oauth-note">{t("noGateNote")}</p>
          {/* 거부가 먼저(D5): 첫 탭 정지·습관적 Enter 입력이 안전 쪽으로 떨어진다.
              승인은 커밋 위치(읽기 흐름의 끝)에 후행하며, 막혔을 때 이유를
              PrimaryAction이 인접 텍스트(.primary-reason + aria-describedby)로 보여준다. */}
          <div className="oauth-actions">
            <Button variant="danger" onClick={() => void decide("deny")} disabled={busy}>
              {t("denyBtn")}
            </Button>
            <PrimaryAction
              label={t("approveBtn")}
              onClick={() => void decide("approve")}
              disabled={busy || blocked}
              disabledReason={blocked ? t("approveBlockedNote") : undefined}
            />
          </div>
        </>
      )}
    </main>
  );
}
