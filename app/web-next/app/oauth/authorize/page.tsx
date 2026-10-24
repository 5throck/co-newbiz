"use client";

// OAuth 동의 화면 — ADR-0154 §2, design §4.2/§11.
// MCP 커넥터(ChatGPT·Claude.ai 등)가 로그인한 사용자를 대신해 co-newbiz에
// 접근하도록 허용할지 사람이 자기 웹 세션에서 결정한다. 화면 로드만으로는
// 아무 일도 일어나지 않으며(no action on load), 기본 동작은 하나("허용")다.
// 미검증 클라이언트는 텍스트 배지로 표시한다(색상만으로 구분하지 않음).
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "../../../lib/api.ts";
import Link from "next/link";
import { Button, PageState } from "../../../components/ui.tsx";

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api
      .get<ConsentInfo>(`/api/oauth/authorize${window.location.search}`)
      .then((r) => setInfo(r.data))
      .catch((e) => setError(e instanceof ApiError ? e.message : t("loadFailed")));
  }, []);

  useEffect(() => {
    if (info || error) headingRef.current?.focus();
  }, [info, error]);

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
      setError(e instanceof ApiError ? e.message : t("decideFailed"));
      setStatus("");
      setBusy(false);
    }
  }

  const blocked = info?.scopes?.some((s) => !s.allowed) ?? false;
  // R2-C 10: a missing or invalid request is an error state, never a consent screen.
  const failed = !!error || (info !== null && !info.valid);

  return (
    <main aria-labelledby="consent-heading">
      <h1 id="consent-heading" ref={headingRef} tabIndex={-1}>
        {failed ? t("headingFailed") : t("heading")}
      </h1>
      <p aria-live="polite" className="sr-only">{status}</p>
      {!info && !error && <PageState state="loading" />}
      {error && (
        <section aria-labelledby="invalid-heading">
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
        <section aria-labelledby="invalid-heading">
          <h2 id="invalid-heading">{t("invalidHeading")}</h2>
          <p role="alert">{t("invalidBody")}</p>
          {info.error_description && <details className="review-dev"><summary>{t("devNote")}</summary><span>{info.error_description}</span></details>}
          {info.redirect_to && (
            <Button onClick={() => window.location.assign(info.redirect_to ?? "")}>{t("backToApp")}</Button>
          )}
        </section>
      )}
      {info?.valid && info.client && (
        <section aria-labelledby="client-heading">
          <h2 id="client-heading">
            {info.client.name}{" "}
            <span className={`status-chip ${info.client.verified ? "status-green" : "status-amber"}`}>
              {info.client.verified ? t("chipVerified") : t("chipUnverified")}
            </span>
          </h2>
          <p className="objective">
            {t("objLead")}<strong>{info.user_id}</strong>{t("objMid")}<strong>{info.redirect_host}</strong>
          </p>
          {!info.client.verified && (
            <p>{t("unverifiedNote")}</p>
          )}
          <h3>{t("requestedScopesHeading")}</h3>
          <dl>
            {info.scopes?.map((s) => (
              <div key={s.scope}>
                <dt>{s.scope}</dt>
                <dd>
                  {t(SCOPE_KEY[s.scope])}
                  {!s.allowed && <span className="status-chip status-red">{t("scopeNotAllowedChip")}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <p>{t("noGateNote")}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void decide("approve")} disabled={busy || blocked}>
              {t("approveBtn")}
            </Button>
            <Button onClick={() => void decide("deny")} disabled={busy}>
              {t("denyBtn")}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
