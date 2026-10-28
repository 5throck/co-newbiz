"use client";

// 연결된 앱 — ADR-0154 §2 (Revocation UI) + 개인 API 토큰 자가발급
// (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.2).
// 상단: OAuth로 허용한 MCP 커넥터 목록. 하단: 로컬 stdio MCP 서버·스크립트용
// 개인 API 토큰 발급/목록/해지. 발급·해지는 사람 웹 세션 전용(403 session_required).
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, ApiError } from "../../../lib/api.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { Button, PageState, PrimaryAction, useToast } from "../../../components/ui.tsx";
import { ColGroup } from "../../../components/ui.tsx";
import { useConfirm } from "../../../components/crud.tsx";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { intlTag, isLocale } from "../../../i18n/config.ts";

// 개인 API 토큰 목록 표 열 비율(2026-10-11-table-column-sizing-system batch 2) —
// 라벨이 본문(cell-truncate), 식별자·권한·상태·날짜·작업은 좁게.
const TOKEN_COL_PCT = [22, 16, 12, 14, 10, 10, 10, 6] as const;

interface ConnectedApp {
  client_id: string;
  name: string;
  verified: boolean;
  scopes: string;
  first_authorized_at: string;
  last_used_at: string | null;
}

interface PersonalToken {
  id: string;
  label: string;
  /** The list API returns scopes as a comma-joined string ("read,write"). */
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  display_id: string;
  status: "active" | "expired" | "revoked";
}

// 상태는 아이콘+텍스트로 전달 (design-guide §3.2 — 색 단독 금지). 라벨은 카탈로그 키.
const TOKEN_STATUS: Record<PersonalToken["status"], { cls: string; icon: string; key: string }> = {
  active: { cls: "status-green", icon: "●", key: "statusActive" },
  expired: { cls: "status-amber", icon: "◐", key: "statusExpired" },
  revoked: { cls: "status-unknown", icon: "○", key: "statusRevoked" },
};

const EXPIRY_OPTIONS = [
  { days: 7, key: "expiry7" },
  { days: 30, key: "expiry30" },
  { days: 90, key: "expiry90" },
];

// Compact date-time for the token table cells (e.g. "26. 10. 11. 15:04").
function fmtShort(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(isLocale(locale) ? locale : "ko"), {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(iso));
}

// 목록에는 접두어 + 마지막 6자만 노출 (전체 시크릿은 1회 모달에서만)
function maskedId(displayId: string): string {
  return `cnb_pat_••••${displayId}`;
}

// ── 1회 노출 모달: 시크릿은 이 컴포넌트 상태에만 존재하고 닫으면 사라진다 ──
function TokenRevealModal({
  token,
  origin,
  onClose,
}: {
  token: string;
  origin: string;
  onClose: () => void;
}) {
  const t = useTranslations("pages.connectedApps");
  const tc = useTranslations("common");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  const snippet = JSON.stringify(
    {
      mcpServers: {
        "co-newbiz": {
          command: "bun",
          args: ["<repo-path>/mcp/co-newbiz/index.ts"],
          env: { CO_NEWBIZ_API_BASE_URL: origin, CO_NEWBIZ_API_TOKEN: token },
        },
      },
    },
    null,
    2,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied("ok");
    } catch {
      inputRef.current?.select();
      setCopied("fail");
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-reveal-heading"
        onKeyDown={onKeyDown}
      >
        <h2 id="token-reveal-heading">{t("revealTitle")}</h2>
        <p>
          {t("revealBodyHead")} <strong>{t("revealBodyEmphasis")}</strong> {t("revealBodyTail")}
        </p>
        <input
          ref={inputRef}
          readOnly
          value={token}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t("revealInputAria")}
          style={{ width: "100%", fontFamily: "var(--font-mono, monospace)" }}
        />
        <div style={{ display: "flex", gap: "var(--space-2, 0.5rem)", marginTop: "var(--space-2, 0.5rem)" }}>
          <Button variant="ghost" onClick={() => void copy()}>
            {tc("copy")}
          </Button>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {copied === "ok" ? t("copiedOk") : copied === "fail" ? t("copiedFail") : ""}
        </p>
        <h3>{t("revealSnippetHeading")}</h3>
        <pre style={{ overflowX: "auto", fontSize: "var(--fs-caption)" }}>
          <code>{snippet}</code>
        </pre>
        <p>
          <code>CO_NEWBIZ_API_TOKEN</code>
          {t("snippetAfterToken")}{" "}
          <code>CO_NEWBIZ_API_BASE_URL</code>
          {t("snippetAfterBase")}{" "}
          <code>mcp/co-newbiz/index.ts</code>
          {t("snippetTail")}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-3, 1rem)" }}>
          <Button variant="primary" onClick={onClose}>
            {t("revealSavedButton")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonalTokensSection() {
  const t = useTranslations("pages.connectedApps");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { me } = useAuth();
  const canIssue = canWriteBusiness(me?.role);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [tokens, setTokens] = useState<PersonalToken[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [withWrite, setWithWrite] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  /** 발급 오류 코드 → 실행 가능한 안내 (카탈로그 텍스트) */
  function issueErrorText(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.code === "session_required") return t("errIssueSession");
      if (e.code === "token_limit_reached") return t("errIssueLimit");
      if (e.code === "rate_limited") return t("errIssueRate");
      if (e.code === "role_required" || e.code === "role_forbidden") return t("errIssueRole");
      if (e.code === "invalid_request") return t("errIssueInvalid");
      return t("errIssueWithCode", { p1: e.code });
    }
    return t("errIssue");
  }

  function listErrorText(e: unknown): string {
    return e instanceof ApiError ? t("errListWithCode", { p1: e.code }) : t("errList");
  }

  const load = useCallback(() => {
    setListError(null);
    api
      .get<PersonalToken[]>("/api/tokens")
      .then((r) => setTokens(r.data.map((tok) => ({ ...tok, scopes: String(tok.scopes ?? "") }))))
      .catch((e) => setListError(listErrorText(e)));
  }, []);

  useEffect(load, [load]);

  async function submit() {
    setFormError(null);
    if (!label.trim()) {
      setFormError(t("errLabelRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post<{ token: string; id: string; label: string }>("/api/tokens", {
        label: label.trim(),
        scopes: withWrite ? ["read", "write"] : ["read"],
        expiresInDays,
      });
      setRevealed(r.data.token);
      setLabel("");
      setWithWrite(false);
      load();
    } catch (e) {
      setFormError(issueErrorText(e));
    } finally {
      setSubmitting(false);
    }
  }

  function revoke(tok: PersonalToken) {
    confirm(
      t("tokenRevokeConfirmTitle", { p1: tok.label }),
      () => void doRevoke(tok),
      {
        body: t("tokenRevokeBody"),
        confirmLabel: t("revokeButton"),
      },
    );
  }

  async function doRevoke(tok: PersonalToken) {
    try {
      await api.delete(`/api/tokens/${encodeURIComponent(tok.id)}`);
      toast(t("tokenRevokedToast", { p1: tok.label }));
      load();
    } catch (e) {
      toast(
        e instanceof ApiError && e.code === "session_required"
          ? t("errRevokeSession")
          : e instanceof ApiError
            ? t("errRevokeWithCode", { p1: e.code })
            : t("errRevoke"),
        "alert",
      );
    }
  }

  return (
    <section aria-labelledby="pat-heading" className="market-section" style={{ marginTop: "var(--space-5, 1.5rem)" }}>
      {confirmDialog}
      <h2 id="pat-heading">{t("patHeading")}</h2>
      <p className="objective">
        {t("patIntroPre")}
        <code>mcp/co-newbiz</code>
        {t("patIntroPost")}
      </p>

      {listError && (
        <PageState state="error" errorText={listError} onRetry={load} />
      )}

      {!listError && (
        <>
          {canIssue ? (
            <form
              aria-label={t("formAria")}
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="pat-form-grid">
                <div className="pat-field">
                  <label htmlFor="pat-label" className="pat-field-label">
                    {t("labelField")}
                  </label>
                  <input
                    id="pat-label"
                    className="form-input"
                    value={label}
                    maxLength={80}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t("labelPlaceholder")}
                  />
                </div>
                <fieldset className="pat-field pat-scope-field">
                  <legend className="pat-field-label">{t("scopeLegend")}</legend>
                  <label>
                    <input type="radio" name="pat-scope" checked={!withWrite} onChange={() => setWithWrite(false)} />{" "}
                    {t("scopeRead")}
                  </label>
                  <label>
                    <input type="radio" name="pat-scope" checked={withWrite} onChange={() => setWithWrite(true)} />{" "}
                    {t("scopeReadWrite")}
                  </label>
                </fieldset>
                <div className="pat-field">
                  <label htmlFor="pat-expiry" className="pat-field-label">
                    {t("expiryField")}
                  </label>
                  <select
                    id="pat-expiry"
                    className="form-input"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.days} value={o.days}>
                        {t(o.key)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button variant="primary" type="submit" disabled={submitting}>
                  {t("issueButton")}
                </Button>
              </div>
            </form>
          ) : (
            <p>{t("viewerNote")}</p>
          )}

          <div role="alert">
            {formError && (
              <p style={{ color: "var(--red-fg)" }}>
                <span aria-hidden="true">✕</span> {formError}
              </p>
            )}
          </div>

          {tokens === null ? (
            !listError && <PageState state="loading" />
          ) : tokens.length === 0 ? (
            <PageState state="empty" emptyText={t("emptyTokens")} />
          ) : (
            <div className="table-scroll" style={{ marginTop: "var(--space-3, 1rem)" }}>
              <table className="data-table list-table pat-token-table table-fixed-pct tmin-64" aria-label={t("patTableAria")}>
                <caption className="sr-only">{t("patTableCaption")}</caption>
                <ColGroup widths={TOKEN_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{t("colLabel")}</th>
                    <th scope="col">{t("colIdentifier")}</th>
                    <th scope="col">{t("colScopes")}</th>
                    <th scope="col">{tc("status")}</th>
                    <th scope="col">{t("colCreated")}</th>
                    <th scope="col">{t("colExpires")}</th>
                    <th scope="col">{t("colLastUsed")}</th>
                    <th scope="col">{tc("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((tok) => {
                    const s = TOKEN_STATUS[tok.status];
                    return (
                      <tr key={tok.id}>
                        <td className="cell-truncate" title={tok.label}>{tok.label}</td>
                        <td>
                          <code>{maskedId(tok.display_id)}</code>
                        </td>
                        <td>{tok.scopes.split(",").includes("write") ? t("scopeReadWrite") : t("scopeRead")}</td>
                        <td>
                          <span className={`status-chip ${s.cls}`}>
                            <span aria-hidden="true">{s.icon}</span> {t(s.key)}
                          </span>
                        </td>
                        <td className="cell-nowrap">{fmtShort(tok.created_at, locale)}</td>
                        <td className="cell-nowrap">{tok.expires_at ? fmtShort(tok.expires_at, locale) : "—"}</td>
                        <td className="cell-nowrap">{tok.last_used_at ? fmtShort(tok.last_used_at, locale) : t("neverUsed")}</td>
                        <td className="sizing-actions-cell">
                          {tok.status === "active" && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => void revoke(tok)}
                              aria-label={t("revokeAria", { p1: tok.label })}
                            >
                              {t("revokeButton")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {revealed && <TokenRevealModal token={revealed} origin={typeof window === "undefined" ? "" : window.location.origin} onClose={() => setRevealed(null)} />}
    </section>
  );
}

export default function ConnectedAppsPage() {
  const t = useTranslations("pages.connectedApps");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(() => {
    setError(null);
    api
      .get<ConnectedApp[]>("/api/oauth/apps")
      .then((r) => setApps(r.data))
      .catch((e) => setError(e instanceof ApiError ? e.message : t("errLoadApps")));
  }, []);

  useEffect(load, [load]);

  function revoke(app: ConnectedApp) {
    confirm(t("appRevokeConfirmTitle", { p1: app.name }), () => void doRevoke(app), {
      body: t("appRevokeBody"),
      confirmLabel: t("revokeButton"),
    });
  }

  async function doRevoke(app: ConnectedApp) {
    setBusyId(app.client_id);
    try {
      await api.delete(`/api/oauth/apps/${encodeURIComponent(app.client_id)}`);
      toast(t("appRevokedToast", { p1: app.name }));
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errRevoke"), "alert");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main aria-labelledby="apps-heading">
      {confirmDialog}
      <div className="page-header-row">
        <h1 id="apps-heading">{t("h1")}</h1>
        <span className="ml-auto">
          <PrimaryAction readOnly inline label={t("connectButton")} onClick={() => setGuideOpen((v) => !v)} />
        </span>
      </div>
      {guideOpen && (
        <section aria-label={t("guideAria")} className="market-section mb-3">
          <h2 className=" mb-1">{t("guideHeading")}</h2>
          <ol className="sizing-note-list">
            <li>{t("guideStep1")}</li>
            <li>{t("guideStep2")}</li>
            <li>{t("guideStep3")}</li>
          </ol>
          <p className="mb-0">
            <code>{typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`}</code>
          </p>
        </section>
      )}
      <p className="objective">{t("intro")}</p>
      {error && <PageState state="error" errorText={error} onRetry={load} />}
      {!error && apps === null && <PageState state="loading" />}
      {!error && apps?.length === 0 && <PageState state="empty" emptyText={t("emptyApps")} />}
      {!error && apps && apps.length > 0 && (
        <table className="data-table list-table" aria-label={t("appsTableAria")}>
          <caption className="sr-only">{t("appsTableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("colApp")}</th>
              <th scope="col">{tc("status")}</th>
              <th scope="col">{t("colScopes")}</th>
              <th scope="col">{t("colLastUsed")}</th>
              <th scope="col">{tc("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.client_id}>
                <td>{a.name}</td>
                <td>
                  <span className={`status-chip ${a.verified ? "status-green" : "status-amber"}`}>
                    <span aria-hidden="true">{a.verified ? "●" : "◐"}</span> {a.verified ? t("verified") : t("unverified")}
                  </span>
                </td>
                <td>{a.scopes}</td>
                <td>{a.last_used_at ? formatDateTime(a.last_used_at, locale) : t("neverUsed")}</td>
                <td className="sizing-actions-cell">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void revoke(a)}
                    disabled={busyId === a.client_id}
                    aria-label={t("appRevokeAria", { p1: a.name })}
                  >
                    {t("revokeButton")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PersonalTokensSection />
    </main>
  );
}
