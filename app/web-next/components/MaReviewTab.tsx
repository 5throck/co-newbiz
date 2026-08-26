"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  type AntitrustRow,
  type IncentiveRow,
  type LiabilitiesResponse,
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
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">데이터 없음 — 등록된 독과점 검토 결과가 없습니다.</p>
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
        <p className="empty-state">데이터 없음 — 해당 방향의 인센티브가 없습니다.</p>
      ) : (
        <table className="data-table">
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
                    <span className="cell-primary">{r.program_name?.trim() || "—"}</span>
                    {obligations && <p className="cell-sub">의무: {obligations}</p>}
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
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">데이터 없음 — 등록된 인센티브가 없습니다.</p>
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
        <p className="empty-state">데이터 없음 — 등록된 부채 수단이 없습니다.</p>
      ) : (
        <table className="data-table">
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
        <p className="empty-state">데이터 없음 — 등록된 우발채무가 없습니다.</p>
      ) : (
        <table className="data-table">
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
                    <span className="cell-primary">
                      <GlossaryText text={c.description} />
                    </span>
                    {c.distribution?.trim() && <p className="cell-sub">분포: {c.distribution}</p>}
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
        {simulationId && <span className="cell-sub"> — 최신 시뮬레이션({simulationId}) 기준</span>}
      </h3>
      {data.covenant_tests.length === 0 ? (
        <p className="empty-state">데이터 없음 — 기록된 코베넌트 테스트가 없습니다.</p>
      ) : (
        <table className="data-table">
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
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">데이터 없음 — 등록된 부지 후보가 없습니다.</p>
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
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">데이터 없음 — 등록된 파트너 후보가 없습니다.</p>
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
                <p className="cell-sub">
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
      <p className="cell-sub">
        업스트림→다운스트림 산업 연관 지표입니다. 수요 추정용 프록시 체인(`proxy_link`)과는 별개 테이블입니다(ADR-0025).
      </p>
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">데이터 없음 — 등록된 밸류체인 연관이 없습니다.</p>
      ) : (
        <table className="data-table">
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

export function MaReviewTab({ projectId }: { projectId: string }) {
  return (
    <div className="ma-tab">
      <AntitrustSection projectId={projectId} />
      <IncentivesSection projectId={projectId} />
      <LiabilitiesSection projectId={projectId} />
      <SitesSection projectId={projectId} />
      <PartnersSection projectId={projectId} />
      <ValueChainSection projectId={projectId} />
    </div>
  );
}
