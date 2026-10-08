"use client";

// OAuth 동의 화면 — ADR-0154 §2, design §4.2/§11.
// MCP 커넥터(ChatGPT·Claude.ai 등)가 로그인한 사용자를 대신해 co-newbiz에
// 접근하도록 허용할지 사람이 자기 웹 세션에서 결정한다. 화면 로드만으로는
// 아무 일도 일어나지 않으며(no action on load), 기본 동작은 하나("허용")다.
// 미검증 클라이언트는 텍스트 배지로 표시한다(색상만으로 구분하지 않음).
import { useEffect, useRef, useState } from "react";
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

const SCOPE_TEXT: Record<string, string> = {
  read: "읽기 — 접근 권한이 있는 검토 건·용어집·절차·알림을 조회합니다.",
  write: "쓰기 — 사용자 이름으로 검토 자료를 등록·수정합니다(게이트 승인·투자 결정은 불가).",
  propose: "제안 — 결정 제안만 기록합니다. 실제 결정은 사용자가 웹에서 직접 확인해야 합니다.",
};

const PARAM_KEYS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"];

export default function OAuthAuthorizePage() {
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api
      .get<ConsentInfo>(`/api/oauth/authorize${window.location.search}`)
      .then((r) => setInfo(r.data))
      .catch((e) => setError(e instanceof ApiError ? e.message : "인가 요청을 확인하지 못했습니다."));
  }, []);

  useEffect(() => {
    if (info || error) headingRef.current?.focus();
  }, [info, error]);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setStatus(decision === "approve" ? "허용 처리 중입니다." : "거부 처리 중입니다.");
    try {
      const params = new URLSearchParams(window.location.search);
      const body: Record<string, string> = { decision };
      for (const k of PARAM_KEYS) {
        const v = params.get(k);
        if (v !== null) body[k] = v;
      }
      const r = await api.post<{ redirect_to: string }>("/api/oauth/authorize", body);
      setStatus("연결 앱으로 돌아갑니다.");
      window.location.assign(r.data.redirect_to);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "처리하지 못했습니다.");
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
        {failed ? "연결 요청을 확인할 수 없습니다" : "외부 앱 연결 허용"}
      </h1>
      <p aria-live="polite" className="sr-only">{status}</p>
      {!info && !error && <PageState state="loading" />}
      {error && (
        <section aria-labelledby="invalid-heading">
          <h2 id="invalid-heading">요청을 처리할 수 없습니다</h2>
          <p role="alert">연결 요청 정보가 없거나 올바르지 않아 아무 권한도 허용하지 않았습니다. 연결하려는 앱에서 연결을 처음부터 다시 시작하세요.</p>
          <details className="review-dev"><summary>개발자 참고</summary><span>{error}</span></details>
          <div className="page-header-actions">
            <Link href="/settings/connected-apps" className="btn-primary">연결된 앱 보기</Link>
            <Link href="/deals" className="btn-ghost">검토/안건 보드로 이동</Link>
          </div>
        </section>
      )}
      {info && !info.valid && (
        <section aria-labelledby="invalid-heading">
          <h2 id="invalid-heading">요청을 처리할 수 없습니다</h2>
          <p role="alert">연결 요청이 올바르지 않아 아무 권한도 허용하지 않았습니다.</p>
          {info.error_description && <details className="review-dev"><summary>개발자 참고</summary><span>{info.error_description}</span></details>}
          {info.redirect_to && (
            <Button onClick={() => window.location.assign(info.redirect_to ?? "")}>앱으로 돌아가기</Button>
          )}
        </section>
      )}
      {info?.valid && info.client && (
        <section aria-labelledby="client-heading">
          <h2 id="client-heading">
            {info.client.name}{" "}
            <span className={`status-chip ${info.client.verified ? "status-green" : "status-amber"}`}>
              {info.client.verified ? "검증된 앱" : "미검증 앱"}
            </span>
          </h2>
          <p className="objective">
            이 앱이 <strong>{info.user_id}</strong> 계정의 권한 범위 안에서 co-newbiz에 접근하도록 허용합니다. 승인 후 돌아갈
            주소: <strong>{info.redirect_host}</strong>
          </p>
          {!info.client.verified && (
            <p>관리자가 확인하지 않은 앱입니다. 앱 이름과 돌아갈 주소를 직접 알고 있는 경우에만 허용하세요.</p>
          )}
          <h3>요청 권한</h3>
          <dl>
            {info.scopes?.map((s) => (
              <div key={s.scope}>
                <dt>{s.scope}</dt>
                <dd>
                  {SCOPE_TEXT[s.scope]}
                  {!s.allowed && <span className="status-chip status-red">현재 역할로는 부여할 수 없음</span>}
                </dd>
              </div>
            ))}
          </dl>
          <p>어떤 권한도 게이트 승인·투자 결정·종결을 실행하지 않습니다. 연결은 언제든 &ldquo;연결된 앱&rdquo; 화면에서 해지할 수 있습니다.</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void decide("approve")} disabled={busy || blocked}>
              허용
            </Button>
            <Button onClick={() => void decide("deny")} disabled={busy}>
              거부
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
