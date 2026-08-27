"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  type AdminUser,
  type AuditLogRow,
  type DataSourceRow,
  type RetentionPolicyRow,
  type ScheduleJobRow,
} from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";

type Section = "users" | "audit" | "data-sources" | "schedule" | "database" | "notifications" | "glossary" | "governance" | "master-data" | "adr";

interface AdminNotificationRow {
  project_id: string;
  trigger_type: string;
  severity: string;
  payload: string;
  channel: string;
  bundle: string;
  sent_at: string;
}

interface GlossaryTermRow {
  key: string;
  ko: string;
  en: string;
  category: string;
}

interface AdrRow {
  id: string;
  title: string;
  status: string;
  file: string;
}

interface MasterDataRow {
  id: string;
  raw_value: string;
  attempted_master_table: string;
  first_seen_at: string;
}

interface GovernanceDocRow {
  id: string;
  layer: string;
  key: string;
  title: string;
  scope: string;
  version: string;
  enforceability: string;
  owner_agent: string;
  doc_path: string;
  effective_from: string;
  superseded_by: string | null;
  review_cycle_months: number | null;
}

// Admin console — ui-spec §5. Sections the backend serves are rendered with
// real data (users, audit, data-sources, schedule-jobs, retention,
// notifications, glossary). Sections whose backend endpoints do not yet exist
// render an explicit "no API yet" note instead of placeholders, per the
// web-implementation-plan §3 gap rule (M4). The deferred-no-API sections are:
//   - governance (governance document registry — no read endpoint yet)
//   - master-data (staging_unmapped queue — no read endpoint yet)
//   - adr (ADR index — no read endpoint yet)
export function AdminConsole() {
  const [section, setSection] = useState<Section>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[] | null>(null);
  const [sources, setSources] = useState<DataSourceRow[] | null>(null);
  const [jobs, setJobs] = useState<ScheduleJobRow[] | null>(null);
  const [retention, setRetention] = useState<RetentionPolicyRow[] | null>(null);
  const [notifications, setNotifications] = useState<AdminNotificationRow[] | null>(null);
  const [glossary, setGlossary] = useState<GlossaryTermRow[] | null>(null);
  const [adrs, setAdrs] = useState<AdrRow[] | null>(null);
  const [masterData, setMasterData] = useState<MasterDataRow[] | null>(null);
  const [governance, setGovernance] = useState<GovernanceDocRow[] | null>(null);
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
    if (section === "notifications" && notifications === null) {
      api
        .get<AdminNotificationRow[]>("/api/notifications")
        .then((res) => setNotifications(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "glossary" && glossary === null) {
      api
        .get<GlossaryTermRow[]>("/api/glossary")
        .then((res) => setGlossary(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "adr" && adrs === null) {
      api
        .get<{ adrs: AdrRow[] }>("/api/admin/adr")
        .then((res) => setAdrs(res.data.adrs))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "master-data" && masterData === null) {
      api
        .get<MasterDataRow[]>("/api/admin/master-data")
        .then((res) => setMasterData(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "governance" && governance === null) {
      api
        .get<GovernanceDocRow[]>("/api/admin/governance")
        .then((res) => setGovernance(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
  }, [section, users, auditLog, sources, jobs, retention, notifications, glossary, adrs, masterData, governance]);

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
      <nav
        className="tab-nav my-4"
        aria-label="관리자 콘솔 섹션"
      >
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
        <button type="button" aria-current={section === "notifications"} onClick={() => setSection("notifications")}>
          알림·RAG 규칙
        </button>
        <button type="button" aria-current={section === "glossary"} onClick={() => setSection("glossary")}>
          용어집 관리
        </button>
        <button type="button" aria-current={section === "governance"} onClick={() => setSection("governance")}>
          거버넌스 문서
        </button>
        <button type="button" aria-current={section === "master-data"} onClick={() => setSection("master-data")}>
          마스터 데이터
        </button>
        <button type="button" aria-current={section === "adr"} onClick={() => setSection("adr")}>
          ADR 인덱스
        </button>
      </nav>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      {section === "users" &&
        (users === null ? (
          <p>불러오는 중...</p>
        ) : (
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
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
                      <button type="button" className="btn-premium" onClick={() => approve(u.user_id)}>
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
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
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
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
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
          <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 스케줄 작업이 없습니다.</p>
        ) : (
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
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
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[0.8rem] bg-[color:var(--green-bg)] text-[color:var(--green-fg)]">
                        <span aria-hidden="true">●</span> 활성
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[0.8rem] bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]">
                        <span aria-hidden="true">○</span> 비활성
                      </span>
                    )}
                  </td>
                  <td>
                    {j.last_run ? (
                      <>
                        {j.last_run.status}
                        {j.last_run.finished_at && ` · ${new Date(j.last_run.finished_at).toLocaleString("ko-KR")}`}
                        {j.last_run.error && <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">{j.last_run.error}</p>}
                      </>
                    ) : (
                      "실행 이력 없음"
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn-ghost" onClick={() => toggleJob(j.job_key, j.enabled !== 1)}>
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
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            이 섹션의 나머지(마이그레이션 상태·백업 이력)는 아직 API가 없습니다.
          </p>
          <h2>보존 정책 (Retention)</h2>
          {retention === null ? (
            <p>불러오는 중...</p>
          ) : retention.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 보존 정책이 없습니다.</p>
          ) : (
            <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
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
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
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
            <button type="submit" className="btn-premium">정책 저장</button>
          </form>
          {retentionFormError && (
            <p role="alert" className="text-[color:var(--red-fg)]">
              {retentionFormError}
            </p>
          )}
          {retentionNotice && <p className="text-[color:var(--green-fg)]">{retentionNotice}</p>}
        </div>
      )}

      {section === "notifications" &&
        (notifications === null ? (
          <p>불러오는 중...</p>
        ) : notifications.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">수신된 알림이 없습니다.</p>
        ) : (
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
            <caption className="sr-only">알림 목록 (사용자 수신 기준)</caption>
            <thead>
              <tr>
                <th scope="col">프로젝트</th>
                <th scope="col">트리거</th>
                <th scope="col">심각도</th>
                <th scope="col">채널</th>
                <th scope="col">번들</th>
                <th scope="col">발송일</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n, i) => (
                <tr key={i}>
                  <td>{n.project_id}</td>
                  <td>{n.trigger_type}</td>
                  <td>{n.severity}</td>
                  <td>{n.channel}</td>
                  <td>{n.bundle}</td>
                  <td>{new Date(n.sent_at).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {section === "glossary" &&
        (glossary === null ? (
          <p>불러오는 중...</p>
        ) : glossary.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 용어가 없습니다.</p>
        ) : (
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
            <caption className="sr-only">용어집 용어 목록</caption>
            <thead>
              <tr>
                <th scope="col">키</th>
                <th scope="col">한글</th>
                <th scope="col">영문</th>
                <th scope="col">분류</th>
              </tr>
            </thead>
            <tbody>
              {glossary.map((t) => (
                <tr key={t.key}>
                  <td className="font-mono text-xs">{t.key}</td>
                  <td>{t.ko}</td>
                  <td>{t.en}</td>
                  <td>{t.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {section === "governance" &&
        (governance === null ? (
          <p>불러오는 중...</p>
        ) : governance.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 거버넌스 문서가 없습니다.</p>
        ) : (
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
            <caption className="sr-only">거버넌스 문서 레지스트리</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">계층</th>
                <th scope="col">키</th>
                <th scope="col">제목</th>
                <th scope="col">버전</th>
                <th scope="col">강제성</th>
                <th scope="col">소유자</th>
                <th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              {governance.map((g) => (
                <tr key={g.id}>
                  <td className="font-mono text-xs">{g.id}</td>
                  <td>{g.layer}</td>
                  <td className="font-mono text-xs">{g.key}</td>
                  <td>{g.title}</td>
                  <td>{g.version}</td>
                  <td>{g.enforceability}</td>
                  <td>{g.owner_agent}</td>
                  <td>{g.superseded_by ? `대체됨 (${g.superseded_by})` : "유효"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {section === "master-data" &&
        (masterData === null ? (
          <p>불러오는 중...</p>
        ) : masterData.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">미매핑 큐(staging_unmapped)가 비어 있습니다 — 모든 원시값이 정상 매칭되고 있습니다.</p>
        ) : (
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
            <caption className="sr-only">마스터 데이터 미매핑 큐</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">원시값</th>
                <th scope="col">대상 테이블</th>
                <th scope="col">최초 발견</th>
              </tr>
            </thead>
            <tbody>
              {masterData.map((m) => (
                <tr key={m.id}>
                  <td className="font-mono text-xs">{m.id}</td>
                  <td>{m.raw_value}</td>
                  <td className="font-mono text-xs">{m.attempted_master_table}</td>
                  <td>{new Date(m.first_seen_at).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {section === "adr" &&
        (adrs === null ? (
          <p>불러오는 중...</p>
        ) : adrs.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">ADR 문서가 없습니다 (docs/adr).</p>
        ) : (
          <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
            <caption className="sr-only">ADR 인덱스</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">제목</th>
                <th scope="col">상태</th>
                <th scope="col">파일</th>
              </tr>
            </thead>
            <tbody>
              {adrs.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-xs">{a.id}</td>
                  <td>{a.title}</td>
                  <td>{a.status}</td>
                  <td className="font-mono text-xs">{a.file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </main>
  );
}

// Port of App.tsx's RequireAdmin — the one route that needs a second gate
// beyond AppShell's auth check (see components/AppShell.tsx's header note).
export default function AdminConsolePage() {
  const { me } = useAuth();
  if (me?.role !== "admin") return <p role="alert">관리자 권한이 필요합니다.</p>;
  return <AdminConsole />;
}
