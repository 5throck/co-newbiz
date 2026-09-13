"use client";

// P0 공통 골격 — 표준 화면 패턴 (ADR-0086, docs/designs/2026-09-01-standard-screen-patterns-design_ko.md).
// 단계 화면의 유일한 외피: 단계 헤더 + S1~S12 진행 레일(StageRail) + 본문 슬롯.
// 데이터원은 lib/stage-meta.ts (flow.spec 발췌, 정합 테스트로 강제) — 페이지별 하드코딩 금지.
//
// ADR-0116 Phase 7: 프로젝트 단계(S8~S12) 화면에서는 현재 단계의 차단 요건과
// 필요 산출물을 프레임이 직접 안내한다(process API 재사용 — 페이지별 중복
// 구현 없이 전 하위 탭에 자동 적용). 데이터가 없거나 조회에 실패하면 조용히
// 숨는다 — 가이던스는 부가 정보이지 본문을 가리는 것이 아니다.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { GATE_LABEL, STAGE_META, type StageMetaId, type TrackId } from "../lib/stage-meta.ts";
import { STAGE_HANDOFF } from "../lib/stage-handoff.ts";

/** 단계 → 담당 화면 라우트. 프로젝트 단계(S8~S12)는 /projects/[id] 컨텍스트에서만 링크된다. */
const STAGE_HREF: Record<StageMetaId, (projectId?: string) => string | null> = {
  S1: () => "/market",
  S2: () => "/opportunities",
  S3: () => "/synergy",
  S4: (p) => (p ? `/deals/${p}/s4` : "/route-decision"),
  S5: () => "/greenfield",
  S6: () => "/brownfield",
  S7: () => "/brownfield",
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
  return (
    <>
      <h1>
        {heading ?? `${stage.id} ${ids.length > 1 ? `· ${STAGE_META.find((s) => s.id === ids[1])!.name}` : stage.name}`}
      </h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">{stage.objective}</p>
      <StageRail current={ids} track={track} />
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
    <div className="mb-3 border border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] rounded-lg px-3 py-2 text-[0.8rem] text-[color:var(--primary-dim)]">
      <b>이 단계에서 남은 것</b>
      <ul className="mt-1 ml-4 list-disc">
        {items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    </div>
  );
}

export function StageRail({ current, track }: { current: StageMetaId[]; track?: TrackId }) {
  const params = useParams<{ id?: string }>();
  const projectId = params?.id;
  return (
    <nav aria-label="프로세스 단계 진행" className="sizing-step-rail mb-4">
      {STAGE_META.map((s) => {
        const isCurrent = current.includes(s.id);
        const trackApplicable =
          !track || s.applicableTracks.includes(track) || s.applicableTracks.length === 2;
        // 트랙 적용 단계만 담당 화면으로 링크된다 — 프로젝트 단계는
        // /projects/[id] 컨텍스트(하위 라우트의 params.id)에서만 링크를 얻는다.
        const href = trackApplicable ? STAGE_HREF[s.id](projectId) : null;
        const cls = `sizing-step-link ${isCurrent ? "stage-rail-current" : ""} ${!trackApplicable ? "stage-rail-skipped" : ""}`;
        const style = !trackApplicable ? { opacity: 0.4, textDecoration: "line-through" } : undefined;
        const title = !trackApplicable
          ? `${s.name} — 현재 트랙 미적용`
          : href
            ? `${s.name} — ${s.objective} (화면으로 이동)`
            : `${s.name} — ${s.objective}`;
        const body = (
          <>
            <span className="sizing-step-num">{s.sequence}</span>
            {s.name}
            {isCurrent && (
              <span className="flex flex-wrap gap-0.5 ml-1">
                {s.gateIds.map((g) => (
                  <span key={g} className="status-chip status-amber" style={{ fontSize: "0.6rem", padding: "0.05rem 0.3rem" }}>
                    {GATE_LABEL[g]}
                  </span>
                ))}
              </span>
            )}
          </>
        );
        return href ? (
          <Link
            key={s.id}
            href={href}
            aria-current={isCurrent ? "page" : undefined}
            title={title}
            className={cls}
            style={style}
          >
            {body}
          </Link>
        ) : (
          <span
            key={s.id}
            aria-current={isCurrent ? "page" : undefined}
            title={title}
            className={cls}
            style={style}
          >
            {body}
          </span>
        );
      })}
    </nav>
  );
}
