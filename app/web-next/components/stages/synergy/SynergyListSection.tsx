"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import { SectionToolbar } from "../../layout.tsx";
import { ColGroup } from "../../ui.tsx";

// 분석 대상 회사 목록 표 열 비율(2026-10-11-table-column-sizing-system batch 2) —
// 연결 기회·분석 상태(칩 텍스트가 길다)에 폭을 주고 구분·분석일·작업은 좁게.
const SYNERGY_COL_PCT = [16, 22, 10, 28, 10, 14] as const;
import { profileHrefFor } from "./synergyFormat.ts";
import { analysisGroupKey, targetLabel } from "./synergyFormat.ts";
import type { SynergyStageState } from "./useSynergyList.ts";
import type { SynergyAnalysis } from "./types.ts";

export function SynergyListSection({ ctx }: { ctx: SynergyStageState }) {
  const { analyses, canCurate, setShowNewForm, showNewForm, selectedId, openDetail, rerun, removeAnalysis, hasInProgress, opportunityId, dealScoped, scope, setScope, setOppSel, opps } = ctx;
  // A project id (or unknown id) is not an opportunity: no analysis can be linked to it.
  const oppKnown = !!opportunityId && opps.some((o) => o.id === opportunityId);
  const startDisabledReason = !canCurate
    ? "시너지 분석은 analyst 권한이 필요합니다."
    : !opportunityId || (opps.length > 0 && !oppKnown)
      ? "이 딜에 연결된 원천 기회가 없어 딜 기준으로 분석을 시작할 수 없습니다."
      : null;
  const dealEmpty = dealScoped && scope === "deal" && analyses !== null && analyses.length === 0;
  return (
    <section aria-label="분석 대상 회사" className="market-section">
        <SectionToolbar
          title="시너지 분석 목록"
          icon=""
          count={analyses?.length ?? 0}
          actions={
            canCurate ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowNewForm((v) => !v)}
                aria-expanded={showNewForm}
              >
                ＋ 새 분석
              </button>
            ) : null
          }
        />

        {dealScoped && (
          <div role="group" aria-label="분석 범위" className="flex flex-wrap gap-1 mb-2">
            <button type="button" className={scope === "deal" ? "btn-primary btn-sm" : "btn-ghost btn-sm"} aria-pressed={scope === "deal"} onClick={() => setScope("deal")}>이 딜만</button>
            <button type="button" className={scope === "all" ? "btn-primary btn-sm" : "btn-ghost btn-sm"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>전체</button>
          </div>
        )}

        {analyses === null ? (
          <p>불러오는 중...</p>
        ) : dealEmpty ? (
          <div className="text-[length:var(--fs-body)]" role="status">
            <p className="mb-2">이 딜에 연결된 시너지 분석이 없습니다.</p>
            <button
              type="button"
              className="btn-primary"
              disabled={startDisabledReason !== null}
              aria-describedby={startDisabledReason ? "synergy-deal-start-reason" : undefined}
              onClick={() => { if (opportunityId) setOppSel(opportunityId); setShowNewForm(true); setTimeout(() => document.querySelector(".sizing-new-form")?.scrollIntoView({ block: "center" }), 0); }}
            >
              이 딜로 분석 시작
            </button>
            {startDisabledReason && <p id="synergy-deal-start-reason" className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{startDisabledReason}</p>}
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">다른 딜의 분석은 「전체」에서 볼 수 있습니다. 분석 대상은 다음 화면에서 직접 고르며, 자동으로 제출되지 않습니다.</p>
          </div>
        ) : analyses.length === 0 ? (
          <div className="text-[length:var(--fs-body)]">
            <p className="text-[color:var(--muted-fg)] mb-2">
              등록된 시너지 분석이 없습니다. 분석은 <strong>그룹 → 계열사 → 시너지 분석</strong> 순서로 진행합니다 — 먼저 그룹·계열사 프로파일이 필요합니다.
            </p>
            <Link href={profileHrefFor(opportunityId)} className="btn-ghost btn-sm">그룹·계열사 프로파일 등록 →</Link>
            <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">프로파일을 만든 뒤 이 화면으로 돌아와 「＋ 새 분석」을 누르세요.</span>
          </div>
        ) : (
          <div className="table-scroll">
          <table className="data-table list-table synergy-list-table table-fixed-pct tmin-56" aria-label="분석 대상 회사 목록">
            <caption className="sr-only">분석 대상 회사 목록</caption>
            <ColGroup widths={SYNERGY_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">회사명</th>
                <th scope="col">연결 기회</th>
                <th scope="col">구분</th>
                <th scope="col">분석 상태</th>
                <th scope="col" className="col-date">분석일</th>
                <th scope="col"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // 회사별 묶음 — 회사 셀은 그룹 첫 행에만 표시(rowSpan)하고
                // 기회는 행마다 나열된다 (가독성: 회사가 하나의 묶음으로 보임).
                const groups = new Map<string, SynergyAnalysis[]>();
                for (const a of analyses) {
                  const key = analysisGroupKey(a);
                  const list = groups.get(key) ?? [];
                  list.push(a);
                  groups.set(key, list);
                }
                const flat: Array<{ a: SynergyAnalysis; companyCell: SynergyAnalysis | null }> = [];
                for (const list of groups.values()) {
                  list.forEach((a, i) => flat.push({ a, companyCell: i === 0 ? a : null }));
                }
                return flat.map(({ a, companyCell }) => {
                const inProgress = a.status === "in_progress";
                // 보호 모드 재분석 중엔 status가 여전히 'completed'라 inProgress로는
                // 안 잡힌다 — 재분석/삭제를 막으려면 이 플래그도 함께 봐야 한다.
                const busy = inProgress || !!a.rerun_in_progress;
                return (
                  // 행 전체가 상세 진입점이다(2026-09-18 사용자 리뷰 — 연결 기회
                  // 버튼만 진입 가능한 것은 발견성 문제). 회사 셀은 여전히 묶음
                  // 헤더 레이블이고, 행 내 버튼들은 stopPropagation으로 행 클릭과
                  // 분리된다. 키보드 접근: Enter/Space.
                  <tr
                    key={a.id}
                    className={`cursor-pointer ${selectedId === a.id ? "row-selected" : undefined}`}
                    tabIndex={0}
                    aria-label={`${targetLabel(a)} 시너지 분석 리포트 열기`}
                    onClick={() => openDetail(a)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(a); } }}
                  >
                    {companyCell !== null && (() => {
                      const groupLen = groups.get(analysisGroupKey(companyCell))!.length;
                      // 회사 셀은 항상 묶음 헤더(레이블)일 뿐이다 — 상세 진입은
                      // 그룹 크기와 무관하게 행 클릭이 일관되게 담당한다.
                      return (
                        <td className="cell-primary align-top" rowSpan={groupLen}>
                          <span className="font-semibold">{targetLabel(companyCell)}</span>
                        </td>
                      );
                    })()}
                    <td>
                      <button
                        type="button"
                        className={a.opportunity_name ? "text-[length:var(--fs-caption)] text-left underline-offset-2 hover:underline" : "text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left underline-offset-2 hover:underline"}
                        title="시너지 정합성 리포트 열기"
                        onClick={(e) => { e.stopPropagation(); openDetail(a); }}
                      >
                        {a.opportunity_name ?? "— (시장 연계만)"}
                      </button>
                      {scope === "all" && dealScoped && opportunityId && a.opportunity_id === opportunityId && (
                        <span className="control-chip status-green ml-1">이 딜</span>
                      )}
                    </td>
                    <td>{a.target_type ? <span className="control-chip status-not-started">{a.target_type === "group" ? "그룹" : "계열사"}</span> : <span className="control-chip status-amber" title="기존 별도 등록 분석(legacy)">legacy</span>}</td>
                    <td>
                      {inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a.current_step}/5단계)</span>
                      ) : a.status === "completed" && a.rerun_in_progress ? (
                        // ADR-0132 — 재분석 진행 중에도 이전 완료 버전이 그대로 표시된다.
                        <span className="status-chip status-amber" title="이전 완료 버전은 그대로 표시되며, 재분석이 성공해야만 새 버전으로 교체됩니다.">재분석 중 ({a.current_step ?? 0}/5단계, 이전 v{a.latest_version ?? 1} 유지)</span>
                      ) : a.status === "completed" && a.error_message ? (
                        <span className="status-chip status-red" title={`${a.error_message} — 표시 중인 버전은 이전 완료 버전입니다.`}>재분석 실패 (v{a.latest_version ?? 1} 유지)</span>
                      ) : (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      )}
                    </td>
                    <td className="col-date tabular-nums">{(a.completed_at ?? a.created_at).slice(0, 10)}</td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      {!busy && canCurate && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          title={a.target_type ? "같은 분석 행을 재사용해 새 버전으로 재실행합니다" : "기존 별도 등록(legacy) 분석은 재실행할 수 없습니다 — 레지스트리 대상 새 분석을 생성하세요"}
                          onClick={(e) => { e.stopPropagation(); void rerun(a, { stayOnList: true }); }}
                        >
                          재분석
                        </button>
                      )}
                      {!busy && canCurate && (
                        <button type="button" className="btn-danger btn-sm" title="이 시너지 분석을 삭제합니다" onClick={(e) => { e.stopPropagation(); removeAnalysis(a); }}>
                          삭제
                        </button>
                      )}
                    </span></td>
                  </tr>
                );
                });
              })()}
            </tbody>
          </table>
          </div>
        )}
        {hasInProgress && <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="status">분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.</p>}
      </section>
  );
}
