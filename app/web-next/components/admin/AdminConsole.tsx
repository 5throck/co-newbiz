"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
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
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import dynamic from "next/dynamic";
import { useChartTheme } from "../../lib/echarts-theme.ts";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });
import { MasterDataSection } from "../../components/admin/MasterDataSection.tsx";

interface AuditStats {
  total: number;
  daily: Array<{ day: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
  byActor: Array<{ actor: string; count: number }>;
}

interface ReviewAuditRate { key: string; sampled: number; agreed: number; rate: number | null }
interface ReviewAuditSummary {
  overall: ReviewAuditRate;
  by_domain: ReviewAuditRate[];
  by_quarter: ReviewAuditRate[];
  suggested_sample_rate: number;
  note: string | null;
}

type Section = "users" | "audit" | "data-sources" | "schedule" | "database" | "notifications" | "glossary" | "governance" | "master-data" | "adr";

interface AdminNotificationRow {
  id: string;
  user_id: string;
  project_id: string | null;
  trigger_type: string;
  severity: string;
  payload: string;
  channel: string;
  bundle: string;
  sent_at: string;
  read_at: string | null;
}

interface GlossaryTermRow {
  key: string;
  ko: string;
  en: string;
  category: string;
}

// glossary-lint 미정의어 큐 (ADR-0022) — scripts/co-newbiz/glossary-lint.ts의
// report-only 스캐너 결과. 큐는 큐레이터 심사 대상이지 자동 진행이 아니다.
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
const SECTION_TITLE: Record<Section, string> = {
  users: "사용자·토큰 관리",
  audit: "로그 관리",
  "data-sources": "데이터 소스 관리",
  schedule: "배치·스케줄 관리",
  database: "데이터베이스 관리",
  notifications: "알림 관리",
  glossary: "용어집 관리",
  governance: "거버넌스 문서",
  "master-data": "마스터 데이터",
  adr: "ADR 인덱스",
};

export function AdminConsole({ section }: { section: Section }) {
  const { me } = useAuth();
  const ct = useChartTheme();
  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [auditLog, setAuditLog] = useState<Array<{ id: string; actor_user_id: string; action: string; target: string; created_at: string }> | null>(null);
  const [auditFilters, setAuditFilters] = useState<{ actor: string; action: string; days: number }>({ actor: "", action: "", days: 30 });
  const [showAuditTable, setShowAuditTable] = useState(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { panelRef: secretModalPanelRef, onKeyDown: secretModalKeyDown } = useModalFocus(
    () => setIssuedSecret(null),
  );
  const [newUserId, setNewUserId] = useState("");
  const [newUserRole, setNewUserRole] = useState<"analyst" | "viewer" | "admin">("analyst");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticePinned, setNoticePinned] = useState(false);
  const [sources, setSources] = useState<DataSourceRow[] | null>(null);
  const [jobs, setJobs] = useState<ScheduleJobRow[] | null>(null);
  const [retention, setRetention] = useState<RetentionPolicyRow[] | null>(null);
  const [notifications, setNotifications] = useState<AdminNotificationRow[] | null>(null);
  const [glossary, setGlossary] = useState<GlossaryTermRow[] | null>(null);
  const [lintQueue, setLintQueue] = useState<GlossaryLintQueue | null>(null);
  const [adrs, setAdrs] = useState<AdrRow[] | null>(null);
  const [governance, setGovernance] = useState<GovernanceDocRow[] | null>(null);
  const [reviewAudit, setReviewAudit] = useState<ReviewAuditSummary | null | undefined>(undefined);
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
    if (section === "audit" && auditStats === null) {
      api
        .get<AuditStats>("/api/admin/audit-log/stats")
        .then((res) => setAuditStats(res.data))
        .catch((e) => setError(e instanceof Error ? e.message : "감사 통계 조회 실패"));
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
        .get<AdminNotificationRow[]>("/api/admin/notifications")
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
    if (section === "governance" && reviewAudit === null) {
      void api
        .get<ReviewAuditSummary>("/api/admin/review-audit")
        .then((r) => setReviewAudit(r.data))
        .catch(() => setReviewAudit(null));
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

  // ── API 토큰 관리 (사용자별) ──
  const [tokenPanelUser, setTokenPanelUser] = useState<string | null>(null);
  const [userTokens, setUserTokens] = useState<Record<string, Array<{ id: string; label: string; scopes: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>>>({});
  const [tokenLabel, setTokenLabel] = useState("");
  const [tokenWrite, setTokenWrite] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  // 발급된 비밀 정보(토큰·임시 비밀번호) 1회 확인 모달 — 닫으면 영구 소멸
  const [issuedSecret, setIssuedSecret] = useState<{ kind: string; value: string; detail: string } | null>(null);

  function loadUserTokens(userId: string) {
    api.get<Array<{ id: string; label: string; scopes: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>>(`/api/admin/users/${encodeURIComponent(userId)}/tokens`)
      .then((r) => setUserTokens((prev) => ({ ...prev, [userId]: r.data })))
      .catch((e) => setNotice(e instanceof Error ? e.message : "토큰 목록 조회 실패"));
  }

  function toggleTokenPanel(userId: string) {
    const next = tokenPanelUser === userId ? null : userId;
    setTokenPanelUser(next);
    if (next) loadUserTokens(next);
  }

  async function issueUserToken(userId: string) {
    if (!tokenLabel.trim() || tokenBusy) return;
    setTokenBusy(true);
    setError(null);
    try {
      const scopes = tokenWrite ? ["read", "write"] : ["read"];
      const res = await api.post<{ token: string; label: string }>(`/api/admin/users/${encodeURIComponent(userId)}/tokens`, { label: tokenLabel.trim(), scopes });
      setIssuedSecret({ kind: `API 토큰 — ${userId} / ${res.data.label}`, value: res.data.token, detail: "이 토큰은 CO_NEWBIZ_API_TOKEN으로 사용합니다." });
      setTokenLabel("");
      setTokenWrite(false);
      loadUserTokens(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "토큰 발급 실패");
    } finally {
      setTokenBusy(false);
    }
  }

  function revokeUserToken(userId: string, tokenId: string) {
    confirm("API 토큰 폐기", async () => {
      try {
        await api.delete(`/api/admin/users/${encodeURIComponent(userId)}/tokens?tokenId=${encodeURIComponent(tokenId)}`);
        loadUserTokens(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "토큰 폐기 실패");
      }
    }, { body: "폐기된 토큰은 즉시 무효화되며 되돌릴 수 없습니다.", confirmLabel: "폐기" });
  }

  async function setRole(userId: string, role: string) {
    setError(null);
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(userId)}`, { action: "set_role", role });
      setUsers(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "역할 변경 실패");
      setUsers(null);
    }
  }

  function userAction(userId: string, action: "delete" | "reset_password" | "disable" | "enable") {
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
      setIssuedSecret({ kind: `임시 비밀번호 — ${userId}`, value: res.data.temporary_password, detail: "다음 로그인 시 비밀번호 변경이 요구됩니다." });
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
      <h1>{SECTION_TITLE[section]}</h1>
      {issuedSecret && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="발급된 비밀 정보" onKeyDown={secretModalKeyDown}>
          <div ref={secretModalPanelRef} className="modal-panel">
            <div className="modal-head"><h2>✅ {issuedSecret.kind} 발급 완료</h2></div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-2">
              아래 값은 <strong>지금 이 창에서만</strong> 표시됩니다 — 닫으면 다시 볼 수 없습니다. 안전한 곳에 저장하세요.
            </p>
            <div className="flex items-center gap-2">
              <code className="dd-item-id" style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>{issuedSecret.value}</code>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => { void navigator.clipboard.writeText(issuedSecret.value); }}
              >
                복사
              </button>
            </div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">{issuedSecret.detail}</p>
            <div className="flex justify-end mt-3">
              <button type="button" className="btn-ghost" onClick={() => setIssuedSecret(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
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
          <div className="mb-3 flex justify-end">
            <button type="button" className="btn-ghost" aria-expanded={showCreateUser} onClick={() => setShowCreateUser((v) => !v)}>
              ＋ 사용자 등록
            </button>
          </div>
          {showCreateUser && (
          <form onSubmit={createUserAccount} aria-label="사용자 생성" className="sizing-new-form mb-4">
            <div className="flex flex-wrap items-end gap-2">
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
              <button type="submit" className="btn-ghost" disabled={!!noticePinned}>
                등록
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowCreateUser(false)}>취소</button>
            </div>
          </form>
          )}
        </div>
      )}
      {section === "users" &&
        (users === null ? (
          <p>불러오는 중...</p>
        ) : (
          <table className="data-table list-table">
            <caption className="sr-only">사용자 목록</caption>
            <thead>
              <tr>
                <th scope="col">아이디</th>
                <th scope="col" className="w-[6rem]">역할</th>
                <th scope="col" className="w-[8rem]">상태</th>
                <th scope="col" className="col-date">가입일</th>
                <th scope="col" className="w-[13rem]"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.user_id}>
                <tr>
                  <td>{u.user_id}</td>
                  <td>
                    {u.user_id === me?.userId ? (
                      u.role
                    ) : (
                      <select aria-label={`${u.user_id} 역할 변경`} value={u.role} onChange={(e) => void setRole(u.user_id, e.target.value)} className="sizing-new-input sizing-new-input-sm">
                        <option value="admin">admin</option>
                        <option value="analyst">analyst</option>
                        <option value="viewer">viewer</option>
                      </select>
                    )}
                  </td>
                  <td>{u.status === "disabled" ? <span className="status-chip status-not-started">disabled</span> : u.status}</td>
                  <td className="col-date">{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="sizing-actions-cell"><span className="actions-row">
                    {u.status === "pending" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => approve(u.user_id)}>
                        승인
                      </button>
                    )}
                    {u.status !== "pending" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "reset_password")}>
                        비밀번호 초기화
                      </button>
                    )}
                    {u.status === "active" && u.user_id !== me?.userId && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "disable")}>
                        비활성화
                      </button>
                    )}
                    {u.status === "disabled" && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => userAction(u.user_id, "enable")}>
                        활성화
                      </button>
                    )}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => toggleTokenPanel(u.user_id)}>
                      토큰
                    </button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => userAction(u.user_id, "delete")}>
                      삭제
                    </button>
                  </span></td>
                </tr>
                {tokenPanelUser === u.user_id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="sizing-new-form">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <input
                            aria-label="토큰 라벨"
                            placeholder="토큰 라벨 (예: mcp-cli)"
                            value={tokenLabel}
                            onChange={(e) => setTokenLabel(e.target.value)}
                            className="sizing-new-input sizing-new-input-sm"
                          />
                          <label className="text-[length:var(--fs-caption)] flex items-center gap-1">
                            <input type="checkbox" checked={tokenWrite} onChange={(e) => setTokenWrite(e.target.checked)} />
                            write 스코프 포함
                          </label>
                          <button type="button" className="btn-ghost btn-sm" disabled={tokenBusy || !tokenLabel.trim()} onClick={() => issueUserToken(u.user_id)}>
                            토큰 발급
                          </button>
                        </div>
                        {(userTokens[u.user_id] ?? []).length === 0 ? (
                          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-caption)] mb-0">발급된 토큰이 없습니다.</p>
                        ) : (
                          <table className="data-table" aria-label={`${u.user_id} API 토큰`}>
                            <caption className="sr-only">{u.user_id} API 토큰</caption>
                            <thead><tr><th scope="col">라벨</th><th scope="col">스코프</th><th scope="col">생성일</th><th scope="col">마지막 사용</th><th scope="col">상태</th><th scope="col"><span className="sr-only">작업</span></th></tr></thead>
                            <tbody>
                              {(userTokens[u.user_id] ?? []).map((t) => (
                                <tr key={t.id}>
                                  <td>{t.label}</td>
                                  <td>{t.scopes}</td>
                                  <td className="tabular-nums">{t.created_at.slice(0, 10)}</td>
                                  <td className="tabular-nums">{t.last_used_at ? t.last_used_at.slice(0, 10) : "—"}</td>
                                  <td>{t.revoked_at ? <span className="status-chip status-not-started">폐기됨</span> : <span className="status-chip status-green">활성</span>}</td>
                                  <td>{!t.revoked_at && (
                                    <button type="button" className="btn-danger btn-sm" onClick={() => revokeUserToken(u.user_id, t.id)}>폐기</button>
                                  )}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                          발급 시 표시되는 토큰 평문은 다시 볼 수 없습니다 — CO_NEWBIZ_API_TOKEN으로 사용합니다.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        ))}

      {section === "audit" && (
        <div>
          {error && <p role="alert" className="text-[color:var(--red-fg)] mb-2">{error}</p>}
          {!auditStats && !error && <p>불러오는 중...</p>}
          {auditStats && (
            <>
              <div className="summary-cards mb-4">
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.total.toLocaleString()}</span><span className="text-label">전체 감사 기록</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.byAction[0]?.count ?? 0}</span><span className="text-label">최다 액션 ({auditStats.byAction[0]?.action ?? "—"})</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.byActor[0]?.count ?? 0}</span><span className="text-label">최다 행위자 ({auditStats.byActor[0]?.actor ?? "—"})</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.daily.reduce((a, b) => a + b.count, 0)}</span><span className="text-label">최근 30일</span></div>
              </div>
              <div className="charts-row">
                <section className="chart-card glass">
                  <h3 className="text-label mb-2">일별 감사 기록 (30일)</h3>
                  <EChartsCore option={{
                    tooltip: { trigger: "axis" as const },
                    grid: { left: 40, right: 16, top: 16, bottom: 32 },
                    xAxis: { type: "category" as const, data: auditStats.daily.map((d) => d.day.slice(5)), axisLabel: { color: ct.muted, fontSize: 10 } },
                    yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                    series: [{ type: "line" as const, data: auditStats.daily.map((d) => d.count), itemStyle: { color: ct.color[0] }, areaStyle: { opacity: 0.15 }, smooth: true }],
                  }} style={{ height: 240 }} />
                </section>
                <section className="chart-card glass">
                  <h3 className="text-label mb-2">주요 액션 Top 10</h3>
                  <EChartsCore option={{
                    tooltip: { trigger: "axis" as const },
                    grid: { left: 120, right: 16, top: 16, bottom: 24 },
                    xAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                    yAxis: { type: "category" as const, data: [...auditStats.byAction].reverse().map((a) => a.action), axisLabel: { color: ct.muted, fontSize: 10 } },
                    series: [{ type: "bar" as const, data: [...auditStats.byAction].reverse().map((a) => a.count), itemStyle: { color: ct.color[1] }, barMaxWidth: 14 }],
                  }} style={{ height: 240 }} />
                </section>
              </div>
              <SectionToolbar
                title="감사 로그 조회"
                icon="📜"
                count={auditLog?.length}
                filters={
                  <>
                    <input aria-label="행위자 필터" placeholder="행위자(user_id)" value={auditFilters.actor} onChange={(e) => setAuditFilters((f) => ({ ...f, actor: e.target.value }))} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                    <input aria-label="액션 필터" placeholder="액션 접두 (예: synergy)" value={auditFilters.action} onChange={(e) => setAuditFilters((f) => ({ ...f, action: e.target.value }))} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                  </>
                }
                actions={
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const qs = new URLSearchParams({ limit: "200" });
                      if (auditFilters.actor) qs.set("actor", auditFilters.actor);
                      if (auditFilters.action) qs.set("action", auditFilters.action);
                      api.get<{ id: string; actor_user_id: string; action: string; target: string; created_at: string }[]>(`/api/admin/audit-log?${qs}`)
                        .then((r) => { setAuditLog(r.data); setShowAuditTable(true); })
                        .catch((e) => setError(e instanceof Error ? e.message : "로그 조회 실패"));
                    }}
                  >
                    로그 조회
                  </button>
                }
              />
              {showAuditTable && (auditLog === null ? (
                <p>불러오는 중...</p>
              ) : auditLog.length === 0 ? (
                <p className="text-[color:var(--muted-fg)] italic">조건에 맞는 감사 기록이 없습니다.</p>
              ) : (
                <div className="table-scroll">
                <table className="data-table report-table" aria-label="감사 로그">
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
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {section === "data-sources" &&
        (sources === null ? (
          <p>불러오는 중...</p>
        ) : (
          <table className="data-table">
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
          <table className="data-table">
            <caption className="sr-only">스케줄 작업 목록</caption>
            <thead>
              <tr>
                <th scope="col">작업 키</th>
                <th scope="col">스케줄 (cron)</th>
                <th scope="col">상태</th>
                <th scope="col">최근 실행</th>
                <th scope="col"><span className="sr-only">작업</span></th>
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
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--green-bg)] text-[color:var(--green-fg)]">
                        <span aria-hidden="true">●</span> 활성
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]">
                        <span aria-hidden="true">○</span> 비활성
                      </span>
                    )}
                  </td>
                  <td>
                    {j.last_run ? (
                      <>
                        {j.last_run.status}
                        {j.last_run.finished_at && ` · ${new Date(j.last_run.finished_at).toLocaleString("ko-KR")}`}
                        {j.last_run.error && <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{j.last_run.error}</p>}
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
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            이 섹션의 나머지(마이그레이션 상태·백업 이력)는 아직 API가 없습니다.
          </p>
          <h2>보존 정책 (Retention)</h2>
          {retention === null ? (
            <p>불러오는 중...</p>
          ) : retention.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 보존 정책이 없습니다.</p>
          ) : (
            <table className="data-table">
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
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
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
            <button type="submit" className="btn-ghost">정책 저장</button>
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
          <div className="table-scroll">
<table className="data-table report-table">
            <caption className="sr-only">알림 목록 (사용자 수신 기준)</caption>
            <thead>
              <tr>
                <th scope="col">프로젝트</th>
                <th scope="col">트리거</th>
                <th scope="col">심각도</th>
                <th scope="col">채널</th>
                <th scope="col">번들</th>
                <th scope="col">발송일</th>
                <th scope="col">읽음</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id}>
                  <td>{n.project_id ?? "—"}</td>
                  <td>{n.trigger_type}</td>
                  <td>{n.severity}</td>
                  <td>{n.channel}</td>
                  <td>{n.bundle}</td>
                  <td>{new Date(n.sent_at).toLocaleString("ko-KR")}</td>
                  <td>{n.read_at ? <span className="status-chip status-green">읽음</span> : <span className="status-chip status-amber">미읽음</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        ))}

      {section === "glossary" &&
        (glossary === null ? (
          <p>불러오는 중...</p>
        ) : glossary.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 용어가 없습니다.</p>
        ) : (
          <table className="data-table">
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
                {lintQueue.scanned_files}개 파일 스캔 · 등록 용어 {lintQueue.known_count}개 사용 · 미정의 후보 {lintQueue.undefined.length}건 — 큐레이터 심사 대상이며 자동 진행이 아닙니다.
              </p>
              <table className="data-table">
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
          <button type="submit" className="btn-ghost mt-2" disabled={termFormBusy}>
            {termFormBusy ? "등록 중..." : "용어 등록"}
          </button>
        </form>
      )}

      {section === "governance" && reviewAudit !== null && reviewAudit !== undefined && (
        <section aria-label="AI 검토 신뢰도 KPI" className="market-section mb-3">
          <h3 className="text-[0.95rem] font-semibold mb-1">AI 검토 신뢰도 — 검표 동의율 (ADR-0153)</h3>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            사람이 AI 2차 검토 행에 기록한 동의/비동의 검표의 동의율입니다. 권장 표본률 {Math.round(reviewAudit.suggested_sample_rate * 100)}% (강제 아님).
            {reviewAudit.note && <span className="block">{reviewAudit.note}</span>}
          </p>
          <table className="data-table">
            <caption className="sr-only">AI 검토 신뢰도 KPI — 전체, 도메인별, 분기별 동의율</caption>
            <thead>
              <tr>
                <th scope="col">구분</th>
                <th scope="col">키</th>
                <th scope="col">표본</th>
                <th scope="col">동의</th>
                <th scope="col">동의율</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>전체</td>
                <td>overall</td>
                <td className="mono-num">{reviewAudit.overall.sampled}</td>
                <td className="mono-num">{reviewAudit.overall.agreed}</td>
                <td className="mono-num">{reviewAudit.overall.rate === null ? "—" : `${Math.round(reviewAudit.overall.rate * 100)}%`}</td>
              </tr>
              {reviewAudit.by_domain.map((d) => (
                <tr key={`d-${d.key}`}>
                  <td>도메인</td>
                  <td>{d.key}</td>
                  <td className="mono-num">{d.sampled}</td>
                  <td className="mono-num">{d.agreed}</td>
                  <td className="mono-num">{d.rate === null ? "—" : `${Math.round(d.rate * 100)}%`}</td>
                </tr>
              ))}
              {reviewAudit.by_quarter.map((q) => (
                <tr key={`q-${q.key}`}>
                  <td>분기</td>
                  <td>{q.key}</td>
                  <td className="mono-num">{q.sampled}</td>
                  <td className="mono-num">{q.agreed}</td>
                  <td className="mono-num">{q.rate === null ? "—" : `${Math.round(q.rate * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {section === "governance" &&
        (governance === null ? (
          <p>불러오는 중...</p>
        ) : governance.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 거버넌스 문서가 없습니다.</p>
        ) : (
          <div className="table-scroll">
<table className="data-table">
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
</div>
        ))}

      {section === "master-data" && <MasterDataSection />}

      {section === "adr" &&
        (adrs === null ? (
          <p>불러오는 중...</p>
        ) : adrs.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">ADR 문서가 없습니다 (docs/adr).</p>
        ) : (
          <table className="data-table">
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
