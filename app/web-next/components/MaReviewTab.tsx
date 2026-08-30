"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EntityCrudPanel } from "./EntityCrudPanel.tsx";
import {
  api,
  ApiError,
  type AntitrustRow,
  type CompBenchmarkRow,
  type ContractCocRow,
  type IncentiveRow,
  type LiabilitiesResponse,
  type ManagementPackageRow,
  type PartnerRow,
  type ProvenanceMeta,
  type SiteRow,
  type ValueChainLinkRow,
} from "../lib/api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { GlossaryText } from "../lib/glossary-provider.tsx";

// M&A 검토 (M&A Review) tab — ui-spec §2 batch 2. Six sections over the
// Wave 5.7B endpoints (api-spec §6): antitrust, incentives, liabilities,
// sites, partners, value-chain links.
//
// BF-only gating: ui-spec §2 marks this tab BF-only, but GET
// /api/projects/:id returns only id/project_no/created_at (+classification
// meta) — no case-type indicator exists in the payload, so the tab renders
// unconditionally (gap noted in ui-spec §2).
//
// Provenance (FR-SYS-03): every section wraps its numeric figures in
// SourceTooltip. Rows that carry evidence_ref map it to the tooltip's
// anchor_ref slot (the label, 근거 참조, is exactly that column's meaning)
// and value-chain rows add their own assessed_at; everything else gets the
// envelope's as_of, which ok() injects on every response. Figures with no
// provenance at all render bare — nothing is hand-typed.

const REMEDY_META: Record<string, { icon: string; label: string; className: string }> = {
  none: { icon: "○", label: "완화조치 없음", className: "remedy-none" },
  behavioral: { icon: "▲", label: "행태적 시정조치", className: "remedy-behavioral" },
  structural: { icon: "●", label: "구조적 시정조치", className: "remedy-structural" },
  prohibited: { icon: "■", label: "금지", className: "remedy-prohibited" },
};

const COMBINATION_LABEL: Record<string, string> = {
  direct_merger: "직접 결합",
  common_ownership: "공동 소유",
};

const DIRECTION_LABEL: Record<string, string> = {
  prospective: "검토중 인센티브",
  granted: "확정 인센티브",
};

const COMPLIANCE_META: Record<string, { icon: string; label: string; className: string }> = {
  high: { icon: "■", label: "높음", className: "risk-high" },
  medium: { icon: "▲", label: "중간", className: "risk-medium" },
  low: { icon: "●", label: "낮음", className: "risk-low" },
};

const VC_DIRECTION_LABEL: Record<string, string> = {
  upstream: "상류",
  downstream: "하류",
};

function num(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("ko-KR") : "—";
}

function delta(before: number | null, after: number | null): string | null {
  if (typeof before !== "number" || typeof after !== "number") return null;
  const d = after - before;
  return `${d >= 0 ? "+" : ""}${d.toLocaleString("ko-KR")}`;
}

/** Render a numeric figure with the section's envelope provenance (as_of) plus optional row-level fields. */
function Figure({ provenance, value }: { provenance: ProvenanceMeta; value: ReactNode }) {
  return <SourceTooltip provenance={provenance}>{value}</SourceTooltip>;
}

/**
 * Flatten obligation_json into a readable summary. Invalid JSON falls back
 * to the raw text — the row was recorded that way, so it is shown as-is,
 * never silently dropped or replaced with a placeholder.
 */
function obligationSummary(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return String(parsed);
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("; ");
  } catch {
    return raw;
  }
}

// ── 1. 독과점 (Antitrust) ────────────────────────────────────────────────

function AntitrustSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<AntitrustRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});

  useEffect(() => {
    api
      .get<AntitrustRow[]>(`/api/projects/${projectId}/antitrust`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch(() => setRows([]));
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="독과점">
      <h2>독과점 (Antitrust)</h2>
      <EntityCrudPanel
        projectId={projectId}
        endpoint={`/api/projects/${projectId}/antitrust`}
        idKey="id"
        title="antitrust"
        rowLabel="독과점"
        columns={[
          { key: "market_definition", label: "시장 정의", required: true },
          { key: "hhi_before", label: "HHI 이전", type: "number" },
          { key: "hhi_after", label: "HHI 이후", type: "number" },
          { key: "remedy_type", label: "구제 유형" }
        ]}
      />
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 독과점 검토 결과가 없습니다.</p>
      ) : (
        <ul className="antitrust-list">
          {rows.map((r) => {
            const remedy = REMEDY_META[r.remedy_type] ?? { icon: "?", label: r.remedy_type, className: "remedy-none" };
            return (
              <li key={r.id} className="antitrust-card">
                <div className="antitrust-head">
                  <strong>{r.market_definition}</strong>
                  <span className={`remedy-chip ${remedy.className}`}>
                    <span aria-hidden="true">{remedy.icon}</span> {remedy.label}
                  </span>
                </div>
                <dl className="ma-facts">
                  <div>
                    <dt>결합 유형</dt>
                    <dd>{r.combination_type ? (COMBINATION_LABEL[r.combination_type] ?? r.combination_type) : "—"}</dd>
                  </div>
                  <div>
                    <dt>HHI (사전)</dt>
                    <dd>
                      <Figure provenance={asOf} value={num(r.hhi_before)} />
                    </dd>
                  </div>
                  <div>
                    <dt>HHI (사후)</dt>
                    <dd>
                      <Figure provenance={asOf} value={num(r.hhi_after)} />
                    </dd>
                  </div>
                  <div>
                    <dt>HHI 변화</dt>
                    <dd>
                      {delta(r.hhi_before, r.hhi_after) === null ? "—" : <Figure provenance={asOf} value={delta(r.hhi_before, r.hhi_after)} />}
                    </dd>
                  </div>
                  <div>
                    <dt>신고 관할</dt>
                    <dd>{r.filing_jurisdictions?.trim() || "—"}</dd>
                  </div>
                  <div>
                    <dt>이행 확인</dt>
                    <dd>
                      {r.discharge_confirmed_at ? new Date(r.discharge_confirmed_at).toLocaleDateString("ko-KR") : "미확인"}
                    </dd>
                  </div>
                </dl>
                {r.remedy_detail?.trim() && (
                  <p className="antitrust-remedy-detail">
                    <GlossaryText text={r.remedy_detail.trim()} />
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── 2. 인센티브 (Incentives) ─────────────────────────────────────────────

function IncentiveGroup({ rows, direction, asOf }: { rows: IncentiveRow[]; direction: string; asOf: ProvenanceMeta }) {
  return (
    <div className="incentive-group">
      <h3>{DIRECTION_LABEL[direction] ?? direction}</h3>
      {rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 해당 방향의 인센티브가 없습니다.</p>
      ) : (
        <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
          <caption className="sr-only">{DIRECTION_LABEL[direction] ?? direction} 목록</caption>
          <thead>
            <tr>
              <th scope="col">프로그램</th>
              <th scope="col">지급 주체</th>
              <th scope="col">유형</th>
              <th scope="col">금액</th>
              <th scope="col">NPV</th>
              <th scope="col">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const provenance: ProvenanceMeta = { ...asOf, anchor_ref: r.evidence_ref?.trim() || undefined };
              const obligations = obligationSummary(r.obligation_json);
              const clawback = r.clawback_rule?.trim() || typeof r.estimated_clawback === "number";
              return (
                <tr key={r.id} className={clawback ? "row-clawback" : undefined}>
                  <td>
                    <span className="font-semibold">{r.program_name?.trim() || "—"}</span>
                    {obligations && <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">의무: {obligations}</p>}
                    {clawback && (
                      <p className="clawback-note">
                        <span aria-hidden="true">⚠</span> 클로백 노출
                        {r.clawback_rule?.trim() && <> — {r.clawback_rule}</>}
                        {typeof r.estimated_clawback === "number" && (
                          <>
                            {" "}
                            (추정액 <Figure provenance={provenance} value={num(r.estimated_clawback)} />
                            {r.currency_id ? ` ${r.currency_id}` : ""})
                          </>
                        )}
                      </p>
                    )}
                  </td>
                  <td>{r.grantor?.trim() || "—"}</td>
                  <td>{r.type}</td>
                  <td>
                    <Figure provenance={provenance} value={num(r.amount)} />
                    {r.currency_id && ` ${r.currency_id}`}
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(r.npv_value)} />
                  </td>
                  <td>{r.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function IncentivesSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<IncentiveRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});

  useEffect(() => {
    api
      .get<IncentiveRow[]>(`/api/projects/${projectId}/incentives`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch(() => setRows([]));
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="인센티브">
      <h2>인센티브 (Incentives)</h2>
      <EntityCrudPanel
        projectId={projectId}
        endpoint={`/api/projects/${projectId}/incentives`}
        idKey="id"
        title="incentives"
        rowLabel="인센티브"
        columns={[
          { key: "direction", label: "방향", required: true },
          { key: "type", label: "유형", required: true },
          { key: "grantor", label: "부여 기관" },
          { key: "amount", label: "금액", type: "number" }
        ]}
      />
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 인센티브가 없습니다.</p>
      ) : (
        <>
          <IncentiveGroup rows={rows.filter((r) => r.direction === "prospective")} direction="prospective" asOf={asOf} />
          <IncentiveGroup rows={rows.filter((r) => r.direction === "granted")} direction="granted" asOf={asOf} />
        </>
      )}
    </section>
  );
}

// ── 3. 부채·우발채무 (Liabilities) ──────────────────────────────────────

function LiabilitiesSection({ projectId }: { projectId: string }) {
  const [data, setData] = useState<LiabilitiesResponse | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});
  const [simulationId, setSimulationId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<LiabilitiesResponse>(`/api/projects/${projectId}/liabilities`)
      .then((res) => {
        setData(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
        setSimulationId(typeof res.meta.simulation_id === "string" ? res.meta.simulation_id : null);
      })
      .catch(() => setData({ debt_instruments: [], contingent_liabilities: [], covenant_tests: [] }));
  }, [projectId]);

  if (data === null) return (
    <section className="ma-section" aria-label="부채·우발채무">
      <h2>부채·우발채무 (Liabilities)</h2>
      <p>불러오는 중...</p>
    </section>
  );

  return (
    <section className="ma-section" aria-label="부채·우발채무">
      <h2>부채·우발채무 (Liabilities)</h2>

      <h3>부채 수단</h3>
      {data.debt_instruments.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 부채 수단이 없습니다.</p>
      ) : (
        <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
          <caption className="sr-only">부채 수단 목록</caption>
          <thead>
            <tr>
              <th scope="col">대출주</th>
              <th scope="col">원금</th>
              <th scope="col">금리</th>
              <th scope="col">만기</th>
              <th scope="col">순위</th>
            </tr>
          </thead>
          <tbody>
            {data.debt_instruments.map((d) => (
              <tr key={d.id}>
                <td>{d.lender?.trim() || "—"}</td>
                <td>
                  <Figure provenance={asOf} value={num(d.principal)} />
                  {d.currency_id && ` ${d.currency_id}`}
                </td>
                <td>
                  {d.rate_type === "fixed" ? "고정" : "변동"} <Figure provenance={asOf} value={d.rate} />
                </td>
                <td>{d.maturity ?? "—"}</td>
                <td>{d.seniority?.trim() || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>우발채무</h3>
      {data.contingent_liabilities.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 우발채무가 없습니다.</p>
      ) : (
        <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
          <caption className="sr-only">우발채무 목록</caption>
          <thead>
            <tr>
              <th scope="col">구분</th>
              <th scope="col">내용</th>
              <th scope="col">발생확률</th>
              <th scope="col">금액 (하단~기대~상단)</th>
              <th scope="col">예상 시점</th>
              <th scope="col">가치 영향</th>
            </tr>
          </thead>
          <tbody>
            {data.contingent_liabilities.map((c) => {
              const provenance: ProvenanceMeta = { ...asOf, anchor_ref: c.evidence_ref?.trim() || undefined };
              return (
                <tr key={c.id}>
                  <td>{c.category}</td>
                  <td>
                    <span className="font-semibold">
                      <GlossaryText text={c.description} />
                    </span>
                    {c.distribution?.trim() && <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">분포: {c.distribution}</p>}
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(c.probability)} />
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(c.amount_low)} /> ~ <Figure provenance={provenance} value={num(c.amount_expected)} /> ~{" "}
                    <Figure provenance={provenance} value={num(c.amount_high)} />
                  </td>
                  <td>{c.expected_timing_year ?? "—"}</td>
                  <td>
                    {c.value_impact === null ? "—" : <Figure provenance={provenance} value={num(c.value_impact)} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3>
        코베넌트 테스트
        {simulationId && <span className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]"> — 최신 시뮬레이션({simulationId}) 기준</span>}
      </h3>
      {data.covenant_tests.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 기록된 코베넌트 테스트가 없습니다.</p>
      ) : (
        <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
          <caption className="sr-only">코베넌트 테스트 목록</caption>
          <thead>
            <tr>
              <th scope="col">기간</th>
              <th scope="col">코베넌트</th>
              <th scope="col">임계값</th>
              <th scope="col">추정치</th>
              <th scope="col">결과</th>
            </tr>
          </thead>
          <tbody>
            {data.covenant_tests.map((t) => (
              <tr key={`${t.period_id}-${t.covenant_key}`} className={t.breached === 1 ? "row-breached" : undefined}>
                <td>{t.period_id}</td>
                <td>{t.covenant_key}</td>
                <td>
                  <Figure provenance={asOf} value={num(t.threshold)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(t.projected_value)} />
                </td>
                <td>
                  {t.breached === 1 ? (
                    <span className="breached-badge">
                      <span aria-hidden="true">■</span> 이탈
                    </span>
                  ) : (
                    <span className="covenant-held">
                      <span aria-hidden="true">○</span> 유지
                    </span>
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

// ── 4. 부지 비교 (Sites) ────────────────────────────────────────────────

function SitesSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<SiteRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});

  useEffect(() => {
    api
      .get<SiteRow[]>(`/api/projects/${projectId}/sites`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch(() => setRows([]));
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="부지 비교">
      <h2>부지 비교 (Sites)</h2>
      <EntityCrudPanel
        projectId={projectId}
        endpoint={`/api/projects/${projectId}/sites`}
        idKey="id"
        title="sites"
        rowLabel="부지"
        columns={[
          { key: "name", label: "부지명", required: true },
          { key: "region_code", label: "지역" },
          { key: "infra_score", label: "인프라 점수", type: "number" },
          { key: "infra_capex", label: "인프라 CAPEX", type: "number" }
        ]}
      />
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 부지 후보가 없습니다.</p>
      ) : (
        // FR-GF-04: every site's full factor set on one comparable row —
        // no factor split across sub-tables.
        <table className="data-table site-table">
          <caption className="sr-only">부지 후보 비교</caption>
          <thead>
            <tr>
              <th scope="col">순위</th>
              <th scope="col">부지</th>
              <th scope="col">지역</th>
              <th scope="col">인프라 점수</th>
              <th scope="col">인프라 CAPEX</th>
              <th scope="col">인센티브 NPV</th>
              <th scope="col">물류비</th>
              <th scope="col">노동력</th>
              <th scope="col">인허가 소요일</th>
              <th scope="col">총점</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.rank ?? "—"}</td>
                <td>{s.name}</td>
                <td>{s.region_code ?? "—"}</td>
                <td>
                  <Figure provenance={asOf} value={num(s.infra_score)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(s.infra_capex)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(s.incentive_npv)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(s.logistics_cost)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(s.labor_availability)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(s.permit_lead_time_days)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(s.total_score)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── 5. 파트너 (Partners) ────────────────────────────────────────────────

function PartnersSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<PartnerRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});

  useEffect(() => {
    api
      .get<PartnerRow[]>(`/api/projects/${projectId}/partners`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch(() => setRows([]));
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="파트너">
      <h2>파트너 (Partners)</h2>
      <EntityCrudPanel
        projectId={projectId}
        endpoint={`/api/projects/${projectId}/partners`}
        idKey="id"
        title="partners"
        rowLabel="파트너"
        columns={[
          { key: "name", label: "파트너명", required: true },
          { key: "partner_type", label: "유형", required: true },
          { key: "region_code", label: "지역" },
          { key: "capability_score", label: "역량", type: "number" }
        ]}
      />
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 파트너 후보가 없습니다.</p>
      ) : (
        <ul className="partner-list">
          {rows.map((p) => {
            const risk = p.compliance_risk
              ? (COMPLIANCE_META[p.compliance_risk.toLowerCase()] ?? { icon: "?", label: p.compliance_risk, className: "risk-medium" })
              : null;
            const provenance: ProvenanceMeta = { ...asOf, anchor_ref: p.evidence_ref?.trim() || undefined };
            return (
              <li key={p.id} className="partner-card">
                <div className="partner-head">
                  <strong>{p.name}</strong>
                  {risk && (
                    <span className={`risk-chip ${risk.className}`}>
                      <span aria-hidden="true">{risk.icon}</span> 컴플라이언스 리스크: {risk.label}
                    </span>
                  )}
                </div>
                <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
                  {p.partner_type}
                  {p.region_code ? ` · ${p.region_code}` : ""} · {p.status}
                  {p.contacted_at ? ` · 접촉 ${new Date(p.contacted_at).toLocaleDateString("ko-KR")}` : ""}
                </p>
                <dl className="ma-facts">
                  <div>
                    <dt>역량 점수</dt>
                    <dd>
                      <Figure provenance={provenance} value={num(p.capability_score)} />
                    </dd>
                  </div>
                  <div>
                    <dt>생산능력 점수</dt>
                    <dd>
                      <Figure provenance={provenance} value={num(p.capacity_score)} />
                    </dd>
                  </div>
                  <div>
                    <dt>재무 점수</dt>
                    <dd>
                      <Figure provenance={provenance} value={num(p.financial_score)} />
                    </dd>
                  </div>
                  <div>
                    <dt>고객기반 적합도</dt>
                    <dd>
                      <Figure provenance={provenance} value={num(p.customer_base_fit)} />
                    </dd>
                  </div>
                  <div>
                    <dt>의존 리스크</dt>
                    <dd>{p.dependency_risk?.trim() || "—"}</dd>
                  </div>
                  <div>
                    <dt>NDA</dt>
                    <dd>{p.nda_signed === 1 ? "체결" : "미체결"}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── 6. 밸류체인 연관성 (Value-chain linkage) ────────────────────────────

function ValueChainSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ValueChainLinkRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});

  useEffect(() => {
    api
      .get<ValueChainLinkRow[]>(`/api/projects/${projectId}/value-chain-links`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch(() => setRows([]));
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="밸류체인 연관성">
      <h2>밸류체인 연관성 (Value-chain Linkage)</h2>
      <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
        업스트림→다운스트림 산업 연관 지표입니다. 수요 추정용 프록시 체인(`proxy_link`)과는 별개 테이블입니다(ADR-0025).
      </p>
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 밸류체인 연관이 없습니다.</p>
      ) : (
        <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
          <caption className="sr-only">밸류체인 연관 목록</caption>
          <thead>
            <tr>
              <th scope="col">연결</th>
              <th scope="col">방향</th>
              <th scope="col">탄력성</th>
              <th scope="col">시차(개월)</th>
              <th scope="col">상관계수</th>
              <th scope="col">R²</th>
              <th scope="col">전가율</th>
              <th scope="col">전가 시차(개월)</th>
              <th scope="col">집중도 HHI</th>
              <th scope="col">전환비용</th>
              <th scope="col">대체 위협</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const provenance: ProvenanceMeta = {
                ...asOf,
                anchor_ref: v.evidence_ref?.trim() || undefined,
                assessed_at: v.assessed_at || undefined,
              };
              return (
                <tr key={v.id}>
                  <td>
                    {v.from_industry_ko} → {v.to_industry_ko}
                  </td>
                  <td>{VC_DIRECTION_LABEL[v.direction] ?? v.direction}</td>
                  <td>
                    <Figure provenance={provenance} value={num(v.elasticity)} />
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(v.lag_months)} />
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(v.correlation)} />
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(v.r2)} />
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(v.pass_through_rate)} />
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(v.pass_through_lag_months)} />
                  </td>
                  <td>
                    <Figure provenance={provenance} value={num(v.concentration_hhi)} />
                  </td>
                  <td>{v.switching_cost_grade?.trim() || "—"}</td>
                  <td>{v.substitution_threat?.trim() || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── 7. 경영진 보상 (Management package) ─────────────────────────────────
// FR-MA-06/SEC-05: 역할 기반 식별자만 노출 — 실명 컬럼은 스키마에도 없다.

function ManagementPackageSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ManagementPackageRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ManagementPackageRow[]>(`/api/projects/${projectId}/management-package`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === "role_required") setDenied(err.message);
        setRows([]);
      });
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="경영진 보상">
      <h2>경영진 보상 (Management Package)</h2>
      {denied && <p className="form-error">{denied}</p>}
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        !denied && <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 경영진 보상 패키지가 없습니다.</p>
      ) : (
        <table className="ma-table">
          <caption className="sr-only">경영진 보상 패키지 (역할 기반)</caption>
          <thead>
            <tr>
              <th scope="col">역할 참조</th>
              <th scope="col">직책</th>
              <th scope="col">기본 보수</th>
              <th scope="col">CoC 트리거</th>
              <th scope="col">CoC 퇴직금 추정</th>
              <th scope="col">베스팅 가속</th>
              <th scope="col">경업금지 (개월)</th>
              <th scope="col">경업금지 유효</th>
              <th scope="col">이탈 리스크</th>
              <th scope="col">가치 영향</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="font-mono text-xs">{m.executive_ref}</td>
                <td>{m.role?.trim() || "—"}</td>
                <td>
                  <Figure provenance={asOf} value={num(m.base_pay)} />
                </td>
                <td>{m.coc_trigger?.trim() || "—"}</td>
                <td>
                  <Figure provenance={asOf} value={num(m.coc_payout_estimate)} />
                </td>
                <td>{m.accelerated_vesting?.trim() || "—"}</td>
                <td>
                  <Figure provenance={asOf} value={m.non_compete_months ?? "—"} />
                </td>
                <td>{m.non_compete_enforceable?.trim() || "—"}</td>
                <td>{m.flight_risk?.trim() || "—"}</td>
                <td>
                  <Figure provenance={asOf} value={num(m.value_impact)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── 8. 보수 벤치마크 (Comp benchmark, aggregate-only) ────────────────────

function CompBenchmarkSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<CompBenchmarkRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CompBenchmarkRow[]>(`/api/projects/${projectId}/comp-benchmark`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === "role_required") setDenied(err.message);
        setRows([]);
      });
  }, [projectId]);

  return (
    <section className="ma-section" aria-label="보수 벤치마크">
      <h2>보수 벤치마크 (Comp Benchmark)</h2>
      <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
        직군·등급 집계(k≥3)만 제공 — 개인 단위 행은 존재하지 않습니다.
      </p>
      {denied && <p className="form-error">{denied}</p>}
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        !denied && <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 등록된 보수 벤치마크 집계가 없습니다.</p>
      ) : (
        <table className="ma-table">
          <caption className="sr-only">보수 벤치마크 (집계 전용)</caption>
          <thead>
            <tr>
              <th scope="col">직군</th>
              <th scope="col">등급</th>
              <th scope="col">인원</th>
              <th scope="col">대상 중위값</th>
              <th scope="col">인수사 중위값</th>
              <th scope="col">격차(%)</th>
              <th scope="col">연간 비용 증감</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.job_family}</td>
                <td>{c.grade?.trim() || "—"}</td>
                <td>{c.headcount ?? "—"}</td>
                <td>
                  <Figure provenance={asOf} value={num(c.target_median)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(c.acquirer_median)} />
                </td>
                <td>
                  <Figure provenance={asOf} value={c.gap_pct === null ? "—" : `${c.gap_pct}%`} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(c.annual_cost_delta)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── 9. 고객·공급사 CoC 조항 (customer-attrition validator, ma-07/ma-08) ──

function ContractCocSection({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ContractCocRow[] | null>(null);
  const [asOf, setAsOf] = useState<ProvenanceMeta>({});
  const [denied, setDenied] = useState<string | null>(null);
  const [form, setForm] = useState({
    counterparty: "",
    direction: "customer",
    coc_clause_present: true,
    clause_summary: "",
    concentration_pct: "",
    est_churn_pct: "",
    overlap_note: "",
    value_impact: "",
    evidence_ref: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  const refresh = () =>
    api
      .get<ContractCocRow[]>(`/api/projects/${projectId}/contract-coc-clauses`)
      .then((res) => {
        setRows(res.data);
        setAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === "role_required") setDenied(err.message);
        setRows([]);
      });

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function submitClause(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (!form.counterparty.trim()) {
      setFormError("계약 상대방(counterparty)은 필수입니다.");
      return;
    }
    setFormBusy(true);
    try {
      await api.post<{ id: string }>(`/api/projects/${projectId}/contract-coc-clauses`, {
        counterparty: form.counterparty.trim(),
        direction: form.direction,
        coc_clause_present: form.coc_clause_present,
        clause_summary: form.clause_summary || undefined,
        concentration_pct: form.concentration_pct === "" ? undefined : Number(form.concentration_pct),
        est_churn_pct: form.est_churn_pct === "" ? undefined : Number(form.est_churn_pct),
        overlap_note: form.overlap_note || undefined,
        value_impact: form.value_impact === "" ? undefined : Number(form.value_impact),
        evidence_ref: form.evidence_ref || undefined,
      });
      setFormNotice("계약 CoC 조항이 등록되었습니다.");
      setForm({ counterparty: "", direction: "customer", coc_clause_present: true, clause_summary: "", concentration_pct: "", est_churn_pct: "", overlap_note: "", value_impact: "", evidence_ref: "" });
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "등록에 실패했습니다.");
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <section className="ma-section" aria-label="고객·공급사 CoC 조항">
      <h2>고객·공급사 CoC 조항 및 이탈 리스크 (Customer Attrition)</h2>
      <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
        고객·공급사 계약의 지배권변경(CoC) 조항 스캔 결과와 집중도·이탈 추정치입니다 (필수 검증 ma-07/ma-08).
      </p>
      {denied && <p className="form-error">{denied}</p>}
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        !denied && <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 스캔된 계약 CoC 기록이 없습니다.</p>
      ) : (
        <table className="ma-table">
          <caption className="sr-only">계약 CoC 조항 및 이탈 리스크</caption>
          <thead>
            <tr>
              <th scope="col">상대방</th>
              <th scope="col">구분</th>
              <th scope="col">CoC 조항</th>
              <th scope="col">집중도(%)</th>
              <th scope="col">이탈 추정(%)</th>
              <th scope="col">가치 영향</th>
              <th scope="col">경쟁 중복</th>
              <th scope="col">조항 요약</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.counterparty}</td>
                <td>{c.direction === "customer" ? "고객" : "공급사"}</td>
                <td>
                  {c.coc_clause_present === 1 ? (
                    <span className="critical-badge">
                      <span aria-hidden="true">●</span> 조항 있음
                    </span>
                  ) : (
                    <span>
                      <span aria-hidden="true">○</span> 없음
                    </span>
                  )}
                </td>
                <td>
                  <Figure provenance={asOf} value={c.concentration_pct === null ? "—" : `${c.concentration_pct}%`} />
                </td>
                <td>
                  <Figure provenance={asOf} value={c.est_churn_pct === null ? "—" : `${c.est_churn_pct}%`} />
                </td>
                <td>
                  <Figure provenance={asOf} value={num(c.value_impact)} />
                </td>
                <td>{c.overlap_note?.trim() || "—"}</td>
                <td>{c.clause_summary?.trim() || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="contract-coc-form mt-4" onSubmit={submitClause} aria-label="계약 CoC 조항 등록">
        <h3>계약 CoC 조항 등록</h3>
        <div className="form-grid">
          <label>
            상대방 *
            <input type="text" value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} required />
          </label>
          <label>
            구분 *
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="customer">고객</option>
              <option value="supplier">공급사</option>
            </select>
          </label>
          <label>
            CoC 조항 *
            <select
              value={form.coc_clause_present ? "1" : "0"}
              onChange={(e) => setForm({ ...form, coc_clause_present: e.target.value === "1" })}
            >
              <option value="1">조항 있음</option>
              <option value="0">없음</option>
            </select>
          </label>
          <label>
            집중도(%)
            <input type="number" step="any" min="0" max="100" value={form.concentration_pct} onChange={(e) => setForm({ ...form, concentration_pct: e.target.value })} />
          </label>
          <label>
            이탈 추정(%)
            <input type="number" step="any" min="0" max="100" value={form.est_churn_pct} onChange={(e) => setForm({ ...form, est_churn_pct: e.target.value })} />
          </label>
          <label>
            가치 영향
            <input type="number" step="any" value={form.value_impact} onChange={(e) => setForm({ ...form, value_impact: e.target.value })} />
          </label>
          <label>
            근거 참조
            <input type="text" value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} />
          </label>
        </div>
        <label className="block mt-2">
          조항 요약
          <textarea value={form.clause_summary} onChange={(e) => setForm({ ...form, clause_summary: e.target.value })} rows={2} />
        </label>
        <label className="block mt-2">
          경쟁 중복 관찰
          <input type="text" value={form.overlap_note} onChange={(e) => setForm({ ...form, overlap_note: e.target.value })} />
        </label>
        {formError && <p className="form-error mt-2" role="alert">{formError}</p>}
        {formNotice && <p className="form-success mt-2">{formNotice}</p>}
        <button type="submit" className="btn-primary mt-2" disabled={formBusy}>
          {formBusy ? "등록 중..." : "CoC 기록 등록"}
        </button>
      </form>
    </section>
  );
}

export function MaReviewTab({ projectId }: { projectId: string }) {
  return (
    <div className="ma-tab">
      <AntitrustSection projectId={projectId} />
      <IncentivesSection projectId={projectId} />
      <LiabilitiesSection projectId={projectId} />
      <SitesSection projectId={projectId} />
      <PartnersSection projectId={projectId} />
      <ValueChainSection projectId={projectId} />
      <ManagementPackageSection projectId={projectId} />
      <CompBenchmarkSection projectId={projectId} />
      <ContractCocSection projectId={projectId} />
    </div>
  );
}
