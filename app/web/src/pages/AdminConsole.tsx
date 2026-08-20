import { useEffect, useState } from "react";
import { api, type AdminUser, type AuditLogRow, type DataSourceRow } from "../api.ts";

type Section = "users" | "audit" | "data-sources";

// Admin console — ui-spec §5. Only the sections the Wave 5.6A backend
// actually serves are rendered here (user management, audit log viewer,
// data-source presence). Schedule/notification/governance/glossary/
// master-data admin sections stay TODO until their read endpoints exist.
export function AdminConsole() {
  const [section, setSection] = useState<Section>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[] | null>(null);
  const [sources, setSources] = useState<DataSourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (section === "users" && users === null) {
      api
        .get<AdminUser[]>("/api/admin/users")
        .then((res) => setUsers(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "audit" && auditLog === null) {
      api
        .get<AuditLogRow[]>("/api/admin/audit-log?limit=100")
        .then((res) => setAuditLog(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "data-sources" && sources === null) {
      api
        .get<DataSourceRow[]>("/api/admin/data-sources")
        .then((res) => setSources(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
  }, [section, users, auditLog, sources]);

  async function approve(userId: string) {
    await api.put(`/api/admin/users/${userId}`, { action: "approve" });
    setUsers(null);
  }

  return (
    <main className="admin-console-page">
      <h1>관리자 콘솔</h1>
      <nav className="tab-bar" aria-label="관리자 콘솔 섹션">
        <button type="button" aria-current={section === "users"} onClick={() => setSection("users")}>
          사용자 관리
        </button>
        <button type="button" aria-current={section === "audit"} onClick={() => setSection("audit")}>
          로그 관리
        </button>
        <button type="button" aria-current={section === "data-sources"} onClick={() => setSection("data-sources")}>
          데이터 소스 관리
        </button>
      </nav>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {section === "users" &&
        (users === null ? (
          <p>불러오는 중...</p>
        ) : (
          <table className="admin-table">
            <caption className="sr-only">사용자 목록</caption>
            <thead>
              <tr>
                <th scope="col">아이디</th>
                <th scope="col">역할</th>
                <th scope="col">상태</th>
                <th scope="col">가입일</th>
                <th scope="col">작업</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.user_id}</td>
                  <td>{u.role}</td>
                  <td>{u.status}</td>
                  <td>{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
                  <td>
                    {u.status === "pending" && (
                      <button type="button" onClick={() => approve(u.user_id)}>
                        승인
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {section === "audit" &&
        (auditLog === null ? (
          <p>불러오는 중...</p>
        ) : (
          <table className="admin-table">
            <caption className="sr-only">감사 로그 (append-only — 삭제 기능 없음)</caption>
            <thead>
              <tr>
                <th scope="col">시각</th>
                <th scope="col">행위자</th>
                <th scope="col">동작</th>
                <th scope="col">대상</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString("ko-KR")}</td>
                  <td>{row.actor_user_id}</td>
                  <td>{row.action}</td>
                  <td>{row.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {section === "data-sources" &&
        (sources === null ? (
          <p>불러오는 중...</p>
        ) : (
          <table className="admin-table">
            <caption className="sr-only">데이터 소스 — 키 존재 여부만 표시, 값은 절대 표시되지 않음</caption>
            <thead>
              <tr>
                <th scope="col">소스</th>
                <th scope="col">신뢰도 등급</th>
                <th scope="col">환경변수</th>
                <th scope="col">키 설정 여부</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.code}>
                  <td>{s.code}</td>
                  <td>{s.reliability_grade}</td>
                  <td>
                    <code>{s.key_var}</code>
                  </td>
                  <td>{s.key_present ? "설정됨" : "미설정"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </main>
  );
}
