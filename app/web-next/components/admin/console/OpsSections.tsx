"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import type { AdminConsoleState } from "./useAdminActions.ts";

export function DataSourcesPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, sources } = ctx;
  return (
    <>{section === "data-sources" &&
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
        ))}</>
  );
}

export function SchedulePanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, jobs, toggleJob } = ctx;
  return (
    <>{section === "schedule" &&
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
        ))}</>
  );
}

export function DatabasePanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, retention, tableKey, setTableKey, basis, setBasis, months, setMonths, action, setAction, retentionFormError, retentionNotice, saveRetention } = ctx;
  return (
    <>{section === "database" && (
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
      )}</>
  );
}

export function NotificationsPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, notifications } = ctx;
  return (
    <>{section === "notifications" &&
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
        ))}</>
  );
}
