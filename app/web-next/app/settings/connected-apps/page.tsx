"use client";

// 연결된 앱 — ADR-0154 §2 (Revocation UI). 사용자가 OAuth로 허용한 MCP
// 커넥터 목록과 마지막 사용 시각을 보여주고, 해지하면 그 앱의 모든 액세스·
// 리프레시 토큰이 즉시 무효가 된다(다음 호출부터 401).
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import { Button, PageState, PrimaryAction, useToast } from "../../../components/ui.tsx";

interface ConnectedApp {
  client_id: string;
  name: string;
  verified: boolean;
  scopes: string;
  first_authorized_at: string;
  last_used_at: string | null;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR") : "사용 기록 없음";
}

export default function ConnectedAppsPage() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    setError(null);
    api
      .get<ConnectedApp[]>("/api/oauth/apps")
      .then((r) => setApps(r.data))
      .catch((e) => setError(e instanceof ApiError ? e.message : "목록을 불러오지 못했습니다."));
  }, []);

  useEffect(load, [load]);

  async function revoke(app: ConnectedApp) {
    if (!window.confirm(`"${app.name}" 연결을 해지할까요? 이 앱은 즉시 접근 권한을 잃습니다.`)) return;
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
      <div className="page-header-row">
        <h1 id="apps-heading">연결된 앱</h1>
        <span className="ml-auto">
          <PrimaryAction inline label="앱 연결하기" onClick={() => setGuideOpen((v) => !v)} />
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
          <p className="mb-0"><code>{typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`}</code></p>
        </section>
      )}
      <p className="objective">
        OAuth로 허용한 외부 AI 앱(MCP 커넥터) 목록입니다. 해지하면 그 앱의 모든 토큰이 즉시 무효가 됩니다.
      </p>
      {error && <PageState state="error" errorText={error} onRetry={load} />}
      {!error && apps === null && <PageState state="loading" />}
      {!error && apps?.length === 0 && <PageState state="empty" emptyText="연결된 앱이 없습니다." />}
      {!error && apps && apps.length > 0 && (
        <table className="data-table list-table" aria-label="연결된 앱 목록">
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
                    {a.verified ? "검증됨" : "미검증"}
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
    </main>
  );
}
