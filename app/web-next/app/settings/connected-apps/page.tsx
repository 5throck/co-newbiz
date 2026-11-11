// biome-ignore-all format: static-source pins (connected-apps-page.test.ts) read exact source shapes — biome's layout would reflow them; hand-placed suppressions above each diagnostic keep the file reviewable.
"use client";

// 연결된 앱 — ADR-0154 §2 (Revocation UI) + 개인 API 토큰 자가발급
// (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.2).
// 1) 호스팅 AI 앱(OAuth): 커넥터 주소 + 연결 방법 + 허용한 앱 목록.
// 2) 개인 API 토큰: 로컬 stdio MCP 서버·스크립트용 발급/목록/해지. 발급·해지는 사람 웹 세션 전용(403 session_required).
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, ApiError } from "../../../lib/api.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import {
  canIssueToken,
  canIssueWriteToken,
  remainingTokenSlots,
  TOKEN_ACTIVE_CAP,
  TOKEN_EXPIRY_DAYS,
  countByStatus,
  expiryLabel,
  filterTokensByStatus,
  isExpiringSoon,
  relativeParts,
  writeScopeNoteKey,
  type TokenStatusFilter,
} from "../../../lib/token-issue-access.ts";
import { Button, FilterChip, PageState, useToast } from "../../../components/ui.tsx";
import { ColGroup } from "../../../components/ui.tsx";
import { RowMenu, useConfirm, type RowMenuItem } from "../../../components/crud.tsx";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { intlTag, isLocale } from "../../../i18n/config.ts";

// 개인 API 토큰 목록 표 열 비율 — §2.4 amendment (C7): 8열 → 5열. 토큰 칸에 라벨·상태 칩·
// (권한·식별자 캡션 줄)을 계층으로 모으고 만료/마지막 사용/생성은 넓게, 작업은 RowMenu.
const TOKEN_COL_PCT = [34, 24, 16, 16, 10] as const;

const APP_COL_PCT = [26, 16, 28, 16, 14] as const;

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

const EXPIRY_KEY: Record<number, string> = { 7: "expiry7", 30: "expiry30", 90: "expiry90", 180: "expiry180" };
const EXPIRY_OPTIONS = TOKEN_EXPIRY_DAYS.map((days) => ({ days, key: EXPIRY_KEY[days] ?? "expiry30" }));

// Compact date-time for the token table cells (e.g. "26. 10. 11. 15:04").
function fmtShort(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(isLocale(locale) ? locale : "ko"), {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(iso));
}

// 마지막 사용: "5분 전" 같은 상대 표기 (1분 미만은 "방금 전"), 정확한 시각은 title로.
function relativeAgo(iso: string, locale: string, justNow: string): string {
  const parts = relativeParts(iso, Date.now());
  if (!parts) return justNow;
  return new Intl.RelativeTimeFormat(intlTag(isLocale(locale) ? locale : "ko"), { numeric: "auto" }).format(
    parts.value,
    parts.unit,
  );
}

// 목록에는 접두어 + 마지막 6자만 노출 (전체 시크릿은 1회 모달에서만)
function maskedId(displayId: string): string {
  return `cnb_pat_••••${displayId}`;
}

// ── 1회 노출 모달: 시크릿은 이 컴포넌트 상태에만 존재하고 닫으면 사라진다 ──
// §2.4 (C9): panel is capped at min(85dvh, 48rem) with the body scrolling
// internally and the footer pinned outside the scroll area, so the primary
// "저장했습니다" button stays visible (and in the focus order) at ~720px
// viewports. Both copy actions announce through the single aria-live status.
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
  const [copied, setCopied] = useState<{ kind: "token" | "snippet"; ok: boolean } | null>(null);
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

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied({ kind: "token", ok: true });
    } catch {
      inputRef.current?.select();
      setCopied({ kind: "token", ok: false });
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied({ kind: "snippet", ok: true });
    } catch {
      setCopied({ kind: "snippet", ok: false });
    }
  }

  const copyStatus =
    copied === null
      ? ""
      : copied.ok
        ? copied.kind === "token"
          ? t("copiedOk")
          : t("revealSnippetCopiedOk")
        : copied.kind === "token"
          ? t("copiedFail")
          : t("revealSnippetCopyFail");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal-backdrop pattern shared with crud.tsx (mousedown outside the panel closes; the panel is the interactive surface)
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-reveal-heading"
        onKeyDown={onKeyDown}
        style={{ maxWidth: "46rem", width: "100%", maxHeight: "min(85dvh, 48rem)", display: "flex", flexDirection: "column" }}
      >
        <div style={{ overflowY: "auto", minHeight: 0, paddingRight: "0.25rem" }}>
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
            <Button variant="ghost" onClick={() => void copyToken()}>
              {tc("copy")}
            </Button>
            <Button variant="ghost" onClick={() => void copySnippet()}>
              {t("revealSnippetCopy")}
            </Button>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {copyStatus}
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
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
            marginTop: "var(--space-3, 1rem)",
            paddingTop: "var(--space-3, 1rem)",
            borderTop: "1px solid var(--border)",
          }}
        >
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
  const canIssue = canIssueToken(me?.role);
  const canWrite = canIssueWriteToken(me?.role);
  const writeNoteKey = writeScopeNoteKey(me?.role);
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
  const [statusFilter, setStatusFilter] = useState<TokenStatusFilter>("active");
  const nowMs = Date.now();
  const counts = countByStatus(tokens ?? []);
  const inactiveCount = counts.expired + counts.revoked;
  // 단일 술어: 목록과 "곧 만료" 칩 개수가 같은 판정을 공유한다.
  const visibleTokens = filterTokensByStatus(tokens ?? [], statusFilter, nowMs);
  const slotsLeft = remainingTokenSlots((tokens ?? []).filter((x) => x.status === "active").length);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: t is only read in the error fallback (listErrorText) — adding it would refetch on translator identity churn (house pattern, deals board load)
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

  // §2.4 (C8): the masked identifier is not secret (prefix + last 6, already
  // shown in the row) — copying it is a support-request convenience.
  async function copyTokenId(tok: PersonalToken) {
    try {
      await navigator.clipboard.writeText(maskedId(tok.display_id));
      toast(t("copiedOk"));
    } catch {
      toast(t("copiedFail"), "alert");
    }
  }

  // §2.4 (C8): the row stays neutral — the only actions live in the overflow
  // menu, and the danger styling appears at the commitment point (the
  // ConfirmDialog's btn-danger), not on every row.
  function menuItems(tok: PersonalToken): RowMenuItem[] {
    return [
      { key: "copy-id", label: t("menuCopyId"), onSelect: () => void copyTokenId(tok) },
      { key: "revoke", label: t("revokeButton"), danger: true, separatorBefore: true, onSelect: () => revoke(tok) },
    ];
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
                    aria-describedby="pat-label-help"
                  />
                  <p id="pat-label-help" className="pat-help">{t("labelHelp")}</p>
                </div>
                <fieldset className="pat-field pat-scope-field">
                  <legend className="pat-field-label">{t("scopeLegend")}</legend>
                  <label>
                    <input type="radio" name="pat-scope" checked={!withWrite} onChange={() => setWithWrite(false)} />{" "}
                    {t("scopeRead")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pat-scope"
                      checked={withWrite}
                      disabled={!canWrite}
                      aria-describedby={writeNoteKey ? "pat-write-note" : undefined}
                      onChange={() => setWithWrite(true)}
                    />{" "}
                    {t("scopeReadWrite")}
                  </label>
                  <p className="pat-help">{t("scopeHelp")}</p>
                  {writeNoteKey && (
                    <p id="pat-write-note" className="pat-help">
                      {t(writeNoteKey)}
                    </p>
                  )}
                </fieldset>
                <div className="pat-field">
                  <label htmlFor="pat-expiry" className="pat-field-label">
                    {t("expiryField")}
                  </label>
                  <select
                    id="pat-expiry"
                    className="form-input"
                    value={expiresInDays}
                    aria-describedby="pat-expiry-help"
                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.days} value={o.days}>
                        {t(o.key)}
                      </option>
                    ))}
                  </select>
                  <p id="pat-expiry-help" className="pat-help">{t("expiryHelp")}</p>
                </div>
                <div className="pat-submit">
                  <Button variant="primary" type="submit" disabled={submitting || slotsLeft === 0}>
                    {t("issueButton")}
                  </Button>
                  {canIssue && tokens !== null && (
                    <p className="pat-help" role="status">
                      {slotsLeft === 0 ? t("slotsFull", { p1: TOKEN_ACTIVE_CAP }) : t("slotsRemaining", { p1: slotsLeft, p2: TOKEN_ACTIVE_CAP })}
                    </p>
                  )}
                </div>
              </div>
            </form>
          ) : me?.role === "admin" ? (
            // E2 (design 2026-11-11-owner-decisions-intake-batch §4.2): the issue
            // form hides for admins behind a muted catalog note — existing tokens
            // stay valid until expiry.
            <p className="pat-help">{t("noIssueAdmin")}</p>
          ) : (
            <p className="objective">{t("noSessionRoleNote")}</p>
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
            <>
              <div className="pat-filter-row">
                {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would drag in UA form styling that alters the filter-chip visual contract; the group role + aria-label is the deliberate a11y shape */}
                <div role="group" aria-label={t("filterAria")} className="pat-filter-chips">
                  {(
                    [
                      ["active", "filterActive", counts.active],
                      ["expiring", "filterExpiring", (tokens ?? []).filter((x) => isExpiringSoon(x.status, x.expires_at, nowMs)).length],
                      ["expired", "filterExpired", counts.expired],
                      ["revoked", "filterRevoked", counts.revoked],
                      ["all", "filterAll", tokens.length],
                    ] as const
                  ).map(([value, key, n]) => (
                    <FilterChip key={value} selected={statusFilter === value} onClick={() => setStatusFilter(value)}>
                      {t(key, { p1: n })}
                    </FilterChip>
                  ))}
                </div>
                {inactiveCount > 0 && (statusFilter === "active" || statusFilter === "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={statusFilter === "all"}
                    aria-controls={visibleTokens.length > 0 ? "pat-token-table" : undefined}
                    onClick={() => setStatusFilter(statusFilter === "all" ? "active" : "all")}
                  >
                    {statusFilter === "all" ? t("hideInactive") : t("showInactive", { p1: inactiveCount })}
                  </Button>
                )}
              </div>
              {visibleTokens.length === 0 ? (
                <PageState state="empty" emptyText={t("emptyTokensFiltered")} />
              ) : (
                <div className="table-scroll" style={{ marginTop: "var(--space-3, 1rem)" }}>
                  <table id="pat-token-table" className="data-table list-table pat-token-table table-fixed-pct tmin-48" aria-label={t("patTableAria")}>
                    <caption className="sr-only">{t("patTableCaption")}</caption>
                    <ColGroup widths={TOKEN_COL_PCT} />
                    <thead>
                      <tr>
                        <th scope="col">{t("colToken")}</th>
                        <th scope="col">{t("colExpires")}</th>
                        <th scope="col">{t("colLastUsed")}</th>
                        <th scope="col">{t("colCreated")}</th>
                        <th scope="col">{tc("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTokens.map((tok) => {
                        const s = TOKEN_STATUS[tok.status];
                        const exp = expiryLabel(tok.status, tok.expires_at, nowMs);
                        const soon = isExpiringSoon(tok.status, tok.expires_at, nowMs);
                        return (
                          <tr key={tok.id}>
                            <td>
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="cell-truncate" title={tok.label}>{tok.label}</span>
                                <span className={`status-chip ${s.cls} cell-nowrap`}>
                                  <span aria-hidden="true">{s.icon}</span> {t(s.key)}
                                </span>
                              </div>
                              {/* §2.4 (C7): scope + masked identifier as a text caption line (never colour-only). */}
                              <span className="mt-[0.15rem] block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                {tok.scopes.split(",").includes("write") ? t("scopeReadWrite") : t("scopeRead")}
                                {" · "}
                                <code>{maskedId(tok.display_id)}</code>
                              </span>
                            </td>
                            <td className="cell-nowrap">{tok.expires_at ? (
                              <span className="pat-expiry">
                                <span>{fmtShort(tok.expires_at, locale)}</span>
                                {exp.kind === "days" && (
                                  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the aria-label enriches the badge's announcement where a role supports it; giving the bare span a live/interactive role would change what AT announces (behavior change, not this batch)
                                  <span className="pat-dn" aria-label={t("expiryDaysLeftAria", { p1: exp.days })}>
                                    {t("expiryDaysLeft", { p1: exp.days })}
                                  </span>
                                )}
                                {exp.kind === "expired" && <span className="pat-dn">{t("expiryExpiredBadge")}</span>}
                                {soon && (
                                  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: same as the D-n badge above — the label duplicates visible text; adding a role would change the announced output
                                  <span className="status-chip status-amber" aria-label={t("expiringSoonAria")}>
                                    <span aria-hidden="true">⚠</span> {t("expiringSoon")}
                                  </span>
                                )}
                              </span>
                            ) : "—"}</td>
                            <td className="cell-nowrap" title={tok.last_used_at ? fmtShort(tok.last_used_at, locale) : undefined}>
                              {tok.last_used_at ? relativeAgo(tok.last_used_at, locale, t("justNow")) : t("neverUsed")}
                            </td>
                            <td className="cell-nowrap">{fmtShort(tok.created_at, locale)}</td>
                            <td className="sizing-actions-cell">
                              {tok.status === "active" ? (
                                <RowMenu label={t("rowMenuAria", { p1: tok.label })} items={menuItems(tok)} />
                              ) : (
                                "—"
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
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const connectorUrl = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;
  const urlRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  // biome-ignore lint/correctness/useExhaustiveDependencies: t is only read in the error fallback — adding it would refetch on translator identity churn (house pattern, deals board load)
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

  async function copyConnector() {
    try {
      await navigator.clipboard.writeText(connectorUrl);
      setCopied("ok");
    } catch {
      urlRef.current?.select();
      setCopied("fail");
    }
  }

  return (
    <main aria-labelledby="apps-heading">
      {confirmDialog}
      <div className="page-header-row">
        <h1 id="apps-heading">{t("h1")}</h1>
      </div>
      <p className="objective">{t("intro")}</p>

      <section aria-labelledby="hosted-heading" className="market-section">
        <h2 id="hosted-heading">{t("appsHeading")}</h2>
        <p className="objective">{t("appsIntro")}</p>
        <div className="connector-box">
          <label htmlFor="connector-url" className="pat-field-label">{t("connectorLabel")}</label>
          <div className="connector-row">
            <input
              id="connector-url"
              ref={urlRef}
              readOnly
              className="form-input connector-url"
              value={connectorUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="primary" onClick={() => void copyConnector()} aria-label={t("connectorCopyAria")}>
              {t("connectorCopy")}
            </Button>
          </div>
          <p role="status" aria-live="polite" className="pat-help">
            {copied === "ok" ? t("connectorCopied") : copied === "fail" ? t("connectorCopyFail") : ""}
          </p>
        </div>
        <h3 className="mb-1">{t("guideHeading")}</h3>
        <ol className="sizing-note-list" aria-label={t("guideAria")}>
          <li>{t("guideStep1")}</li>
          <li>{t("guideStep2")}</li>
          <li>{t("guideStep3")}</li>
        </ol>

        {error && <PageState state="error" errorText={error} onRetry={load} />}
        {!error && apps === null && <PageState state="loading" />}
        {!error && apps?.length === 0 && <PageState state="empty" emptyText={t("emptyApps")} />}
        {!error && apps && apps.length > 0 && (
          <div className="table-scroll">
            <table className="data-table list-table table-fixed-pct tmin-64" aria-label={t("appsTableAria")}>
              <caption className="sr-only">{t("appsTableCaption")}</caption>
              <ColGroup widths={APP_COL_PCT} />
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
                    <td className="cell-truncate" title={a.name}>{a.name}</td>
                    <td>
                      <span className={`status-chip ${a.verified ? "status-green" : "status-amber"}`}>
                        <span aria-hidden="true">{a.verified ? "●" : "◐"}</span> {a.verified ? t("verified") : t("unverified")}
                      </span>
                    </td>
                    <td className="cell-truncate" title={a.scopes}><code>{a.scopes}</code></td>
                    <td className="cell-nowrap" title={a.last_used_at ? formatDateTime(a.last_used_at, locale) : undefined}>
                      {a.last_used_at ? relativeAgo(a.last_used_at, locale, t("justNow")) : t("neverUsed")}
                    </td>
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
          </div>
        )}
      </section>

      <PersonalTokensSection />
    </main>
  );
}
