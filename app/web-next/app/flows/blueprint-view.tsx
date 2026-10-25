"use client";

// 플로우 콘솔 — 블루프린트 탭 (화면 설계 2026-10-24 §4, J1 "설계된 플로우 파악").
// 단계 요약 그리드(벤치 B2-1 변형: 색이 아니라 텍스트 카운트가 정보의 주체) +
// 활동 표(행 인라인 확장, 벤치 A1-1 변형) — 전부 생성 프러젝션 렌더, 런타임 LLM 없음.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionToolbar } from "../../components/layout.tsx";
import { ColGroup, FilterChip, PageState, useToast } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import {
  fmtDateTime,
  fmtInt,
  type BlueprintAgent,
  type BlueprintStage,
  type FlowsBlueprint,
  type SpecialistMarker,
  stageDisplayName,
} from "./flows-view-lib.ts";
import { FLOW_GRAPH_I18N, FlowGraph, MARKER_KIND_META } from "./flow-graph.tsx";

// 표 열 비율(2026-10-11-table-column-sizing-system 선례) — 활동 표.
const ACTIVITY_COL_PCT = [21, 7, 16, 34, 12, 10] as const;
// 확장 행 안의 "최근 런 3건" 소형 표.
const RECENT_RUN_COL_PCT = [22, 30, 22, 26] as const;

interface ErrorsByStage {
  byStage: Record<string, number>;
  loaded: boolean;
}

/** 단계 요약 그리드의 "최근 7일 오류" — 런 레저 API 집계(limit=1 경량 호출). */
function useStageErrors(): ErrorsByStage {
  const [state, setState] = useState<ErrorsByStage>({ byStage: {}, loaded: false });
  useEffect(() => {
    let alive = true;
    api
      .get<{ summary: { errorsByStage: Record<string, number> } }>("/api/flows/runs?window=7d&limit=1")
      .then((r) => alive && setState({ byStage: r.data.summary?.errorsByStage ?? {}, loaded: true }))
      .catch(() => alive && setState({ byStage: {}, loaded: true }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** 트랙 라벨 — 단계 applicableTracks 직접 투영(Row 1 API)을 읽는다. 양 트랙이면
 *  공통으로 정규화한다(과거 프롬프트 trackScope 합집합 유도는 서버에서 제거됨 —
 *  design 2026-10-25 §6.1). 라벨은 카탈로그(pages.flows.blueprint.commonTrack). */
function trackScopeLabel(tracks: string[], t: ReturnType<typeof useTranslations>): string {
  const gf = tracks.includes("greenfield");
  const bf = tracks.includes("brownfield");
  if ((gf && bf) || tracks.length === 0) return t("commonTrack");
  return tracks.join(" · ");
}

export function BlueprintView({ blueprint }: { blueprint: FlowsBlueprint }) {
  const t = useTranslations("pages.flows.blueprint");
  const tc = useTranslations("common");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [trackFilter, setTrackFilter] = useState<"all" | "greenfield" | "brownfield">("all");
  const [recentRuns, setRecentRuns] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [creatingPromptKey, setCreatingPromptKey] = useState<string | null>(null);
  const stageErrors = useStageErrors();
  const router = useRouter();
  const { toast } = useToast();

  const stages = blueprint.stages;
  const activities = useMemo(
    () => stages.flatMap((s) => s.activities.map((a) => ({ stageId: s.id, activity: a }))),
    [stages],
  );
  /** 단계 id → applicableTracks(Row 1 직접 투영) — 트랙 필터와 표의 트랙 열이 읽는다. */
  const tracksByStage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of stages) m.set(s.id, s.applicableTracks);
    return m;
  }, [stages]);
  /** 활동 → 전문가 마커(§11.4 활동 표 전용 표기 + 그래프 링). 표시·인지 전용이다. */
  const markersByActivity = useMemo(() => {
    const m = new Map<string, SpecialistMarker>();
    for (const mk of blueprint.specialistMarkers) m.set(`${mk.stageId}:${mk.activityId}`, mk);
    return m;
  }, [blueprint.specialistMarkers]);

  const visibleActivities = useMemo(
    () =>
      activities.filter(({ stageId }) => {
        if (selectedStage && stageId !== selectedStage) return false;
        if (trackFilter !== "all") return (tracksByStage.get(stageId) ?? []).includes(trackFilter);
        return true;
      }),
    [activities, selectedStage, trackFilter, tracksByStage],
  );

  const agentsByKey = useMemo(() => {
    const m = new Map<string, BlueprintAgent>();
    for (const a of blueprint.agents) m.set(a.key, a);
    return m;
  }, [blueprint.agents]);

  /** 프롬프트 키 → 시스템 프롬프트 본문(카탈로그×레지스트리 결합본) — 추가 호출 없이 드릴다운. */
  const systemByKey = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of blueprint.prompts) m.set(p.key, p.system);
    return m;
  }, [blueprint.prompts]);

  /** 활동 확장 시 최근 런 3건 요약(§4.1) — runs API에 activityId 필터가 없어(Row 3 계약)
   *  최근 50런을 받아 화면에서 활동 id로 좁힌다. 실패는 침묵(빈 목록). */
  function loadRecentRuns(stageId: string, activityId: string) {
    const key = `${stageId}:${activityId}`;
    if (recentRuns[key]) return;
    api
      .get<{ processRuns: Array<Record<string, unknown>> }>("/api/flows/runs?window=30d&limit=50")
      .then((r) => {
        setRecentRuns((prev) => ({
          ...prev,
          [key]: (r.data.processRuns ?? [])
            .filter((run) => Array.isArray(run.activities) && (run.activities as Array<{ activity_id?: string }>).some((a) => a.activity_id === activityId))
            .slice(0, 3),
        }));
      })
      .catch(() => setRecentRuns((prev) => ({ ...prev, [key]: [] })));
  }

  const dynamicPromptCount = blueprint.prompts.filter((p) => p.agentKey === null).length;

  /** 드라이런 시작(§2.2 쓰기 게이트 진입점) — 활동의 첫 정적 프롬프트로 세션을
   *  생성(검증 + 비용 추정까지만, 실행은 세션 화면의 비용 확인 후)하고 세션 화면으로
   *  이동한다. 동적 프롬프트(agent=null)는 카탈로그 에이전트가 없어 v1 대상이 아니다
   *  (서버 422 dynamic_prompt — 버튼을 아예 비활성으로 만들어 알려준다). */
  function startDryRun(activity: BlueprintStage["activities"][number]) {
    const promptKey = activity.prompts.find((p) => p.agentKey !== null)?.key;
    if (!promptKey || creatingPromptKey) return;
    setCreatingPromptKey(promptKey);
    api
      .post<{ session: { id: string } }>("/api/flows/dry-run/sessions", { promptKey })
      .then((r) => {
        toast(t("sessionCreatedToast"));
        router.push(`/flows/dry-run/${encodeURIComponent(r.data.session.id)}`);
      })
      .catch((err: unknown) => {
        toast(err instanceof Error ? err.message : t("sessionCreateFailed"), "alert");
      })
      .finally(() => setCreatingPromptKey(null));
  }

  return (
    <>
      {/* 단계 요약 그리드 (§4.1-1) — 버튼 목록(네이티브 button, 키보드 내장). */}
      <section aria-label={t("stageGridSection")} className="market-section">
        <SectionToolbar
          title={t("stageGridTitle")}
          filters={
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("stageGridHint")}
            </span>
          }
        />
        <div className="flex flex-wrap gap-2">
          {stages.length === 0 && <PageState state="empty" emptyText={t("emptyCatalog")} />}
          {stages.map((s) => {
            const selected = selectedStage === s.id;
            const errs = stageErrors.byStage[s.id] ?? 0;
            return (
              <button
                type="button"
                key={s.id}
                aria-pressed={selected}
                onClick={() => setSelectedStage(selected ? null : s.id)}
                className="sizing-grade-card text-left"
                style={{ flex: "1 1 12rem", maxWidth: "16rem", cursor: "pointer", borderWidth: selected ? "2px" : undefined, borderColor: selected ? "var(--accent)" : undefined }}
              >
                <div className="flex items-baseline gap-1">
                  <code className="dd-item-id">{s.id}</code>
                  <span className="font-semibold text-[length:var(--fs-body)]">{stageDisplayName(s)}</span>
                </div>
                <div className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("activityCount", { p1: s.activities.length, p2: trackScopeLabel(s.applicableTracks, t) })}
                </div>
                <div className="mt-1 text-[length:var(--fs-caption)]">
                  {errs > 0 ? (
                    <span className="text-[color:var(--red-fg)] font-semibold">{t("errWeek", { p1: fmtInt(errs) })}</span>
                  ) : (
                    <span className="text-[color:var(--muted-fg)]">{t("errZeroWeek")}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 단계 흐름 그래프 (design 2026-10-25 §6.2/§6.5 — 그리드(개관) → 그래프(흐름) → 표(상세).
          기존 단계 선택 상태 재사용(§6.3) — 그래프 노드 클릭도 활동 표 필터로 귀결된다. */}
      <section aria-label={FLOW_GRAPH_I18N.sectionAria} className="market-section">
        <SectionToolbar
          title={FLOW_GRAPH_I18N.sectionTitle}
          summary={
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {FLOW_GRAPH_I18N.sectionHint}
            </span>
          }
        />
        <FlowGraph
          stages={stages}
          agentsByKey={agentsByKey}
          markers={blueprint.specialistMarkers}
          selectedStage={selectedStage}
          onSelectStage={(stageId) => setSelectedStage((prev) => (prev === stageId ? null : stageId))}
        />
      </section>

      {/* 활동 표 (§4.1-2) — 행 인라인 확장(네이티브 details). */}
      <section aria-label={t("activitySection")} className="market-section">
        <SectionToolbar
          title={t("activityTitle")}
          count={visibleActivities.length}
          filters={
            <span className="flex flex-wrap items-center gap-1" role="group" aria-label={t("trackFilterGroup")}>
              <FilterChip selected={trackFilter === "all"} onClick={() => setTrackFilter("all")}>{t("allTracks")}</FilterChip>
              <FilterChip selected={trackFilter === "greenfield"} onClick={() => setTrackFilter("greenfield")}>greenfield</FilterChip>
              <FilterChip selected={trackFilter === "brownfield"} onClick={() => setTrackFilter("brownfield")}>brownfield</FilterChip>
              {selectedStage && (
                <FilterChip selected={false} onClick={() => setSelectedStage(null)}>
                  {t("clearStage", { p1: selectedStage })}
                </FilterChip>
              )}
            </span>
          }
          summary={
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              spec v{blueprint.specVersion} · catalog v{blueprint.catalogVersion}
            </span>
          }
        />
        {visibleActivities.length === 0 ? (
          <PageState state="empty" emptyText={t("emptyActivities")} />
        ) : (
          <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-40" aria-label={t("activityTableAria")}>
              <caption className="sr-only">{t("activityTableCaption")}</caption>
              <ColGroup widths={ACTIVITY_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{t("colActivity")}</th>
                  <th scope="col">{t("colStage")}</th>
                  <th scope="col">{t("colAgent")}</th>
                  <th scope="col">{t("colPromptKeySkill")}</th>
                  <th scope="col">{t("colTrack")}</th>
                  <th scope="col">{t("colDryRun")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleActivities.map(({ stageId, activity }) => {
                  const hasDynamic = activity.prompts.some((p) => p.agentKey === null);
                  const marker = markersByActivity.get(`${stageId}:${activity.id}`);
                  const agent = agentsByKey.get(activity.agent);
                  const key = `${stageId}:${activity.id}`;
                  const runs = recentRuns[key];
                  return (
                    <tr key={key}>
                      <td>
                        <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadRecentRuns(stageId, activity.id); }}>
                          <summary className="cursor-pointer font-semibold" style={{ listStyle: "revert" }}>
                            <code className="dd-item-id">{activity.id}</code>
                          </summary>
                          <div className="mt-1 text-[length:var(--fs-caption)]">
                            <p className="mb-1">
                              <strong>{t("skillsLabel")}</strong>{" "}
                              {activity.skills.length > 0
                                ? activity.skills.map((sk) => <code key={sk} className="dd-item-id mr-1">{sk}</code>)
                                : "—"}
                            </p>
                            <p className="mb-1">
                              <strong>{t("procedureLabel")}</strong>{" "}
                              {activity.procedure.length > 0
                                ? activity.procedure.map((p) => <code key={p} className="dd-item-id mr-1">{p}</code>)
                                : "—"}
                            </p>
                            {/* 전문가 마커 전용 표기(§11.4) — 표시·인지 전용(DEC-20261025-02). */}
                            {marker && (
                              <p className="mb-1">
                                <strong>{FLOW_GRAPH_I18N.markerChip}</strong>{" "}
                                <span className="status-chip status-in-progress">{MARKER_KIND_META[marker.kind].short}</span>{" "}
                                <span className="text-[color:var(--muted-fg)]">{marker.note}</span>
                              </p>
                            )}
                            <p className="mb-1">
                              <strong>{t("sourcePrompts", { p1: activity.prompts.length })}</strong>
                              {hasDynamic && <span className="status-chip status-not-started ml-1">{t("includesDynamic")}</span>}
                            </p>
                            <ul className="ml-4 list-disc">
                              {activity.prompts.map((p) => (
                                <li key={p.key} className="mb-1">
                                  <code className="dd-item-id">{p.key}</code>
                                  {p.purpose && <span className="ml-1 text-[color:var(--muted-fg)]">{p.purpose}</span>}
                                  {/* 프롬프트 시스템 텍스트 드릴다운 — 이미 응답에 포함된 본문 사용(§4.1-2). */}
                                  <PromptSystemDrillDown system={systemByKey.get(p.key) ?? null} />
                                </li>
                              ))}
                            </ul>
                            {runs === undefined ? (
                              <p className="text-[color:var(--muted-fg)]">{t("recentRunsLoading")}</p>
                            ) : runs.length === 0 ? (
                              <p className="text-[color:var(--muted-fg)]">{t("recentRunsEmpty")}</p>
                            ) : (
                              <>
                                <p className="mt-1"><strong>{t("recentRunsCount", { p1: runs.length })}</strong></p>
                                <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
                                  <table className="data-table table-fixed-pct tmin-40 mb-1" aria-label={t("recentRunsAria", { p1: activity.id })}>
                                    <caption className="sr-only">{t("recentRunsCaption", { p1: activity.id })}</caption>
                                    <ColGroup widths={RECENT_RUN_COL_PCT} />
                                    <thead>
                                      <tr>
                                        <th scope="col">{t("colTime")}</th>
                                        <th scope="col">{t("colRunId")}</th>
                                        <th scope="col">{tc("status")}</th>
                                        <th scope="col" className="col-num">{t("colDuration")}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {runs.map((run) => {
                                        const r = run as { id: string; started_at: string; finished_at: string | null; status: string };
                                        const dur = r.started_at && r.finished_at ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime() : null;
                                        const chip = r.status === "failed"
                                          ? { label: t("chipFailed"), cls: "status-chip status-rejected" }
                                          : { label: t("chipSuccess"), cls: "status-chip status-approved" };
                                        return (
                                          <tr key={r.id}>
                                            <td className="tabular-nums">{fmtDateTime(r.started_at)}</td>
                                            <td><code className="dd-item-id">{r.id.slice(0, 12)}</code></td>
                                            <td><span className={chip.cls}>{chip.label}</span></td>
                                            <td className="col-num tabular-nums">{dur !== null ? fmtInt(dur) + "ms" : "—"}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                          </div>
                        </details>
                      </td>
                      <td><code className="dd-item-id">{stageId}</code></td>
                      <td>
                        {/* 에이전트 드릴다운 — 이름/역할/도메인(§4.1). */}
                        {agent ? (
                          <details>
                            <summary className="cursor-pointer">{activity.agent}</summary>
                            <div className="mt-1 text-[length:var(--fs-caption)]">
                              <p className="mb-0"><strong>{agent.name}</strong></p>
                              <p className="mb-0 text-[color:var(--muted-fg)]">{agent.role || t("roleUnspecified")}</p>
                              <p className="mb-0">{t("domainLabel", { p1: agent.domain ?? "—" })}</p>
                            </div>
                          </details>
                        ) : (
                          activity.agent
                        )}
                        {hasDynamic && <div className="mt-1"><span className="status-chip status-not-started">{t("dynamicChip")}</span></div>}
                      </td>
                      <td className="text-[length:var(--fs-caption)]">
                        {activity.prompts.map((p) => (
                          <div key={p.key}><code className="dd-item-id">{p.key}</code></div>
                        ))}
                        {activity.skills.length > 0 && (
                          <div className="mt-1 text-[color:var(--muted-fg)]">
                            {activity.skills.map((sk) => (
                              <span key={sk} className="status-chip status-not-started mr-1 mb-1" style={{ whiteSpace: "normal" }}>{sk}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td><span className="status-chip status-not-started">{trackScopeLabel(tracksByStage.get(stageId) ?? [], t)}</span></td>
                      <td>
                        {/* 드라이런 시작(Row 6, §6.6) — 첫 정적 프롬프트로 세션 생성 후 세션 화면으로.
                            동적 항목만 있는 활동은 v1 드라이런 대상이 아니므로 이유를 텍스트로 알린다. */}
                        {activity.prompts.some((p) => p.agentKey !== null) ? (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={creatingPromptKey !== null}
                            onClick={() => startDryRun(activity)}
                          >
                            {creatingPromptKey !== null ? t("creating") : t("dryRunStart")}
                          </button>
                        ) : (
                          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={t("dynamicTitle")}>
                            {t("dynamicNoRun")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* §4.1-3 각주 — 동적 항목 귀속 설명. */}
        <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t("footnotePrefix")} <span className="status-chip status-not-started">{t("dynamicChip")}</span> {t("footnoteTail", { p1: fmtInt(dynamicPromptCount) })}
        </p>
      </section>
    </>
  );
}

/** 프롬프트 본문(시스템 프롬프트) 드릴다운 — /api/flows 응답의 prompts 섹션 본문을
 *  부모가 전달한다(블루프린트 전체가 이미 메모리에 있으므로 추가 호출 없음). */
function PromptSystemDrillDown({ system }: { system: string | null }) {
  const t = useTranslations("pages.flows.blueprint");
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("viewSystemBody")}</summary>
      {system === null ? (
        <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("noSystemBody")}</p>
      ) : (
        <pre className="mt-1 text-[length:var(--fs-caption)]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "18rem", overflowY: "auto" }}>{system}</pre>
      )}
    </details>
  );
}
