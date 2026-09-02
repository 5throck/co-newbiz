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
import { useConfirm } from "../../components/crud.tsx";
import { MasterDataSection } from "../../components/admin/MasterDataSection.tsx";

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

// glossary-lint 미정의어 큐 (ADR-0022) — scripts/co-newbiz/glossary-lint.ts의
// report-only 스캐너 결과. 큐는 큐레이터 심사 대상이지 자동 게이트가 아니다.
interface GlossaryLintFinding {
  token: string;
  file: string;
  line: number;
  count: number;
}

interface GlossaryLintQueue {
  scanned_files: number;
  known_count: number;
  undefined: GlossaryLintFinding[];
}
interface AdrRow {
  id: string;
  title: string;
  status: string;
  file: string;
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

// Admin console — ui-spec §5. All ten sections are served by backend
// endpoints and render real data; master-data is managed by the dedicated
// MasterDataSection component (code tables + staging queue resolution).
export function AdminConsole() {
  const [section, setSection] = useState<Section>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [newUserId, setNewUserId] = useState("");
  const [newUserRole, setNewUserRole] = useState<"analyst" | "viewer" | "admin">("analyst");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticePinned, setNoticePinned] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogRow[] | null>(null);
  const [sources, setSources] = useState<DataSourceRow[] | null>(null);
  const [jobs, setJobs] = useState<ScheduleJobRow[] | null>(null);
  const [retention, setRetention] = useState<RetentionPolicyRow[] | null>(null);
  const [notifications, setNotifications] = useState<AdminNotificationRow[] | null>(null);
  const [glossary, setGlossary] = useState<GlossaryTermRow[] | null>(null);
  const [lintQueue, setLintQueue] = useState<GlossaryLintQueue | null>(null);
  const [adrs, setAdrs] = useState<AdrRow[] | null>(null);
  const [governance, setGovernance] = useState<GovernanceDocRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retentionFormError, setRetentionFormError] = useState<string | null>(null);
  const [retentionNotice, setRetentionNotice] = useState<string | null>(null);
  const [tableKey, setTableKey] = useState("");
  const [basis, setBasis] = useState("");
  const [months, setMonths] = useState("");
  const [action, setAction] = useState<"archive" | "delete">("archive");

  // 용어집 등록 폼 — why_it_matters_ko 필수 (glossary/_schema.yaml).
  const [termForm, setTermForm] = useState({ key: "", ko: "", en: "", definition_ko: "", why_it_matters_ko: "", category: "business", owner: "glossary-curator", aliases: "" });
  const [termFormError, setTermFormError] = useState<string | null>(null);
  const [termFormNotice, setTermFormNotice] = useState<string | null>(null);
  const [termFormBusy, setTermFormBusy] = useState(false);

  async function submitGlossaryTerm(e: FormEvent) {
    e.preventDefault();
    setTermFormError(null);
    setTermFormNotice(null);
    if (!termForm.key.trim() || !termForm.ko.trim() || !termForm.en.trim() || !termForm.definition_ko.trim()) {
      setTermFormError("키, 한글 용어, 영문 용어, 정의는 필수입니다.");
      return;
    }
    if (!termForm.why_it_matters_ko.trim()) {
      setTermFormError("why_it_matters_ko는 필수입니다 — 정의만으로는 '왜 중요한가'가 전달되지 않습니다 (glossary/_schema.yaml).");
      return;
    }
    setTermFormBusy(true);
    try {
      const res = await api.post<{ key: string; file: string }>("/api/glossary", {
        key: termForm.key.trim(),
        ko: termForm.ko.trim(),
        en: termForm.en.trim(),
        definition_ko: termForm.definition_ko.trim(),
        why_it_matters_ko: termForm.why_it_matters_ko.trim(),
        category: termForm.category,
        owner: termForm.owner.trim() || undefined,
        aliases: termForm.aliases.trim() ? termForm.aliases.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
      });
      setTermFormNotice(`용어가 등록되었습니다: ${res.data.key} (${res.data.file})`);
      setTermForm({ key: "", ko: "", en: "", definition_ko: "", why_it_matters_ko: "", category: "business", owner: "glossary-curator", aliases: "" });
      api
        .get<GlossaryTermRow[]>("/api/glossary")
        .then((r) => setGlossary(r.data))
        .catch(() => undefined);
    } catch (err) {
      setTermFormError(err instanceof Error ? err.message : "용어 등록에 실패했습니다.");
    } finally {
      setTermFormBusy(false);
    }
  }


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
    if (section === "glossary" && lintQueue === null) {
      api
        .get<GlossaryLintQueue>("/api/admin/glossary-lint")
        .then((res) => setLintQueue(res.data))
        .catch(() => setLintQueue({ scanned_files: 0, known_count: 0, undefined: [] }));
    }
    if (section === "adr" && adrs === null) {
      api
        .get<{ adrs: AdrRow[] }>("/api/admin/adr")
        .then((res) => setAdrs(res.data.adrs))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
    if (section === "governance" && governance === null) {
      api
        .get<GovernanceDocRow[]>("/api/admin/governance")
        .then((res) => setGovernance(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    }
  }, [section, users, auditLog, sources, jobs, retention, notifications, glossary, lintQueue, adrs, governance]);

  async function approve(userId: string) {
    await api.put(`/api/admin/users/${userId}`, { action: "approve" });
    setUsers(null);
  }

  async function createUserAccount(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      const res = await api.post<{ user_id: string; initial_password: string }>("/api/admin/users", {
        user_id: newUserId,
        display_name: newUserId,
        role: newUserRole,
      });
      setNoticePinned(true);
      setNotice(`사용자 ${res.data.user_id} 생성 — 임시 비밀번호: ${res.data.initial_password} (한 번만 표시됩니다)`);
      setNewUserId("");
      setUsers(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "생성 실패");
    }
  }

  function userAction(userId: string, action: "delete" | "reset_password") {
    if (action === "delete") {
      confirm(
        `${userId} 계정 삭제`,
        async () => {
          setNotice(null);
          try {
            await api.put(`/api/admin/users/${userId}`, { action: "delete" });
            setNotice(`${userId} 삭제됨`);
            setUsers(null);
          } catch (err) {
            setNotice(err instanceof Error ? err.message : "작업 실패");
          }
        },
        { body: "세션·토큰도 함께 삭제되며 감사 로그에 기록됩니다." },
      );
      return;
    }
    void resetPassword(userId);
  }

  async function resetPassword(userId: string) {
    setNotice(null);
    try {
      const res = await api.put<{ temporary_password: string }>(`/api/admin/users/${userId}`, { action: "reset_password" });
      setNoticePinned(true);
      setNotice(`${userId} 비밀번호 초기화 — 임시 비밀번호: ${res.data.temporary_password} (한 번만 표시됩니다)`);
      setUsers(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "작업 실패");
    }
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
      {confirmDialog}
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

      {section === "users" && (
        <div>
          {notice && noticePinned && (
            <p role="status" className="mb-2 p-2 border border-[color:var(--green-border)] bg-[color:var(--green-bg)] rounded-lg text-[color:var(--green-fg)]">
              {notice}
              <button type="button" className="btn-ghost ml-2" onClick={() => { setNoticePinned(false); setNotice(null); }}>
                확인
              </button>
            </p>
          )}
          <form onSubmit={createUserAccount} aria-label="사용자 생성" className="mb-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              aria-label="새 사용자 아이디"
              placeholder="user@example.com"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              required
            />
            <select aria-label="역할" value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as "analyst" | "viewer" | "admin")}>
              <option value="analyst">analyst</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
            <button type="submit" className="btn-premium">
              사용자 생성
            </button>
          </form>
        </div>
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
                  <td className="flex flex-wrap gap-1">
                    {u.status === "pending" && (
                      <button type="button" className="btn-premium" onClick={() => approve(u.user_id)}>
                        승인
                      </button>
                    )}
                    {u.status !== "pending" && (
                      <button type="button" className="btn-ghost" onClick={() => userAction(u.user_id, "reset_password")}>
                        비밀번호 초기화
                      </button>
                    )}
                    <button type="button" className="btn-ghost" onClick={() => userAction(u.user_id, "delete")}>
                      삭제
                    </button>
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

      {section === "glossary" && (
        <div className="glossary-lint-queue mt-6">
          <h3>미정의어 큐 (glossary-lint)</h3>
          {lintQueue === null ? (
            <p>스캔 중...</p>
          ) : lintQueue.undefined.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">
              미정의 약어 없음 — {lintQueue.scanned_files}개 파일 스캔, 등록 용어 {lintQueue.known_count}개 사용 확인.
            </p>
          ) : (
            <>
              <p className="helper-note">
                {lintQueue.scanned_files}개 파일 스캔 · 등록 용어 {lintQueue.known_count}개 사용 · 미정의 후보 {lintQueue.undefined.length}건 — 큐레이터 심사 대상이며 자동 게이트가 아닙니다.
              </p>
              <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
                <caption className="sr-only">미정의어 큐</caption>
                <thead>
                  <tr>
                    <th scope="col">토큰</th>
                    <th scope="col">파일</th>
                    <th scope="col">줄</th>
                    <th scope="col">빈도</th>
                  </tr>
                </thead>
                <tbody>
                  {lintQueue.undefined.map((u, i) => (
                    <tr key={`${u.token}-${u.file}-${u.line}-${i}`}>
                      <td className="font-mono text-xs">{u.token}</td>
                      <td className="font-mono text-xs">{u.file}</td>
                      <td>{u.line}</td>
                      <td>{u.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {section === "glossary" && (
        <form className="glossary-form mt-6" onSubmit={submitGlossaryTerm} aria-label="용어 등록">
          <h3>용어 등록</h3>
          <p className="helper-note">
            why_it_matters_ko는 필수입니다 — 정의만으로는 이 프로젝트에서 &quot;왜 중요한가&quot;가 전달되지 않습니다 (glossary/_schema.yaml).
          </p>
          <div className="form-grid">
            <label>
              키 *
              <input type="text" value={termForm.key} onChange={(e) => setTermForm({ ...termForm, key: e.target.value })} required />
            </label>
            <label>
              한글 용어 *
              <input type="text" value={termForm.ko} onChange={(e) => setTermForm({ ...termForm, ko: e.target.value })} required />
            </label>
            <label>
              영문 용어 *
              <input type="text" value={termForm.en} onChange={(e) => setTermForm({ ...termForm, en: e.target.value })} required />
            </label>
            <label>
              분류 *
              <select value={termForm.category} onChange={(e) => setTermForm({ ...termForm, category: e.target.value })}>
                <option value="business">business</option>
                <option value="financial">financial</option>
                <option value="legal">legal</option>
                <option value="technical">technical</option>
                <option value="industry">industry</option>
                <option value="unit">unit</option>
              </select>
            </label>
            <label>
              소유 에이전트
              <input type="text" value={termForm.owner} onChange={(e) => setTermForm({ ...termForm, owner: e.target.value })} />
            </label>
            <label>
              별칭 (쉼표 구분)
              <input type="text" value={termForm.aliases} onChange={(e) => setTermForm({ ...termForm, aliases: e.target.value })} />
            </label>
          </div>
          <label className="block mt-2">
            정의 (definition_ko) *
            <textarea value={termForm.definition_ko} onChange={(e) => setTermForm({ ...termForm, definition_ko: e.target.value })} rows={2} required />
          </label>
          <label className="block mt-2">
            왜 중요한가 (why_it_matters_ko) *
            <textarea value={termForm.why_it_matters_ko} onChange={(e) => setTermForm({ ...termForm, why_it_matters_ko: e.target.value })} rows={2} required />
          </label>
          {termFormError && <p className="form-error mt-2" role="alert">{termFormError}</p>}
          {termFormNotice && <p className="form-success mt-2">{termFormNotice}</p>}
          <button type="submit" className="btn-primary mt-2" disabled={termFormBusy}>
            {termFormBusy ? "등록 중..." : "용어 등록"}
          </button>
        </form>
      )}

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

      {section === "master-data" && <MasterDataSection />}

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
