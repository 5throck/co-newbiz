"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import type { AdminConsoleState } from "./useAdminActions.ts";
import { DevRef } from "../../ui.tsx";

export function ReviewAuditPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, reviewAudit } = ctx;
  return (
    <>{section === "governance" && reviewAudit !== null && reviewAudit !== undefined && (
        <section aria-label="AI 검토 신뢰도 KPI" className="market-section mb-3">
          <h3 className="text-[0.95rem] font-semibold mb-1">AI 검토 신뢰도 — 검표 동의율</h3>
          <DevRef refs="ADR-0153" />
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
      )}</>
  );
}

export function GovernancePanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, governance } = ctx;
  return (
    <>{section === "governance" &&
        (governance === null ? (
          <p>불러오는 중...</p>
        ) : governance.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 거버넌스 문서가 없습니다.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
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
        ))}</>
  );
}

export function AdrPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, adrs } = ctx;
  return (
    <>{section === "adr" &&
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
        ))}</>
  );
}
