"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type AnalysisTaskRow, type ReviewAuditSampleRow, type ReviewStageRow, type RunSummary } from "../lib/api.ts";

// Review status tab — design §10.1-2's 3-stage review (AI 1st -> AI 2nd,
// different domain than the 1st-stage author -> human final) and design
// boundary #2's human-final gate approval. Prior to this component,
// review_stage/analysis_task/review_audit_sample all existed only as
// schema with zero UI consumer (design doc §20.3/§20.4, 2026-08-28 audit).
//
// No "PASS" stamp anywhere here: an analysis_task row shows either a
// reviewer + timestamp, or explicitly "미검토" (not reviewed) — never a
// blanket status. A review_stage row always shows its declared
// unverified-items list, even when empty.

const STAGE_LABEL: Record<string, string> = {
  ai_1st: "AI 1차 (형식)",
  ai_2nd: "AI 2차 (교차 도메인)",
  human_final: "사람 최종",
};

function DeliverableTypeLabel({ type }: { type: string }) {
  const label = type === "ic_memo" ? "IC 메모" : type === "rag_assessment" ? "RAG 평가" : type;
  return <span>{label}</span>;
}

function AnalysisTasksSection({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<AnalysisTaskRow[] | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api
      .get<AnalysisTaskRow[]>(`/api/projects/${projectId}/analysis-tasks`)
      .then((res) => setTasks(res.data))
      .catch((err) => {
        if (err instanceof ApiError && err.code === "role_required") setDenied(err.message);
        setTasks([]);
      });

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function signOff(taskId: string) {
    setBusyId(taskId);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/analysis-tasks/${taskId}/review`, {});
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "검토 확정에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="ma-section" aria-label="사람 최종 승인 (Entity IC 게이트)">
      <h2>사람 최종 승인 — 필수 산출물</h2>
      <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
        Entity IC 게이트는 아래 각 산출물의 <code>reviewed_by</code>가 NULL이 아니어야 통과합니다(설계 경계 #2 — 게이트 승인은 사람의 몫).
        AI가 산출물을 만들 수는 있어도, 이 서명은 시스템이 대신 채울 수 없습니다.
      </p>
      {denied && <p className="form-error">{denied}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {tasks === null ? (
        <p>불러오는 중...</p>
      ) : tasks.length === 0 ? (
        !denied && (
          <p className="text-[color:var(--muted-fg)] italic">
            데이터 없음 — 이 프로젝트가 Entity IC/Group IC 게이트에 도달하면 필수 산출물 목록이 자동 생성됩니다.
          </p>
        )
      ) : (
        <table className="ma-table">
          <caption className="sr-only">사람 최종 승인 필요 산출물</caption>
          <thead>
            <tr>
              <th scope="col">산출물</th>
              <th scope="col">검토 상태</th>
              <th scope="col">검토자</th>
              <th scope="col">검토 일시</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><DeliverableTypeLabel type={t.deliverable_type} /></td>
                <td>
                  {t.reviewed_by ? (
                    <span className="critical-badge" style={{ background: "var(--green-bg)", color: "var(--green-fg)" }}>
                      <span aria-hidden="true">●</span> 검토 완료
                    </span>
                  ) : (
                    <span>
                      <span aria-hidden="true">○</span> 미검토
                    </span>
                  )}
                </td>
                <td>{t.reviewed_by ?? "—"}</td>
                <td>{t.reviewed_at ? new Date(t.reviewed_at).toLocaleString("ko-KR") : "—"}</td>
                <td>
                  {!t.reviewed_by && (
                    <button type="button" className="btn-primary" disabled={busyId === t.id} onClick={() => signOff(t.id)}>
                      {busyId === t.id ? "처리 중..." : "검토 확정(내 이름으로 서명)"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function UnverifiedItemsList({ json }: { json: string }) {
  let items: string[] = [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = [];
  }
  if (items.length === 0) return <span className="text-[color:var(--muted-fg)]">없음(전부 검증됨)</span>;
  return (
    <ul className="m-0 pl-4">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function ReviewStagesSection({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [stages, setStages] = useState<ReviewStageRow[] | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RunSummary[]>(`/api/projects/${projectId}/runs`)
      .then((res) => setRuns(res.data))
      .catch(() => setRuns([]));
  }, [projectId]);

  useEffect(() => {
    if (runs && runs.length > 0 && !selectedRunId) setSelectedRunId(runs[0].id);
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;
    api
      .get<ReviewStageRow[]>(`/api/projects/${projectId}/review-stages?run_id=${encodeURIComponent(selectedRunId)}`)
      .then((res) => setStages(res.data))
      .catch((err) => {
        if (err instanceof ApiError && err.code === "role_required") setDenied(err.message);
        setStages([]);
      });
  }, [projectId, selectedRunId]);

  return (
    <section className="ma-section" aria-label="3단 검토 이력">
      <h2>3단 검토 이력 (AI 1차 → AI 2차 → 사람 최종)</h2>
      {runs && runs.length > 0 && (
        <label className="block mb-2">
          실행(run) 선택
          <select value={selectedRunId ?? ""} onChange={(e) => setSelectedRunId(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || r.id} ({new Date(r.created_at).toLocaleDateString("ko-KR")})
              </option>
            ))}
          </select>
        </label>
      )}
      {denied && <p className="form-error">{denied}</p>}
      {stages === null ? (
        <p>불러오는 중...</p>
      ) : stages.length === 0 ? (
        !denied && <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 이 실행에 기록된 검토 단계가 없습니다.</p>
      ) : (
        <table className="ma-table">
          <caption className="sr-only">3단 검토 이력</caption>
          <thead>
            <tr>
              <th scope="col">단계</th>
              <th scope="col">검토자</th>
              <th scope="col">도메인</th>
              <th scope="col">결과</th>
              <th scope="col">검증불가 항목</th>
              <th scope="col">일시</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id}>
                <td>{STAGE_LABEL[s.stage] ?? s.stage}</td>
                <td>{s.reviewer_agent_or_user}</td>
                <td>{s.reviewer_domain ?? "—"}</td>
                <td>{s.result ?? "—"}</td>
                <td><UnverifiedItemsList json={s.unverified_items_json} /></td>
                <td>{new Date(s.created_at).toLocaleString("ko-KR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReviewReliabilitySection({ projectId }: { projectId: string }) {
  const [samples, setSamples] = useState<ReviewAuditSampleRow[] | null>(null);
  const [stats, setStats] = useState<{ total: number; agreed: number; agreed_pct: number | null }>({ total: 0, agreed: 0, agreed_pct: null });
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ReviewAuditSampleRow[]>(`/api/projects/${projectId}/review-audit-samples`)
      .then((res) => {
        setSamples(res.data);
        setStats({
          total: typeof res.meta.total === "number" ? res.meta.total : 0,
          agreed: typeof res.meta.agreed === "number" ? res.meta.agreed : 0,
          agreed_pct: typeof res.meta.agreed_pct === "number" ? res.meta.agreed_pct : null,
        });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === "role_required") setDenied(err.message);
        setSamples([]);
      });
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="AI 검토 신뢰도">
      <h2>AI 검토 신뢰도 (거버넌스 KPI, 설계 §6.6)</h2>
      <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
        AI 2차 검토 결론을 사람 최종 결론과 대조 표본추출한 일치율입니다. 이 값이 임계 미달이면 사람 검토 비중을 상향해야 합니다(O-18, 임계값 미정).
      </p>
      {denied && <p className="form-error">{denied}</p>}
      {samples === null ? (
        <p>불러오는 중...</p>
      ) : (
        <div className="glass p-4 mt-2" style={{ maxWidth: "320px" }}>
          <div className="text-xs text-[color:var(--muted-fg)]">표본 수 / 일치 수</div>
          <div className="text-2xl font-black">
            {stats.total === 0 ? "표본 없음" : `${stats.agreed} / ${stats.total}`}
          </div>
          {stats.agreed_pct !== null && <div className="text-sm mt-1">일치율: {stats.agreed_pct}%</div>}
        </div>
      )}
    </section>
  );
}

export function ReviewStatusTab({ projectId }: { projectId: string }) {
  return (
    <div className="ma-tab">
      <AnalysisTasksSection projectId={projectId} />
      <ReviewStagesSection projectId={projectId} />
      <ReviewReliabilitySection projectId={projectId} />
    </div>
  );
}
