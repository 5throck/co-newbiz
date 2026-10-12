"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { SectionToolbar } from "./layout.tsx";
import { formatDirectionSymbol, formatTargetValue } from "../lib/business-targets-format.ts";
import type { TargetUnit } from "../lib/business-targets-format.ts";
import { SOURCE_VIEW, attainmentView, goalsLoadErrorText, type GoalSource } from "../lib/business-goals-view.ts";
import Link from "next/link";

// fs 진행 근거 패널 (ADR-0114) — 프로젝트에 적용되는 사업목표 기준(마스터데이터)
// 대비 채택 Business Case의 산출값을 표시한다. 표시 전용: 판정은 사람이 기록하는
// gate_decision의 참고 근거이며 이 패널은 진행을 차단하지 않는다.

interface TargetCheckEntry {
  metric_key: string;
  label: string;
  direction: "gte" | "lte";
  target_value: number;
  unit: TargetUnit;
  custom: boolean;
  source: GoalSource;
  source_name: string;
  shadowed_note?: string | null;
  overridden_note: string | null;
  rationale?: string | null;
  set_by?: string | null;
  as_of: string;
  actual: number | null;
  actual_basis: string;
  status: "met" | "missed" | "indeterminate" | "manual";
}

interface TargetCheckData {
  resolvable: boolean;
  reason?: string;
  scope: { groupName: string; memberId: string | null; memberName: string | null } | null;
  goal_count_by_source?: { project: number; affiliate: number; group: number };
  adopted_case_id: string | null;
  entries: TargetCheckEntry[];
}


export function TargetCheckPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<TargetCheckData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(null);
    api
      .get<TargetCheckData>(`/api/projects/${encodeURIComponent(projectId)}/target-check`)
      .then((r) => setData(r.data))
      .catch((e) => setFailed(goalsLoadErrorText(e, "사업목표 기준 대비 정보를 불러오지 못했습니다 — 네트워크 상태를 확인하거나 새로고침하세요."))); // INTERIM-WORDING
  }, [projectId]);

  useEffect(load, [load]);

  if (failed) return (
    // 근거 표시는 부가 정보 — 실패가 S8 화면을 막지는 않지만, 조용히 사라지면
    // 패널이 없는 이유를 알 수 없으므로 한 줄 안내는 남긴다.
    <div role="alert" className="market-section sizing-step mt-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
      {failed}
    </div>
  );

  // Key off entries (project goals apply even when the standards scope is unresolved).
  const entries = data?.entries ?? [];
  const affiliateCount = entries.filter((e) => e.source === "affiliate").length;
  const projectCount = data?.goal_count_by_source?.project ?? entries.filter((e) => e.source === "project").length;
  const memberName = data?.scope?.memberName ?? null;

  return (
    <section className="market-section" aria-label="사업목표 기준 대비">
      <SectionToolbar
        title="사업목표 기준 대비"
        count={entries.length || undefined}
        summary={
          data?.scope ? (
            <span className="section-meta">
              적용: {projectCount > 0 ? `프로젝트 목표 ${projectCount}건 + ` : ""}{data.scope.groupName} 공통{affiliateCount > 0 ? ` + ${memberName} 개별 ${affiliateCount}건` : ""} · 프로젝트 계열사: {memberName ?? "미지정"}
            </span>
          ) : projectCount > 0 ? (
            <span className="section-meta">적용: 프로젝트 목표 {projectCount}건 (그룹/계열사 기준 범위 없음)</span>
          ) : undefined
        }
        actions={
          <button type="button" className="btn-ghost btn-sm" onClick={load}>
            새로고침
          </button>
        }
      />
      {data === null ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">불러오는 중...</p>
      ) : entries.length === 0 ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
          {/* INTERIM-WORDING */}
          적용 가능한 사업 목표가 없습니다 — <Link href={`/projects/${encodeURIComponent(projectId)}/business-case?tab=goals`} className="text-[color:var(--accent)] font-bold">사업 목표 탭에서 프로젝트 목표를 설정</Link>하세요.
          {!data.resolvable && " 그룹/계열사 기준 범위도 특정할 수 없습니다 — 프로젝트 회사 연결이 없고 그룹이 둘 이상입니다."}
          <span className="section-meta" style={{ display: "block" }}>관리자는 관리자 콘솔 › 마스터 데이터에서 그룹/계열사 기준을 등록할 수 있습니다.</span>
        </p>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table" aria-label="목표 대비 판정">
              <thead>
                <tr>
                  <th scope="col" style={{ minWidth: "11rem" }}>지표</th>
                  <th scope="col" style={{ minWidth: "13rem" }}>기준 (출처 · 기준 시점)</th>
                  <th scope="col" style={{ minWidth: "15rem" }}>사업계획 (산출 근거)</th>
                  <th scope="col" style={{ minWidth: "6rem" }}>판정</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const chip = attainmentView(e.status);
                  const src = SOURCE_VIEW[e.source];
                  return (
                    <tr key={`${e.metric_key}:${e.label}`}>
                      <td>
                        <strong>{e.label}</strong>
                        {e.custom && <span className="section-meta"> · 사용자 지정</span>}
                      </td>
                      <td>
                        {formatDirectionSymbol(e.direction)} {formatTargetValue(e.target_value, e.unit)}{" "}
                        <span className="status-chip status-not-started"><span aria-hidden="true">{src.icon}</span> {src.label}</span>{" "}
                        <span className="section-meta">
                          · {e.source === "affiliate" ? `${e.source_name} 개별` : e.source === "group" ? `${e.source_name} 공통` : e.source_name} · {e.as_of.slice(0, 10)}
                        </span>
                        {(e.shadowed_note ?? e.overridden_note) && (
                          <span className="section-meta" style={{ display: "block" }}>
                            ({e.shadowed_note ?? e.overridden_note})
                          </span>
                        )}
                        {e.source === "project" && e.rationale && (
                          <span className="section-meta" style={{ display: "block" }}>
                            근거: {e.rationale}{e.set_by ? ` · 설정: ${e.set_by}` : ""}
                          </span>
                        )}
                      </td>
                      <td>
                        {e.status === "manual" ? (
                          <>수동 확인 <span className="section-meta">자동 산출 미지원 지표</span></>
                        ) : (
                          <>
                            {e.actual != null ? (
                              <span className="mono-num" style={{ fontWeight: 700 }}>{formatTargetValue(e.actual, e.unit)}</span>
                            ) : (
                              "—"
                            )}{" "}
                            <span className="section-meta">{e.actual_basis}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <span className={`status-chip ${chip.cls}`} title={e.actual_basis}><span aria-hidden="true">{chip.icon}</span> {chip.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="section-meta">
            이 표는 fs 진행 판정의 참고 근거이며, 미달이어도 진행이 자동으로 막히지는 않습니다. 프로젝트 목표는 사업 목표 탭에서, 그룹/계열사 기준은 관리자 콘솔 › 마스터 데이터에서 관리됩니다.
          </p>
        </>
      )}
    </section>
  );
}
