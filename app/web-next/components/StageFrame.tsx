"use client";

// P0 공통 골격 — 표준 화면 패턴 (ADR-0086, docs/designs/2026-09-01-standard-screen-patterns-design_ko.md).
// 단계 화면의 유일한 외피: 단계 헤더 + S1~S12 진행 레일(StageRail) + 본문 슬롯.
// 데이터원은 lib/stage-meta.ts (flow.spec 발췌, 정합 테스트로 강제) — 페이지별 하드코딩 금지.
//
// ADR-0116 Phase 7: 프로젝트 단계(S8~S12) 화면에서는 현재 단계의 차단 요건과
// 필요 산출물을 프레임이 직접 안내한다(process API 재사용 — 페이지별 중복
// 구현 없이 전 하위 탭에 자동 적용). 데이터가 없거나 조회에 실패하면 조용히
// 숨는다 — 가이던스는 부가 정보이지 본문을 가리는 것이 아니다.

import { localizeBlocker } from "../lib/labels.ts";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { STAGE_META, stageLabelOf, type StageMetaId, type TrackId } from "../lib/stage-meta.ts";
import { GATE_LABEL_KEY } from "../lib/label-keys.ts";
import { STAGE_HANDOFF } from "../lib/stage-handoff.ts";
import { useDealContext } from "../lib/use-deal-context.ts";
import { api } from "../lib/api.ts";
import { ReconfirmNotice } from "./ReconfirmNotice.tsx";

/** 단계 → 담당 화면 라우트. 캐리어(deal = 기회 id)가 있으면 /deals/{id}/sN 탭으로,
    없으면 플랫 라우트(캐리어 리다이렉트 스텁 — 2026-10-02 route-cleanup design
    §4.2/§4.3)로 보낸다. 프로젝트 단계(S8~S12)는 **프로젝트 id**가 필요하다 —
    /deals/{id} 의 id는 기회 id이므로 승격된 기회의 project_id로 풀어 쓴다
    (R2-A, 워크스루 F4: 기회 id로 만든 링크는 "Not found."가 되었다). */
const STAGE_HREF: Record<StageMetaId, (dealId?: string, projectId?: string) => string | null> = {
  S1: (d) => (d ? `/deals/${d}/s1` : "/market"),
  S2: (d) => (d ? `/deals/${d}/s2` : "/opportunities"),
  S3: (d) => (d ? `/deals/${d}/s3` : "/synergy"),
  S4: (d) => (d ? `/deals/${d}/s4` : "/route-decision"),
  S5: (d) => (d ? `/deals/${d}/s5` : "/greenfield"),
  S6: (d) => (d ? `/deals/${d}/s6` : "/brownfield"),
  S7: (d) => (d ? `/deals/${d}/s7` : "/brownfield"),
  S8: (_d, p) => (p ? `/projects/${p}/business-case` : null),
  S9: (_d, p) => (p ? `/projects/${p}/dd` : null),
  S10: (_d, p) => (p ? `/projects/${p}/deal-structure` : null),
  S11: (_d, p) => (p ? `/projects/${p}/ic-review` : null),
  S12: (_d, p) => (p ? `/projects/${p}/portfolio` : null),
};

/** 미승격 사유 — 트랙 최종 단계(greenfield S5 / brownfield S7)를 이름으로 지적한다.
    트랙 미확정이면 트랙 중립 문구로 폴백한다 (T-20261022-041: "S7 선정"은
    brownfield 전용 사건이라 greenfield 딜의 레일에서는 오안내였다). */
export function notPromotedReason(track?: TrackId | null): string {
  if (track === "greenfield") return "아직 프로젝트로 승격되지 않았습니다 — S5 진출전략 확정 후 승격하면 열립니다.";
  if (track === "brownfield") return "아직 프로젝트로 승격되지 않았습니다 — S7 대상 선정 후 승격하면 열립니다.";
  return "아직 프로젝트로 승격되지 않았습니다 — 승격(S5→S8 또는 S7→S8) 후에 열립니다.";
}

export interface StageLink {
  href: string | null;
  /** Set when the stage cannot be opened for a reason other than track applicability. */
  reason: string | null;
}

/** Resolves every stage link for the current route: S1~S7 use the deal id,
    S8~S12 the promoted project id (looked up from the opportunity) and are
    disabled with a reason while the deal is not promoted. */
function useStageLinks(track?: TrackId | null): (id: StageMetaId) => StageLink {
  const params = useParams<{ id?: string }>();
  const routeId = params?.id;
  const underProjects = (usePathname() ?? "").startsWith("/projects/");
  const deal = useDealContext(routeId, !underProjects);
  // Under /projects, S1~S7 belong to the source opportunity's deal tabs — without
  // the source id these links would hit the carrier-less flat stubs, whose
  // CarrierGate auto-picks whichever deal is newest (T-20261022-019).
  const sourceOppId = useSourceOpportunity(underProjects ? routeId : undefined);
  return (id) => {
    const projectStage = PROJECT_STAGE_IDS.has(id);
    if (!projectStage) return { href: STAGE_HREF[id](underProjects ? sourceOppId ?? undefined : routeId), reason: null };
    if (underProjects) return { href: STAGE_HREF[id](undefined, routeId), reason: null };
    if (!routeId) return { href: null, reason: "프로젝트(검토/안건) 화면에서만 열립니다." };
    if (deal.state === "loading") return { href: null, reason: "프로젝트 승격 여부를 확인하는 중입니다." };
    if (!deal.ctx) return { href: null, reason: "이 안건의 정보를 확인할 수 없어 열 수 없습니다." };
    const pid = deal.ctx.projectId;
    return pid ? { href: STAGE_HREF[id](routeId, pid), reason: null } : { href: null, reason: notPromotedReason(track) };
  };
}

// Source opportunity of a project (S1~S7 live on the source opportunity's deal
// tabs, not on /projects/{id}). Cached per project and shared with StageTabs
// (hoisted from there, T-20261022-019) so both consumers resolve once; null also
// covers "cannot be resolved", which leaves the caller without the link.
const sourceOppCache = new Map<string, string | null>();
const carrierTrackCache = new Map<string, TrackId | null>();

/** 품평회 2026-10-22 잔여 #3 — 승격 직후 스테일 캐시 무효화. PromotionPanel이
 *  승격 성공 직후 호출한다: 직전까지 "미승격/미적용"이던 레일·소스 링크가
 *  하드 리로드 없이 곧바로 갱신되게 한다. */
export function invalidateCarrierCaches(opportunityId?: string, projectId?: string): void {
  for (const [k] of sourceOppCache) if (projectId && k === projectId) sourceOppCache.delete(k);
  for (const [k] of carrierTrackCache) {
    const id = k.slice(2);
    if ((opportunityId && id === opportunityId) || (projectId && id === projectId)) carrierTrackCache.delete(k);
  }
}

export function useSourceOpportunity(projectId: string | undefined): string | null {
  const [oppId, setOppId] = useState<string | null>(projectId ? sourceOppCache.get(projectId) ?? null : null);
  useEffect(() => {
    if (!projectId) return;
    if (sourceOppCache.has(projectId)) { setOppId(sourceOppCache.get(projectId) ?? null); return; }
    let live = true;
    api.get<{ opportunity: { id: string } | null }>(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => { const id = r.data.opportunity?.id ?? null; sourceOppCache.set(projectId, id); if (live) setOppId(id); })
      .catch(() => { /* no link when the source cannot be resolved */ });
    return () => { live = false; };
  }, [projectId]);
  return oppId;
}

// Track of the current carrier (opportunity or project), cached per id. Lets the stage rail show
// "미적용" for the other track's stages on every screen, not only on the track-fixed ones.
// (The cache map itself is declared next to sourceOppCache, above — invalidateCarrierCaches clears both.)

function useCarrierTrack(enabled: boolean): TrackId | null {
  const params = useParams<{ id?: string }>();
  const routeId = params?.id;
  const underProjects = (usePathname() ?? "").startsWith("/projects/");
  const key = routeId ? `${underProjects ? "p" : "o"}:${routeId}` : null;
  const [track, setTrack] = useState<TrackId | null>(key ? carrierTrackCache.get(key) ?? null : null);
  useEffect(() => {
    if (!enabled || !key || !routeId) return;
    if (carrierTrackCache.has(key)) { setTrack(carrierTrackCache.get(key) ?? null); return; }
    let live = true;
    const base = underProjects ? "projects" : "opportunities";
    api.get<{ track: string | null }>(`/api/${base}/${encodeURIComponent(routeId)}/process`)
      .then((r) => {
        const t = r.data.track === "greenfield" || r.data.track === "brownfield" ? r.data.track : null;
        carrierTrackCache.set(key, t);
        if (live) setTrack(t);
      })
      .catch(() => { /* unknown track: keep every stage applicable */ });
    return () => { live = false; };
  }, [enabled, key, routeId, underProjects]);
  return track;
}

/** 가이던스 스트립이 붙는 프로젝트 전용 단계 — 기회 단계(S1~S7)는 별도 화면이 담당한다. */
const PROJECT_STAGE_IDS = new Set(["S8", "S9", "S10", "S11", "S12"]);

export function StageFrame({
  stageId,
  track,
  subtitle,
  railSlot,
  children,
}: {
  /** 이 화면이 담당하는 단계 — 복합 단계는 배열(S6·S7처럼 한 화면이 두 단계) */
  stageId: StageMetaId | StageMetaId[];
  /** 화면이 고정 트랙에서 동작할 때 지정 — 트랙 미해당 단계를 레일에서 비활성 */
  track?: TrackId;
  /** 화면 고유 제목 — h1 바로 아래 부제로 렌더한다. h1은 항상 정본 단계명(`S10 투자구조 설계`)이며
      레일·문서 제목과 같은 출처다(2026-10-29 사용자 리포트: h1이 단계명을 대체해 혼란). 부제에는
      "S10 " 같은 단계 접두를 쓰지 않는다. */
  subtitle?: string;
  /** 프로젝트 화면(/projects/**) 전용 — StageTabs(스테퍼·단계 탭 행)를 레일 자리에 렌더한다.
      이렇게 하지 않으면 h1·스트립이 탭 행 아래로 밀려 deal 화면(S1~S7: h1 → 레일 → 스트립)과
      머리 위치가 어긋난다(2026-10-22 사용자 리포트 — S8~S12 전 단계 일관성). */
  railSlot?: ReactNode;
  children?: ReactNode;
}) {
  const ids = Array.isArray(stageId) ? stageId : [stageId];
  const primary = ids[0];
  const stage = STAGE_META.find((s) => s.id === primary)!;
  const params = useParams<{ id?: string }>();
  const carrierTrack = useCarrierTrack(track === undefined);
  const linkFor = useStageLinks(track ?? carrierTrack ?? undefined);
  // 복합 단계(S6·S7 한 화면)에서 현재 경로가 어느 단계인지 — 다음 단계 버튼의 기준점.
  const pathStageId = (() => {
    const m = (usePathname() ?? "").match(/\/s(\d{1,2})$/);
    const id = m ? (`S${m[1]}` as StageMetaId) : null;
    return id && ids.includes(id) ? id : null;
  })();
  const navSource = pathStageId ?? primary;
  // Under /projects/[id]/** StageTabs owns the stepper (one stepper per screen).
  const stepperOwnedByTabs = (usePathname() ?? "").startsWith("/projects/");
  const projectId = stepperOwnedByTabs ? params?.id : undefined;
  const tr = useTranslations();
  const trackNow = track ?? carrierTrack ?? undefined;
  // The forward CTA on project stages (S8~S12) is gated by the engine's stage predicate; one
  // process-API read feeds the CTA, the handoff output and the "what is left" list.
  const gatedProjectStage = !!projectId && PROJECT_STAGE_IDS.has(navSource);
  const guidance = useStageGuidance(gatedProjectStage ? projectId : undefined, navSource);
  const gateOpen = !gatedProjectStage || stageCompleteOf(guidance);
  return (
    <>
      <div className="stage-head">
        <h1>{stageLabelOf(ids, pathStageId)}</h1>
        {/* 모든 단계 화면의 머리 우상단 = 다음 단계 내비게이션으로 통일(2026-10-22
            사용자 리포트: 단계별로 생성·제안·기록·종료 등 제각각이어서 혼란). 트랙 인지
            스킵(nextApplicableStage)으로 다음 적용 단계를 계산하며, 단계의 기록·생성
            액션은 각 작업 면(인라인)에 남긴다. 다음 단계가 없으면(종료) 숨긴다.
            복합 단계(S6·S7)에서는 현재 경로의 단계 기준으로 계산한다. */}
        {(() => {
          // 트랙 미확정(로딩 중)에는 다음 단계를 추측하지 않는다 — 트랙 전용 단계로
          // 잘못 안내되는 과도 상태를 막는다(fail-honest).
          if (!trackNow) return null;
          // Stage does not apply to this deal's track: the not-applicable notice hosts the single
          // primary action (go to the stage that applies), so the header shows none.
          if (!stage.applicableTracks.includes(trackNow)) return null;
          const nextId = nextApplicableStage(navSource, trackNow);
          if (!nextId) return null;
          const nextName = STAGE_META.find((s) => s.id === nextId)!.name;
          const label = tr("common.stageNav.next", { name: nextName });
          // S8~S12: enabled only when the engine says this stage is complete; otherwise disabled
          // and described by the "what is left" list below.
          if (gatedProjectStage && !gateOpen) {
            return (
              <button type="button" className="btn-primary" disabled aria-disabled="true" aria-describedby={guidance.phase === "ready" ? NEXT_MISSING_ID : undefined} title={guidance.phase === "ready" ? tr("common.stageNav.blockedHint") : tr("common.stageNav.checking")}>
                {label}
              </button>
            );
          }
          const link = linkFor(nextId);
          if (link?.href) {
            return <Link className="btn-primary" href={link.href}>{label}</Link>;
          }
          // The next stage is a project stage and the deal is not promoted yet: the real next
          // action is promotion (hosted on this track-final stage), never a link back to itself.
          if (PROJECT_STAGE_IDS.has(nextId) && !stepperOwnedByTabs && link?.reason === notPromotedReason(trackNow)) {
            return <a className="btn-primary" href="#project-promotion">{tr("common.stageNav.promote")}</a>;
          }
          return null;
        })()}
      </div>
      {subtitle && (
        <p className="mt-[0.15rem] mb-1 font-semibold text-[length:var(--fs-h2)] leading-snug" data-testid="stage-subtitle">{subtitle}</p>
      )}
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{stage.objective}</p>
      {/* 스트립은 목적선 바로 다음 — S1~S12 모든 화면에서 같은 머리 순서(h1 → 목적 → 스트립 →
          레일/탭)를 유지한다(2026-10-22 사용자 리포트: S2와 S11의 스트립 위치 불일치). */}
      <StageHandoffStrip primary={navSource} track={trackNow} linkFor={linkFor} outputOpen={gateOpen} />
      {railSlot !== undefined
        ? railSlot
        : !stepperOwnedByTabs && <StageRail current={ids} track={track} />}
      {gatedProjectStage && <StageGuidance state={guidance} projectId={projectId} stageId={navSource} />}
      {projectId && <ReconfirmNotice projectId={projectId} />}
      {/* 단계 설명 슬롯 — 서식은 프레임이 표준화한다(0.9rem·muted·leading-relaxed,
          하단 간격 mb-4). 페이지별 클래스·<strong> 강조 금지(설계서 개정 2026-09-04). */}
      {children && (
        <div className="mb-4 text-[length:var(--fs-body)] text-[color:var(--muted-fg)] leading-relaxed">
          {children}
        </div>
      )}
    </>
  );
}

/** 단계 연계 스트립의 다음 단계 — 트랙 인지형 (F1/F10, 2026-10-22 리뷰).
    onComplete 사슬을 트랙 비적용 단계인 채로 링크하면 TrackGate 루프에 빠진다
    (greenfield S5 → S6 링크). 엔진의 skip 의미론(lib/process-flow.ts —
    sequence가 뒤인 첫 skipped 아닌 단계가 nextStage)을 클라이언트에서
    미러링한다: applicableTracks가 캐리어 트랙을 제외하는 단계는 건너뛰고
    그다음 적용 단계로 나아간다 (S5→S8, brownfield S4→S6). 트랙 미확정이면
    기존처럼 onComplete 한 칸을 그대로 쓴다. */
function nextApplicableStage(from: StageMetaId, track?: TrackId | null): StageMetaId | null {
  let id: StageMetaId | "terminal" | null = STAGE_META.find((s) => s.id === from)?.onComplete ?? null;
  while (id && id !== "terminal") {
    const meta = STAGE_META.find((s) => s.id === id);
    if (!meta) return null;
    if (!track || meta.applicableTracks.includes(track)) return id;
    id = meta.onComplete;
  }
  return null;
}

/** 단계 연계 스트립 — 이 단계가 받는 입력과 넘기는 출력을 모든 단계 화면에
    표시한다 (ADR-0120 단계 연계). 다음 단계 CTA는 트랙·프로젝트 컨텍스트를
    반영해 STAGE_HREF로 연결된다. */
function StageHandoffStrip({ primary, track, linkFor, outputOpen = true }: { primary: StageMetaId; track?: TrackId | null; linkFor: (id: StageMetaId) => StageLink; outputOpen?: boolean }) {
  const handoff = STAGE_HANDOFF[primary];
  const nextId = nextApplicableStage(primary, track);
  // The output link follows the same predicate as the header CTA: a stage whose completion
  // requirements are unmet shows the output as plain text, not as a way forward.
  const nextHref = nextId && outputOpen ? linkFor(nextId).href : null;
  return (
    // 품평회 2026-10-22 잔여 #6 — 단계 연계(입력·출력 계약)는 열린 채로 읽힌다
    // (opt-out). 요약을 누르면 접을 수 있으나 기본값은 노출이다.
    <details className="handoff-panel" open>
      <summary>입력과 출력 <span className="handoff-panel-hint">이 단계가 받는 것 · 넘기는 것</span></summary>
      <div className="handoff" role="note" aria-label="단계 연계">
        <span className="handoff-hl">입력 ←</span>
        {handoff.inputs.map((inp) => (
          <span key={inp} className="handoff-chip">{inp}</span>
        ))}
        <span className="handoff-out">
          <span className="handoff-hl">출력 →</span>
          {nextHref ? (
            <Link href={nextHref} className="handoff-cta">{handoff.output} <span aria-hidden="true">→</span></Link>
          ) : (
            <span className="handoff-chip">{handoff.output}</span>
          )}
        </span>
      </div>
    </details>
  );
}

interface GuidanceInfo {
  status: string;
  blockers: string[];
  requiredArtifacts: string[];
}

function StepIcon({ state }: { state: StageRailStatus }) {
  if (state === "complete") return <CheckCircle2 size={14} aria-hidden="true" className="stage-step-icon stage-step-icon-done" />;
  if (state === "current") return <Circle size={14} fill="currentColor" aria-hidden="true" className="stage-step-icon stage-step-icon-current" />;
  if (state === "skipped") return <MinusCircle size={14} aria-hidden="true" className="stage-step-icon" />;
  return null;
}

/** Single engine-state read for a project stage (process API). The header CTA, the handoff output and
    the "what is left" list all derive from this one result — no second computation. */
export type GuidanceState = { phase: "idle" } | { phase: "loading" } | { phase: "failed" } | { phase: "ready"; info: GuidanceInfo };

function useStageGuidance(projectId: string | undefined, stageId: string): GuidanceState {
  const [state, setState] = useState<GuidanceState>({ phase: projectId ? "loading" : "idle" });

  useEffect(() => {
    if (!projectId) { setState({ phase: "idle" }); return; }
    let alive = true;
    setState({ phase: "loading" });
    fetch(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const stage = (j.data?.stages ?? []).find((s: { id: string }) => s.id === stageId) as
          | { status: string; requiredArtifacts?: string[] }
          | undefined;
        if (!alive) return;
        if (!stage) { setState({ phase: "failed" }); return; }
        setState({
          phase: "ready",
          info: {
            status: stage.status,
            // 차단 요건은 현재 단계 기준으로만 집계된다(process API 계약) —
            // 미완료 과거 단계의 화면에서는 그 단계의 필요 산출물이라도 보여준다.
            blockers: stage.status === "current" || stage.status === "blocked" ? (j.data?.blockers ?? []) : [],
            requiredArtifacts: stage.requiredArtifacts ?? [],
          },
        });
      })
      .catch(() => { if (alive) setState({ phase: "failed" }); });
    return () => { alive = false; };
  }, [projectId, stageId]);

  return state;
}

/** Whether the stage's completion predicate is met (engine status "complete"). */
function stageCompleteOf(state: GuidanceState): boolean {
  return state.phase === "ready" && state.info.status === "complete";
}

const NEXT_MISSING_ID = "stage-next-missing";

function StageGuidance({ state, projectId, stageId }: { state: GuidanceState; projectId?: string; stageId?: string }) {
  const tr = useTranslations();
  if (state.phase !== "ready") return null;
  const info = state.info;
  if (info.status === "complete") {
    return (
      <div className="mb-3" id={NEXT_MISSING_ID}>
        <span className="status-chip status-green">이 단계 완료 요건 충족 — 다음 단계로 진행할 수 있습니다</span>
      </div>
    );
  }
  const items = [...new Set([...info.blockers, ...info.requiredArtifacts])];
  return (
    <div id={NEXT_MISSING_ID} className="mb-3 border border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] rounded-lg px-3 py-2 text-[length:var(--fs-caption)] text-[color:var(--primary-dim)]">
      <b>이 단계에서 남은 것</b>
      {items.length === 0 ? (
        <p className="mt-1 mb-0">{tr("common.stageNav.missingUnknown")}</p>
      ) : (
        <ul className="mt-1 ml-4 list-disc">
          {items.map((it) => <li key={it}>{localizeBlocker(tr, it)}</li>)}
        </ul>
      )}
      {/* ADR-0186 D8: the S8 discount-rate blocker's next action is the WACC session. */}
      {stageId === "S8" && projectId && items.some((it) => /WACC|discount rate/i.test(it)) && (
        <p className="mt-1 mb-0"><Link className="underline font-semibold" href={`/projects/${encodeURIComponent(projectId)}/wacc`}>{tr("components.waccStatus.confirmLink")}</Link></p>
      )}
    </div>
  );
}

/** Layer 2 of the IA (design §3.3): one stepper, roving tabindex, arrow keys,
    aria-current="step". At <=880px (design-token-exempt: prose) it collapses
    to "S8 / 12 · name" with a disclosure list. Status is text
    (current/skipped), never colour alone. */
export type StageRailStatus = "complete" | "current" | "skipped" | "pending";
// INTERIM-WORDING: state words shown to assistive tech (full rail) and as text (compact list).
const RAIL_STATE_TEXT: Record<StageRailStatus, string> = { complete: "완료", current: "진행 중", skipped: "건너뜀", pending: "" };

export function StageRail({
  current,
  track,
  status,
  sticky = true,
}: {
  current: StageMetaId[];
  track?: TrackId;
  /** Opt-in per-stage state: icon + visually hidden word in the full rail, visible word in the compact list, neighbour names in the compact summary. */
  status?: Partial<Record<StageMetaId, StageRailStatus>>;
  /** false = static (overview pages); stage pages keep the sticky default. */
  sticky?: boolean;
}) {
  const tr = useTranslations();
  const carrierTrack = useCarrierTrack(track === undefined);
  track = track ?? carrierTrack ?? undefined;
  const linkFor = useStageLinks(track);
  const listRef = useRef<HTMLDivElement>(null);
  const cur = STAGE_META.find((s) => s.id === current[0])!;

  function trackApplicable(s: (typeof STAGE_META)[number]): boolean {
    return !track || s.applicableTracks.includes(track) || s.applicableTracks.length === 2;
  }
  function hrefFor(s: (typeof STAGE_META)[number]): string | null {
    return trackApplicable(s) ? linkFor(s.id).href : null;
  }
  /** Why a track-applicable stage cannot be opened (not promoted yet, still resolving). */
  function blockedReason(s: (typeof STAGE_META)[number]): string | null {
    return trackApplicable(s) ? linkFor(s.id).reason : null;
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("a.stage-step") ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = i;
    if (e.key === "ArrowRight") next = Math.min(items.length - 1, i + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else next = items.length - 1;
    e.preventDefault();
    items[next].focus();
  }

  const gateIds = Array.from(new Set(current.flatMap((id) => STAGE_META.find((s) => s.id === id)?.gateIds ?? [])));
  const currentKey = current.join(",");
  // Single-row stepper: keep the current stage in view (centered) after mount / stage change.
  useEffect(() => {
    const row = listRef.current;
    const el = row?.querySelector<HTMLElement>("[aria-current='step']");
    if (!row || !el) return;
    row.scrollLeft = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
  }, [currentKey]);

  const stateOf = (id: StageMetaId): StageRailStatus | null => (status ? status[id] ?? "pending" : null);
  const neighbours = status
    ? { prev: STAGE_META.find((s) => s.sequence === cur.sequence - 1) ?? null, next: STAGE_META.find((s) => s.sequence === cur.sequence + 1) ?? null }
    : null;
  const linked = STAGE_META.filter((s) => hrefFor(s));
  const tabStopId = (linked.find((s) => current.includes(s.id)) ?? linked[0])?.id;

  return (
    <nav aria-label="Stages" className={`stage-stepper-wrap${sticky ? "" : " stage-stepper-wrap--static"}${status ? " stage-stepper--status" : ""}`}>
      <details className="stage-stepper-compact">
        <summary>
          <span className="stage-stepper-compact-label">{cur.id} / 12 · {cur.name}</span>
          {neighbours && (neighbours.prev || neighbours.next) && (
            // INTERIM-WORDING: previous/next labels.
            <span className="stage-stepper-compact-near">
              {neighbours.prev ? `이전: ${neighbours.prev.id} ${neighbours.prev.name}` : ""}
              {neighbours.prev && neighbours.next ? " · " : ""}
              {neighbours.next ? `다음: ${neighbours.next.id} ${neighbours.next.name}` : ""}
            </span>
          )}
        </summary>
        <ol className="stage-stepper-compact-list">
          {STAGE_META.map((s) => {
            const href = hrefFor(s);
            const isCurrent = current.includes(s.id);
            const blocked = blockedReason(s);
            return (
              <li key={s.id}>
                {href ? (
                  <Link href={href} aria-current={isCurrent ? "step" : undefined} className="stage-step-compact-link">
                    {s.sequence}. {s.name}{status ? (RAIL_STATE_TEXT[stateOf(s.id)!] ? ` (${RAIL_STATE_TEXT[stateOf(s.id)!]})` : "") : isCurrent ? " (현재)" : ""}
                  </Link>
                ) : (
                  <span className="stage-step-compact-link stage-step-skipped">{s.sequence}. {s.name} ({blocked ? "승격 후 열림" : "미적용"})</span>
                )}
              </li>
            );
          })}
        </ol>
      </details>
      <div className="stage-stepper" ref={listRef} onKeyDown={onKeyDown}>
        {STAGE_META.map((s) => {
          const isCurrent = current.includes(s.id);
          const href = hrefFor(s);
          const blocked = blockedReason(s);
          const skipped = !href && !trackApplicable(s);
          const title = skipped
            ? `${s.name} — 현재 트랙 미적용`
            : blocked
              ? `${s.name} — ${blocked}`
              : `${s.name} — ${s.objective}`;
          const body = (
            <>
              <span className="stage-step-num">{s.sequence}</span>
              <span className="stage-step-name">{s.name}</span>
              {status && <StepIcon state={stateOf(s.id)!} />}
              {status && RAIL_STATE_TEXT[stateOf(s.id)!] && <span className="sr-only">{RAIL_STATE_TEXT[stateOf(s.id)!]}</span>}
              {!status && isCurrent && <span className="stage-step-state">현재</span>}
              {skipped && <span className="stage-step-state">미적용</span>}
              {!skipped && !href && blocked && <span className="stage-step-state">승격 후</span>}
              {/* 품평회 2026-10-22 잔여 #3 — 차단 사유를 title(hover) 한정으로 두지
                  않는다. 포커스(탭·탭) 시 사유를 눈에 보이는 말풍선으로 띄운다. */}
              {!skipped && !href && blocked && <span className="stage-step-reason" aria-hidden="true">{blocked}</span>}
            </>
          );
          return href ? (
            <Link
              key={s.id}
              href={href}
              aria-current={isCurrent ? "step" : undefined}
              title={title}
              tabIndex={s.id === tabStopId ? 0 : -1}
              className={`stage-step${isCurrent ? " stage-step-current" : ""}`}
            >
              {body}
            </Link>
          ) : (
            <span key={s.id} title={title} aria-disabled="true" tabIndex={0} className={`stage-step stage-step-skipped`}>{body}</span>
          );
        })}
        {gateIds.length > 0 && (
          <span className="stage-gate-marker">
            {gateIds.map((g) => (
              <span
                key={g}
                className="status-chip status-amber stage-gate-chip"
                title={tr("common.gate.markerTitle", { gate: tr(GATE_LABEL_KEY[g] ?? g) })}
              >
                {tr("common.gate.markerLabel", { gate: tr(GATE_LABEL_KEY[g] ?? g) })}
              </span>
            ))}
          </span>
        )}
      </div>
    </nav>
  );
}
