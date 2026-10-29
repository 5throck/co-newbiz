"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useTranslations } from "next-intl";
import { useAuth } from "../../../lib/auth-client.tsx";
import { useChartTheme } from "../../../lib/echarts-theme.ts";
import { useState, type FormEvent, useEffect } from "react";
import { type AdminUser, type DataSourceRow, type ScheduleJobRow, type RetentionPolicyRow, type DatabaseOverview, type RetentionPreview, api, type AuditLogRow } from "../../../lib/api.ts";
import { useConfirm } from "../../crud.tsx";
import type { AuditStats, AdminNotificationRow, GlossaryTermRow, GlossaryLintQueue, AdrRow, GovernanceDocRow, ReviewAuditSummary, Section } from "./types.ts";

export function useAdminData({ section }: { section: Section }) {
  const t = useTranslations("admin.data");
  const tc = useTranslations("common");

  const { me } = useAuth();
  const ct = useChartTheme();
  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [auditLog, setAuditLog] = useState<Array<{ id: string; actor_user_id: string; action: string; target: string; created_at: string }> | null>(null);
  const [auditFilters, setAuditFilters] = useState<{ actor: string; action: string; days: number }>({ actor: "", action: "", days: 30 });
  const [showAuditTable, setShowAuditTable] = useState(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [newUserId, setNewUserId] = useState("");
  const [newUserRole, setNewUserRole] = useState<"analyst" | "viewer" | "admin">("analyst");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticePinned, setNoticePinned] = useState(false);
  const [sources, setSources] = useState<DataSourceRow[] | null>(null);
  const [jobs, setJobs] = useState<ScheduleJobRow[] | null>(null);
  const [retention, setRetention] = useState<RetentionPolicyRow[] | null>(null);
  const [dbOverview, setDbOverview] = useState<DatabaseOverview | null>(null);
  const [preview, setPreview] = useState<{ state: "idle" | "loading" | "ready" | "error"; count: number | null }>({ state: "idle", count: null });
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
      setTermFormError(t("errRequiredFields"));
      return;
    }
    if (!termForm.why_it_matters_ko.trim()) {
      setTermFormError(t("errWhyRequired"));
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
      setTermFormNotice(t("termCreatedNotice", { p1: res.data.key, p2: res.data.file }));
      setTermForm({ key: "", ko: "", en: "", definition_ko: "", why_it_matters_ko: "", category: "business", owner: "glossary-curator", aliases: "" });
      api
        .get<GlossaryTermRow[]>("/api/glossary")
        .then((r) => setGlossary(r.data))
        .catch(() => undefined);
    } catch (err) {
      setTermFormError(err instanceof Error ? err.message : t("termCreateFailed"));
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
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
    if (section === "audit" && auditStats === null) {
      api
        .get<AuditStats>("/api/admin/audit-log/stats")
        .then((res) => setAuditStats(res.data))
        .catch((e) => setError(e instanceof Error ? e.message : t("auditStatsFailed")));
    }
    if (section === "audit" && auditLog === null) {
      api
        .get<AuditLogRow[]>("/api/admin/audit-log?limit=100")
        .then((res) => setAuditLog(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
    if (section === "data-sources" && sources === null) {
      api
        .get<DataSourceRow[]>("/api/admin/data-sources")
        .then((res) => setSources(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
    if (section === "schedule" && jobs === null) {
      api
        .get<ScheduleJobRow[]>("/api/admin/schedule-jobs")
        .then((res) => setJobs(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
    if (section === "database" && retention === null) {
      api
        .get<RetentionPolicyRow[]>("/api/admin/retention")
        .then((res) => setRetention(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
    if (section === "database" && dbOverview === null) {
      api
        .get<DatabaseOverview>("/api/admin/database/overview")
        .then((res) => setDbOverview(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
    if (section === "notifications" && notifications === null) {
      api
        .get<AdminNotificationRow[]>("/api/admin/notifications")
        .then((res) => setNotifications(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
    if (section === "glossary" && glossary === null) {
      api
        .get<GlossaryTermRow[]>("/api/glossary")
        .then((res) => setGlossary(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
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
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
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
        .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
    }
  }, [section, users, auditLog, sources, jobs, retention, dbOverview, notifications, glossary, lintQueue, adrs, governance]);

  // Impact preview — refreshed as table / date column / months change (count only).
  useEffect(() => {
    const monthsValue = Number(months);
    if (section !== "database" || !tableKey || !basis || months.trim() === "" || !Number.isInteger(monthsValue) || monthsValue < 0) {
      setPreview({ state: "idle", count: null });
      return;
    }
    let cancelled = false;
    setPreview({ state: "loading", count: null });
    const timer = setTimeout(() => {
      api
        .get<RetentionPreview>(`/api/admin/retention/preview?table=${encodeURIComponent(tableKey)}&column=${encodeURIComponent(basis)}&months=${monthsValue}`)
        .then((res) => { if (!cancelled) setPreview({ state: "ready", count: res.data.affected_count }); })
        .catch(() => { if (!cancelled) setPreview({ state: "error", count: null }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [section, tableKey, basis, months]);

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
      setNotice(t("userCreatedNotice", { p1: res.data.user_id, p2: res.data.initial_password }));
      setNewUserId("");
      setUsers(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("createFailed"));
    }
  }
  return { setNotice, setError, confirm, setUsers, setNoticePinned, jobs, setJobs, setRetentionFormError, setRetentionNotice, months, tableKey, basis, action, setTableKey, setBasis, setMonths, setRetention, dbOverview, setDbOverview, preview, confirmDialog, section, error, notice, noticePinned, createUserAccount, newUserId, setNewUserId, newUserRole, setNewUserRole, users, me, approve, auditStats, ct, auditLog, auditFilters, setAuditFilters, setAuditLog, setShowAuditTable, showAuditTable, sources, retention, setAction, retentionFormError, retentionNotice, notifications, glossary, lintQueue, submitGlossaryTerm, termForm, setTermForm, termFormError, termFormNotice, termFormBusy, reviewAudit, governance, adrs };
}
