"use client";

// P0 공통 골격 — 표준 화면 패턴 (ADR-0086, docs/designs/2026-09-01-standard-screen-patterns-design_ko.md).
// 단계 화면의 유일한 외피: 단계 헤더 + S1~S12 진행 레일(StageRail) + 본문 슬롯.
// 데이터원은 lib/stage-meta.ts (flow.spec 발췌, 정합 테스트로 강제) — 페이지별 하드코딩 금지.
//
// ADR-0116 Phase 7: 프로젝트 단계(S8~S12) 화면에서는 현재 단계의 차단 요건과
// 필요 산출물을 프레임이 직접 안내한다(process API 재사용 — 페이지별 중복
// 구현 없이 전 하위 탭에 자동 적용). 데이터가 없거나 조회에 실패하면 조용히
// 숨는다 — 가이던스는 부가 정보이지 본문을 가리는 것이 아니다.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { GATE_LABEL, STAGE_META, type StageMetaId, type TrackId } from "../lib/stage-meta.ts";
import { STAGE_HANDOFF } from "../lib/stage-handoff.ts";

/** 단계 → 담당 화면 라우트. 캐리어(project id)가 있으면 /deals/{id}/sN 탭으로,
    없으면 플랫 라우트(캐리어 리다이렉트 스텁 — 2026-10-02 route-cleanup design
    §4.2/§4.3)로 보낸다. 프로젝트 단계(S8~S12)는 /projects/[id] 컨텍스트에서만 링크된다. */
const STAGE_HREF: Record<StageMetaId, (projectId?: string) => string | null> = {
  S1: (p) => (p ? `/deals/${p}/s1` : "/market"),
  S2: (p) => (p ? `/deals/${p}/s2` : "/opportunities"),
  S3: (p) => (p ? `/deals/${p}/s3` : "/synergy"),
  S4: (p) => (p ? `/deals/${p}/s4` : "/route-decision"),
  S5: (p) => (p ? `/deals/${p}/s5` : "/greenfield"),
  S6: (p) => (p ? `/deals/${p}/s6` : "/brownfield"),
  S7: (p) => (p ? `/deals/${p}/s7` : "/brownfield"),
  S8: (p) => (p ? `/projects/${p}/business-case` : null),
  S9: (p) => (p ? `/projects/${p}/dd` : null),
  S10: (p) => (p ? `/projects/${p}/deal-structure` : null),
  S11: (p) => (p ? `/projects/${p}/ic-review` : null),
  S12: (p) => (p ? `/projects/${p}/portfolio` : null),
};

/** 가이던스 스트립이 붙는 프로젝트 전용 단계 — 기회 단계(S1~S7)는 별도 화면이 담당한다. */
const PROJECT_STAGE_IDS = new Set(["S8", "S9", "S10", "S11", "S12"]);

export function StageFrame({
  stageId,
  track,
  heading,
  children,
}: {
  /** 이 화면이 담당하는 단계 — 복합 단계는 배열(S6·S7처럼 한 화면이 두 단계) */
  stageId: StageMetaId | StageMetaId[];
  /** 화면이 고정 트랙에서 동작할 때 지정 — 트랙 미해당 단계를 레일에서 비활성 */
  track?: TrackId;
  /** 지원 도구 화면용 제목 재정의 (예: S3의 그룹/계열사 프로파일 화면) — 레일·메타는 stageId를 따른다 */
  heading?: string;
  children?: ReactNode;
}) {
  const ids = Array.isArray(stageId) ? stageId : [stageId];
  const primary = ids[0];
  const stage = STAGE_META.find((s) => s.id === primary)!;
  const params = useParams<{ id?: string }>();
  const projectId = params?.id;
  // Under /projects/[id]/** StageTabs owns the stepper (one stepper per screen).
  const stepperOwnedByTabs = (usePathname() ?? "").startsWith("/projects/");
  return (
    <>
      <h1>
        {heading ?? `${stage.id} ${ids.length > 1 ? `· ${STAGE_META.find((s) => s.id === ids[1])!.name}` : stage.name}`}
      </h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">{stage.objective}</p>
      {!stepperOwnedByTabs && <StageRail current={ids} track={track} />}
      <StageHandoffStrip primary={primary} projectId={projectId} track={track} />
      {projectId && PROJECT_STAGE_IDS.has(primary) && <StageGuidance projectId={projectId} stageId={primary} />}
      {/* 단계 설명 슬롯 — 서식은 프레임이 표준화한다(0.9rem·muted·leading-relaxed,
          하단 간격 mb-4). 페이지별 클래스·<strong> 강조 금지(설계서 개정 2026-09-04). */}
      {children && (
        <div className="mb-4 text-[0.9rem] text-[color:var(--muted-fg)] leading-relaxed">
          {children}
        </div>
      )}
    </>
  );
}

/** 단계 연계 스트립 — 이 단계가 받는 입력과 넘기는 출력을 모든 단계 화면에
    표시한다 (ADR-0120 단계 연계). 다음 단계 CTA는 트랙·프로젝트 컨텍스트를
    반영해 STAGE_HREF로 연결된다. */
function StageHandoffStrip({ primary, projectId, track }: { primary: StageMetaId; projectId?: string; track?: TrackId }) {
  const handoff = STAGE_HANDOFF[primary];
  const nextId = STAGE_META.find((s) => s.id === primary)?.onComplete ?? null;
  const nextHref = nextId && nextId !== "terminal" ? STAGE_HREF[nextId](projectId) : null;
  return (
    <details className="handoff-panel">
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

function StageGuidance({ projectId, stageId }: { projectId: string; stageId: string }) {
  const [info, setInfo] = useState<GuidanceInfo | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const stage = (j.data?.stages ?? []).find((s: { id: string }) => s.id === stageId) as
          | { status: string; requiredArtifacts?: string[] }
          | undefined;
        if (!alive) return;
        if (!stage) { setHidden(true); return; }
        setInfo({
          status: stage.status,
          // 차단 요건은 현재 단계 기준으로만 집계된다(process API 계약) —
          // 미완료 과거 단계의 화면에서는 그 단계의 필요 산출물이라도 보여준다.
          blockers: stage.status === "current" || stage.status === "blocked" ? (j.data?.blockers ?? []) : [],
          requiredArtifacts: stage.requiredArtifacts ?? [],
        });
      })
      .catch(() => { if (alive) setHidden(true); });
    return () => { alive = false; };
  }, [projectId, stageId]);

  if (hidden || !info) return null;
  if (info.status === "complete") {
    return (
      <div className="mb-3">
        <span className="status-chip status-green">이 단계 완료 요건 충족 — 다음 단계로 진행할 수 있습니다</span>
      </div>
    );
  }
  const items = [...new Set([...info.blockers, ...info.requiredArtifacts])];
  if (items.length === 0) return null;
  return (
    <div className="mb-3 border border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] rounded-lg px-3 py-2 text-[length:var(--fs-caption)] text-[color:var(--primary-dim)]">
      <b>이 단계에서 남은 것</b>
      <ul className="mt-1 ml-4 list-disc">
        {items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    </div>
  );
}

/** Layer 2 of the IA (design §3.3): one stepper, roving tabindex, arrow keys,
    aria-current="step". At <=880px it collapses to "S8 / 12 · name" with a
    disclosure list. Status is text (current/skipped), never colour alone. */
export function StageRail({ current, track }: { current: StageMetaId[]; track?: TrackId }) {
  const params = useParams<{ id?: string }>();
  const projectId = params?.id;
  const listRef = useRef<HTMLDivElement>(null);
  const cur = STAGE_META.find((s) => s.id === current[0])!;

  function hrefFor(s: (typeof STAGE_META)[number]): string | null {
    const trackApplicable = !track || s.applicableTracks.includes(track) || s.applicableTracks.length === 2;
    return trackApplicable ? STAGE_HREF[s.id](projectId) : null;
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

  const linked = STAGE_META.filter((s) => hrefFor(s));
  const tabStopId = (linked.find((s) => current.includes(s.id)) ?? linked[0])?.id;

  return (
    <nav aria-label="Stages" className="stage-stepper-wrap">
      <details className="stage-stepper-compact">
        <summary>
          <span className="stage-stepper-compact-label">{cur.id} / 12 · {cur.name}</span>
        </summary>
        <ol className="stage-stepper-compact-list">
          {STAGE_META.map((s) => {
            const href = hrefFor(s);
            const isCurrent = current.includes(s.id);
            return (
              <li key={s.id}>
                {href ? (
                  <Link href={href} aria-current={isCurrent ? "step" : undefined} className="stage-step-compact-link">
                    {s.sequence}. {s.name}{isCurrent ? " (현재)" : ""}
                  </Link>
                ) : (
                  <span className="stage-step-compact-link stage-step-skipped">{s.sequence}. {s.name} (미적용)</span>
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
          const skipped = !href && !(!track || s.applicableTracks.includes(track) || s.applicableTracks.length === 2);
          const title = skipped ? `${s.name} — 현재 트랙 미적용` : `${s.name} — ${s.objective}`;
          const body = (
            <>
              <span className="stage-step-num">{s.sequence}</span>
              <span className="stage-step-name">{s.name}</span>
              {isCurrent && <span className="stage-step-state">현재</span>}
              {skipped && <span className="stage-step-state">미적용</span>}
              {isCurrent &&
                s.gateIds.map((g) => (
                  <span
                    key={g}
                    className="status-chip status-amber stage-gate-chip"
                    title={`${GATE_LABEL[g]} 게이트 — 여러 단계가 같은 게이트 심사를 공유합니다. 이 단계가 최종적으로 어느 게이트 판정(Go/Hold/Kill)에 속하는지 보여주는 표시입니다.`}
                  >
                    {GATE_LABEL[g]}
                  </span>
                ))}
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
            <span key={s.id} title={title} className={`stage-step stage-step-skipped`}>{body}</span>
          );
        })}
      </div>
    </nav>
  );
}
