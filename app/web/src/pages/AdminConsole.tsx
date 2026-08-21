import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  type AdminUser,
  type AuditLogRow,
  type DataSourceRow,
  type RetentionPolicyRow,
  type ScheduleJobRow,
} from "../api.ts";

type Section = "users" | "audit" | "data-sources" | "schedule" | "database";

// Admin console — ui-spec §5. Only the sections the backend actually
// serves are rendered here: user management, audit log viewer, data-source
// presence (Wave 5.6A), and — since PR #65 batch 4 — the schedule-job
// registry and the retention-policy half of 데이터베이스 관리. Migration
// status / backup history have no endpoints, so that part of the DB row
// renders an explicit "no API yet" note instead of placeholders. The
// remaining designed sections (notifications, governance, glossary admin,
// master data, ADR/stage gate) stay TODO until their read endpoints exist.
export function AdminConsole() {
  const [section, setSection] = useState<Section>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[] | null>(null);
  const [sources, setSources] = useState<DataSourceRow[] | null>(null);
  const [jobs, setJobs] = useState<ScheduleJobRow[] | null>(null);
  const [retention, setRetention] = useState<RetentionPolicyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retentionFormError, setRetentionFormError] = useState<string | null>(null);
  const [retentionNotice, setRetentionNotice] = useState<string | null>(null);
  const [tableKey, setTableKey] = useState("");
  const [basis, setBasis] = useState("");
  const [months, setMonths] = useState("");
  const [action, setAction] = useState<"archive" | "delete">("archive");

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
    if (section === "schedule" && jobs === null) {
      api
        .get<ScheduleJobRow[]>("/api/admin/schedule-jobs")
        .then((res) => setJobs(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "database" && retention === null) {
      api
        .get<RetentionPolicyRow[]>("/api/admin/retention")
        .then((res) => setRetention(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
  }, [section, users, auditLog, sources, jobs, retention]);

  async function approve(userId: string) {
    await api.put(`/api/admin/users/${userId}`, { action: "approve" });
    setUsers(null);
  }

  // Optimistic enable/disable: flip locally, revert to the pre-toggle
  // snapshot when the server rejects (admin-only is already enforced
  // server-side, so a failure here is a real failure, not a permissions UI).
  async function toggleJob(jobKey: string, next: boolean) {
    const snapshot = jobs;
    setJobs((rows) => rows?.map((j) => (j.job_key === jobKey ? { ...j, enabled: next ? 1 : 0 } : j)) ?? rows);
    try {
      await api.put(`/api/admin/schedule-jobs/${encodeURIComponent(jobKey)}`, { enabled: next });
    } catch (err) {
      setJobs(snapshot);
      setError(err instanceof Error ? err.message : "작업 토글에 실패했습니다.");
    }
  }

  async function saveRetention(e: FormEvent) {
    e.preventDefault();
    setRetentionFormError(null);
    setRetentionNotice(null);
    const monthsValue = Number(months);
    if (!tableKey.trim() || !basis.trim()) {
      setRetentionFormError("테이블 키와 근거를 모두 입력하세요.");
      return;
    }
    if (!Number.isInteger(monthsValue) || monthsValue < 0) {
      setRetentionFormError("보존 기간(개월)은 0 이상의 정수여야 합니다.");
      return;
    }
    try {
      await api.post("/api/admin/retention", {
        table_key: tableKey.trim(),
        basis: basis.trim(),
        retention_months: monthsValue,
        action,
      });
      setRetentionNotice(`저장되었습니다 (${tableKey.trim()}).`);
      setTableKey("");
      setBasis("");
      setMonths("");
      setRetention(null); // re-fetch through the section effect
    } catch (err) {
      setRetentionFormError(err instanceof ApiError ? err.message : "정책 저장에 실패했습니다.");
    }
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
        <button type="button" aria-current={section === "schedule"} onClick={() => setSection("schedule")}>
          배치·스케줄 관리
        </button>
        <button type="button" aria-current={section === "database"} onClick={() => setSection("database")}>
          데이터베이스 관리
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

      {section === "schedule" &&
        (jobs === null ? (
          <p>불러오는 중...</p>
        ) : jobs.length === 0 ? (
          <p className="empty-state">데이터 없음 — 등록된 스케줄 작업이 없습니다.</p>
        ) : (
          <table className="admin-table">
            <caption className="sr-only">스케줄 작업 목록</caption>
            <thead>
              <tr>
                <th scope="col">작업 키</th>
                <th scope="col">스케줄 (cron)</th>
                <th scope="col">상태</th>
                <th scope="col">최근 실행</th>
                <th scope="col">작업</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.job_key}</td>
                  <td>
                    <code>{j.cron_expr}</code>
                  </td>
                  <td>
                    {j.enabled === 1 ? (
                      <span className="status-chip status-approved">
                        <span aria-hidden="true">●</span> 활성
                      </span>
                    ) : (
                      <span className="status-chip status-not-started">
                        <span aria-hidden="true">○</span> 비활성
                      </span>
                    )}
                  </td>
                  <td>
                    {j.last_run ? (
                      <>
                        {j.last_run.status}
                        {j.last_run.finished_at && ` · ${new Date(j.last_run.finished_at).toLocaleString("ko-KR")}`}
                        {j.last_run.error && <p className="cell-sub">{j.last_run.error}</p>}
                      </>
                    ) : (
                      "실행 이력 없음"
                    )}
                  </td>
                  <td>
                    <button type="button" onClick={() => toggleJob(j.job_key, j.enabled !== 1)}>
                      {j.enabled === 1 ? "비활성화" : "활성화"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {section === "database" && (
        <div>
          <p className="helper-note">
            이 섹션의 나머지(마이그레이션 상태·백업 이력)는 아직 API가 없습니다.
          </p>
          <h2>보존 정책 (Retention)</h2>
          {retention === null ? (
            <p>불러오는 중...</p>
          ) : retention.length === 0 ? (
            <p className="empty-state">데이터 없음 — 등록된 보존 정책이 없습니다.</p>
          ) : (
            <table className="admin-table">
              <caption className="sr-only">보존 정책 목록</caption>
              <thead>
                <tr>
                  <th scope="col">테이블 키</th>
                  <th scope="col">근거</th>
                  <th scope="col">보존 기간(개월)</th>
                  <th scope="col">조치</th>
                  <th scope="col">최근 적용</th>
                </tr>
              </thead>
              <tbody>
                {retention.map((r) => (
                  <tr key={r.table_key}>
                    <td>{r.table_key}</td>
                    <td>{r.basis}</td>
                    <td>{r.retention_months}</td>
                    <td>{r.action === "archive" ? "보관" : "삭제"}</td>
                    <td>{r.last_run_at ? new Date(r.last_run_at).toLocaleString("ko-KR") : "미실행"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>정책 생성/수정</h2>
          <p className="helper-note">
            같은 테이블 키로 저장하면 기존 정책이 수정됩니다(upsert). 모든 변경은 감사 로그에 기록됩니다.
          </p>
          <form onSubmit={saveRetention} className="run-form">
            <div className="run-form-row">
              <label htmlFor="retTableKey">테이블 키</label>
              <input id="retTableKey" value={tableKey} onChange={(e) => setTableKey(e.target.value)} required />
            </div>
            <div className="run-form-row">
              <label htmlFor="retBasis">근거</label>
              <input id="retBasis" value={basis} onChange={(e) => setBasis(e.target.value)} required />
            </div>
            <div className="run-form-row">
              <label htmlFor="retMonths">보존 기간(개월)</label>
              <input
                id="retMonths"
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                required
              />
            </div>
            <div className="run-form-row">
              <label htmlFor="retAction">조치</label>
              <select id="retAction" value={action} onChange={(e) => setAction(e.target.value === "delete" ? "delete" : "archive")}>
                <option value="archive">보관 (archive)</option>
                <option value="delete">삭제 (delete)</option>
              </select>
            </div>
            <button type="submit">정책 저장</button>
          </form>
          {retentionFormError && (
            <p role="alert" className="form-error">
              {retentionFormError}
            </p>
          )}
          {retentionNotice && <p className="form-success">{retentionNotice}</p>}
        </div>
      )}
    </main>
  );
}
