"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { SectionToolbar } from "./layout.tsx";
import { formatDirectionSymbol, formatTargetValue } from "../lib/business-targets-format.ts";
import type { TargetUnit } from "../lib/business-targets-format.ts";

// fs 게이트 근거 패널 (ADR-0114) — 프로젝트에 적용되는 사업목표 기준(마스터데이터)
// 대비 채택 Business Case의 산출값을 표시한다. 표시 전용: 판정은 사람이 기록하는
// gate_decision의 참고 근거이며 이 패널은 게이트를 차단하지 않는다.

interface TargetCheckEntry {
  metric_key: string;
  label: string;
  direction: "gte" | "lte";
  target_value: number;
  unit: TargetUnit;
  custom: boolean;
  source: "affiliate" | "group";
  source_name: string;
  overridden_note: string | null;
  as_of: string;
  actual: number | null;
  actual_basis: string;
  status: "met" | "missed" | "indeterminate" | "manual";
}

interface TargetCheckData {
  resolvable: boolean;
  reason?: string;
  scope: { groupName: string; memberId: string | null; memberName: string | null } | null;
  adopted_case_id: string | null;
  entries: TargetCheckEntry[];
}

const STATUS_CHIP: Record<TargetCheckEntry["status"], { cls: string; label: string }> = {
  met: { cls: "status-green", label: "충족" },
  missed: { cls: "status-red", label: "미달" },
  indeterminate: { cls: "status-amber", label: "판정불가" },
  manual: { cls: "status-not-started", label: "수동 확인" },
};

export function TargetCheckPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<TargetCheckData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api
      .get<TargetCheckData>(`/api/projects/${encodeURIComponent(projectId)}/target-check`)
      .then((r) => setData(r.data))
      .catch(() => setFailed(true));
  }, [projectId]);

  useEffect(load, [load]);

  if (failed) return null; // 근거 표시는 부가 정보 — 실패가 S8 화면을 막지 않는다

  const entries = data?.resolvable ? data.entries : [];
  const affiliateCount = entries.filter((e) => e.source === "affiliate").length;
  const memberName = data?.scope?.memberName ?? null;

  return (
    <section className="market-section" aria-label="사업목표 기준 대비">
      <SectionToolbar
        title="사업목표 기준 대비"
        count={entries.length || undefined}
        summary={
          data?.resolvable && data.scope ? (
            <span className="section-meta">
              적용: {data.scope.groupName} 공통{affiliateCount > 0 ? ` + ${memberName} 개별 ${affiliateCount}건` : ""} · 프로젝트 계열사: {memberName ?? "미지정"}
            </span>
          ) : undefined
        }
        actions={
          <button type="button" className="btn-ghost btn-sm" onClick={load}>
            새로고침
          </button>
        }
      />
      {data === null ? (
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">불러오는 중...</p>
      ) : !data.resolvable ? (
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">
          이 프로젝트에 적용할 사업목표 기준 범위(그룹/계열사)를 특정할 수 없습니다 — 프로젝트 회사 연결이 없고 그룹이 둘 이상입니다.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">
          적용 가능한 사업목표 기준이 없습니다 — 관리자 콘솔 › 마스터 데이터에서 그룹/계열사 기준을 등록하세요.
        </p>
      ) : (
        <>
          <div className="table-scroll">
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
                  const chip = STATUS_CHIP[e.status];
                  return (
                    <tr key={`${e.metric_key}:${e.label}`}>
                      <td>
                        <strong>{e.label}</strong>
                        {e.custom && <span className="section-meta"> · 사용자 지정</span>}
                      </td>
                      <td>
                        {formatDirectionSymbol(e.direction)} {formatTargetValue(e.target_value, e.unit)}{" "}
                        <span className="section-meta">
                          · {e.source === "affiliate" ? `${e.source_name} 개별` : `${e.source_name} 공통`} · {e.as_of.slice(0, 10)}
                        </span>
                        {e.overridden_note && (
                          <span className="section-meta" style={{ display: "block" }}>
                            ({e.overridden_note})
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
                        <span className={`status-chip ${chip.cls}`} title={e.actual_basis}>{chip.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="section-meta">
            이 표는 fs 게이트 판정의 참고 근거이며, 미달이어도 게이트가 자동으로 막히지는 않습니다. 기준은 관리자 콘솔 › 마스터 데이터에서 관리됩니다.
          </p>
        </>
      )}
    </section>
  );
}
