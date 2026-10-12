"use client";

// 연결된 앱 — ADR-0154 §2 (Revocation UI) + 개인 API 토큰 자가발급
// (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.2).
// 상단: OAuth로 허용한 MCP 커넥터 목록. 하단: 로컬 stdio MCP 서버·스크립트용
// 개인 API 토큰 발급/목록/해지. 발급·해지는 사람 웹 세션 전용(403 session_required).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { Button, PageState, PrimaryAction, useToast } from "../../../components/ui.tsx";
import { ColGroup } from "../../../components/ui.tsx";
import { useConfirm } from "../../../components/crud.tsx";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";

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

// 상태는 아이콘+텍스트로 전달 (design-guide §3.2 — 색 단독 금지)
const TOKEN_STATUS: Record<PersonalToken["status"], { cls: string; icon: string; label: string }> = {
  active: { cls: "status-green", icon: "●", label: "활성" },
  expired: { cls: "status-amber", icon: "◐", label: "만료됨" },
  revoked: { cls: "status-unknown", icon: "○", label: "해지됨" },
};

const EXPIRY_OPTIONS = [
  { days: 7, caption: "7일 — 짧은 테스트용" },
  { days: 30, caption: "30일 — 기본값" },
  { days: 90, caption: "90일 — 최대 허용 기간" },
];

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR") : "사용 기록 없음";
}

// Compact date-time for the token table cells (e.g. "26. 10. 11. 15:04").
function fmtShort(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short", hour12: false })
    : "사용 기록 없음";
}

function scopeLabel(scopes: string): string {
  // The API returns a comma-joined string — parse instead of includes() over
  // the raw value (a substring hit would be a false positive).
  return scopes.split(",").includes("write") ? "읽기·쓰기" : "읽기 전용";
}

// 목록에는 접두어 + 마지막 6자만 노출 (전체 시크릿은 1회 모달에서만)
function maskedId(displayId: string): string {
  return `cnb_pat_••••${displayId}`;
}

/** 발급 오류 코드 → 실행 가능한 한국어 안내 */
function issueErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "session_required")
      return "토큰 발급은 로그인한 웹 세션에서만 할 수 있습니다. 다시 로그인한 뒤 이 화면에서 시도해 주세요. (토큰·에이전트로는 토큰을 만들 수 없습니다.)";
    if (e.code === "token_limit_reached")
      return "활성 토큰이 이미 최대 5개입니다. 더 발급하려면 기존 토큰을 하나 해지한 뒤 다시 시도해 주세요.";
    if (e.code === "rate_limited")
      return "발급 시도가 너무 많습니다. 1시간에 최대 10회까지 발급할 수 있습니다. 잠시 후 다시 시도해 주세요.";
    if (e.code === "role_required" || e.code === "role_forbidden")
      return "쓰기 권한 토큰은 분석가(analyst) 계정에서만 발급할 수 있습니다.";
    if (e.code === "invalid_request") return "입력값을 확인해 주세요. 라벨과 권한, 유효기간(7·30·90일)을 다시 선택해 주세요.";
    return `토큰 발급에 실패했습니다. (${e.code}) 잠시 후 다시 시도해 주세요.`;
  }
  return "토큰 발급에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

function listErrorText(e: unknown): string {
  return e instanceof ApiError ? `토큰 목록을 불러오지 못했습니다. (${e.code})` : "토큰 목록을 불러오지 못했습니다.";
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
        <h2 id="token-reveal-heading">토큰이 발급되었습니다</h2>
        <p>
          이 토큰은 <strong>지금 이 화면에서만</strong> 표시되며 다시는 보여주지 않습니다. 아래 값을 지금 MCP 클라이언트
          설정에 저장해 주세요.
        </p>
        <input
          ref={inputRef}
          readOnly
          value={token}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="발급된 개인 API 토큰"
          style={{ width: "100%", fontFamily: "var(--font-mono, monospace)" }}
        />
        <div style={{ display: "flex", gap: "var(--space-2, 0.5rem)", marginTop: "var(--space-2, 0.5rem)" }}>
          <Button variant="ghost" onClick={() => void copy()}>
            복사
          </Button>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {copied === "ok" ? "복사되었습니다" : copied === "fail" ? "복사에 실패했습니다. 텍스트를 직접 선택해 복사해 주세요" : ""}
        </p>
        <h3>MCP 클라이언트 설정 예시</h3>
        <pre style={{ overflowX: "auto", fontSize: "var(--fs-caption)" }}>
          <code>{snippet}</code>
        </pre>
        <p>
          <code>CO_NEWBIZ_API_TOKEN</code>에는 위 토큰을, <code>CO_NEWBIZ_API_BASE_URL</code>에는 이 앱의 주소를
          넣습니다. stdio 서버 실행 파일은 저장소의 <code>mcp/co-newbiz/index.ts</code>입니다.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-3, 1rem)" }}>
          <Button variant="primary" onClick={onClose}>
            저장했습니다
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonalTokensSection() {
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

  const load = useCallback(() => {
    setListError(null);
    api
      .get<PersonalToken[]>("/api/tokens")
      .then((r) => setTokens(r.data.map((t) => ({ ...t, scopes: String(t.scopes ?? "") }))))
      .catch((e) => setListError(listErrorText(e)));
  }, []);

  useEffect(load, [load]);

  async function submit() {
    setFormError(null);
    if (!label.trim()) {
      setFormError("라벨을 입력해 주세요. (예: 내 노트북 stdio MCP)");
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

  function revoke(t: PersonalToken) {
    confirm(
      `"${t.label}" 토큰 해지`,
      () => void doRevoke(t),
      {
        body: "해지는 되돌릴 수 없으며, 이 토큰을 사용 중인 앱은 즉시 접근이 차단됩니다.",
        confirmLabel: "해지",
      },
    );
  }

  async function doRevoke(t: PersonalToken) {
    try {
      await api.delete(`/api/tokens/${encodeURIComponent(t.id)}`);
      toast(`"${t.label}" 토큰을 해지했습니다.`);
      load();
    } catch (e) {
      toast(
        e instanceof ApiError && e.code === "session_required"
          ? "토큰 해지는 로그인한 웹 세션에서만 할 수 있습니다. 다시 로그인해 주세요."
          : e instanceof ApiError
            ? `해지하지 못했습니다. (${e.code})`
            : "해지하지 못했습니다.",
        "alert",
      );
    }
  }

  return (
    <section aria-labelledby="pat-heading" className="market-section" style={{ marginTop: "var(--space-5, 1.5rem)" }}>
      {confirmDialog}
      <h2 id="pat-heading">개인 API 토큰</h2>
      <p className="objective">
        로컬 stdio MCP 서버(<code>mcp/co-newbiz</code>)나 스크립트를 내 계정으로 연결할 때 발급합니다. 호스팅 AI 앱은
        위의 커넥터 주소로 연결하고, 개인 토큰을 붙여넣지 마세요. 발급과 해지는 로그인한 웹 세션에서만 가능합니다 —
        토큰이나 에이전트로는 토큰을 만들거나 해지할 수 없습니다.
      </p>

      {listError && (
        <PageState state="error" errorText={listError} onRetry={load} />
      )}

      {!listError && (
        <>
          {canIssue ? (
            <form
              aria-label="개인 API 토큰 발급"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="pat-form-grid">
                <div className="pat-field">
                  <label htmlFor="pat-label" className="pat-field-label">
                    라벨 (필수)
                  </label>
                  <input
                    id="pat-label"
                    className="form-input"
                    value={label}
                    maxLength={80}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="예: 내 노트북 stdio MCP"
                  />
                </div>
                <fieldset className="pat-field pat-scope-field">
                  <legend className="pat-field-label">권한</legend>
                  <label>
                    <input type="radio" name="pat-scope" checked={!withWrite} onChange={() => setWithWrite(false)} />{" "}
                    읽기 전용
                  </label>
                  <label>
                    <input type="radio" name="pat-scope" checked={withWrite} onChange={() => setWithWrite(true)} />{" "}
                    읽기·쓰기
                  </label>
                </fieldset>
                <div className="pat-field">
                  <label htmlFor="pat-expiry" className="pat-field-label">
                    유효기간
                  </label>
                  <select
                    id="pat-expiry"
                    className="form-input"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.days} value={o.days}>
                        {o.caption}
                      </option>
                    ))}
                  </select>
                </div>
                <Button variant="primary" type="submit" disabled={submitting}>
                  토큰 발급
                </Button>
              </div>
            </form>
          ) : (
            <p>
              보기(viewer) 계정은 읽기 전용 토큰만 사용할 수 있어 이 화면에서 토큰을 발급할 수 없습니다. 목록 확인과
              해지는 가능합니다.
            </p>
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
            <PageState state="empty" emptyText="발급한 개인 API 토큰이 없습니다." />
          ) : (
            <div className="table-scroll" style={{ marginTop: "var(--space-3, 1rem)" }}>
              <table className="data-table list-table pat-token-table table-fixed-pct tmin-64" aria-label="개인 API 토큰 목록">
                <caption className="sr-only">내가 발급한 개인 API 토큰 목록</caption>
                <ColGroup widths={TOKEN_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">라벨</th>
                    <th scope="col">식별자</th>
                    <th scope="col">권한</th>
                    <th scope="col">상태</th>
                    <th scope="col">생성</th>
                    <th scope="col">만료</th>
                    <th scope="col">마지막 사용</th>
                    <th scope="col">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => {
                    const s = TOKEN_STATUS[t.status];
                    return (
                      <tr key={t.id}>
                        <td className="cell-truncate" title={t.label}>{t.label}</td>
                        <td>
                          <code>{maskedId(t.display_id)}</code>
                        </td>
                        <td>{scopeLabel(t.scopes)}</td>
                        <td>
                          <span className={`status-chip ${s.cls}`}>
                            <span aria-hidden="true">{s.icon}</span> {s.label}
                          </span>
                        </td>
                        <td className="cell-nowrap">{fmtShort(t.created_at)}</td>
                        <td className="cell-nowrap">{t.expires_at ? fmtShort(t.expires_at) : "—"}</td>
                        <td className="cell-nowrap">{fmtShort(t.last_used_at)}</td>
                        <td className="sizing-actions-cell">
                          {t.status === "active" && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => void revoke(t)}
                              aria-label={`${t.label} 토큰 해지`}
                            >
                              해지
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
      .catch((e) => setError(e instanceof ApiError ? e.message : "목록을 불러오지 못했습니다."));
  }, []);

  useEffect(load, [load]);

  function revoke(app: ConnectedApp) {
    confirm(`"${app.name}" 연결 해지`, () => void doRevoke(app), {
      body: "이 앱은 즉시 접근 권한을 잃습니다.",
      confirmLabel: "해지",
    });
  }

  async function doRevoke(app: ConnectedApp) {
    setBusyId(app.client_id);
    try {
      await api.delete(`/api/oauth/apps/${encodeURIComponent(app.client_id)}`);
      toast(`"${app.name}" 연결을 해지했습니다.`);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "해지하지 못했습니다.", "alert");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main aria-labelledby="apps-heading">
      {confirmDialog}
      <div className="page-header-row">
        <h1 id="apps-heading">연결된 앱</h1>
        <span className="ml-auto">
          <PrimaryAction readOnly inline label="앱 연결하기" onClick={() => setGuideOpen((v) => !v)} />
        </span>
      </div>
      {guideOpen && (
        <section aria-label="앱 연결 방법" className="market-section mb-3">
          <h2 className="text-[length:var(--fs-body)] mb-1">앱 연결 방법</h2>
          <ol className="sizing-note-list">
            <li>사용하는 AI 앱의 커넥터(MCP) 설정에서 아래 주소를 추가합니다.</li>
            <li>앱이 이 화면으로 연결 허용 요청을 보내면 내용을 확인하고 직접 허용합니다. 앱은 내 권한 범위에서만 동작합니다.</li>
            <li>허용하면 이 목록에 나타나며, 아래 해지로 언제든 접근을 끊을 수 있습니다.</li>
          </ol>
          <p className="mb-0">
            <code>{typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`}</code>
          </p>
        </section>
      )}
      <p className="objective">
        호스팅 AI 앱(Claude.ai, ChatGPT 등)을 연결할 때는 위의 커넥터 주소를 사용하세요. 로컬 MCP 서버나 스크립트를 쓸
        때는 아래에서 개인 토큰을 발급합니다.
      </p>
      {error && <PageState state="error" errorText={error} onRetry={load} />}
      {!error && apps === null && <PageState state="loading" />}
      {!error && apps?.length === 0 && <PageState state="empty" emptyText="연결된 앱이 없습니다." />}
      {!error && apps && apps.length > 0 && (
        <table className="data-table list-table" aria-label="연결된 앱 목록">
          <caption className="sr-only">OAuth로 허용한 연결된 앱 목록</caption>
          <thead>
            <tr>
              <th scope="col">앱</th>
              <th scope="col">상태</th>
              <th scope="col">권한</th>
              <th scope="col">마지막 사용</th>
              <th scope="col">작업</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.client_id}>
                <td>{a.name}</td>
                <td>
                  <span className={`status-chip ${a.verified ? "status-green" : "status-amber"}`}>
                    <span aria-hidden="true">{a.verified ? "●" : "◐"}</span> {a.verified ? "검증됨" : "미검증"}
                  </span>
                </td>
                <td>{a.scopes}</td>
                <td>{fmt(a.last_used_at)}</td>
                <td className="sizing-actions-cell">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void revoke(a)}
                    disabled={busyId === a.client_id}
                    aria-label={`${a.name} 연결 해지`}
                  >
                    해지
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
