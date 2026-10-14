"use client";

// S8 `필요 역량 달성 가능성` — READ-ONLY summary (ADR-0171). The judgement is edited on S5
// (Green Field) and, per target, on S7 (Brown Field); this panel shows the S3 definition and
// the S5 judgement in the canonical column order (필요도, 필요 수준, 보유 판정, 보유 수준,
// 해소 방식, 기대 수준, 비용, 기간, 달성 가능성, 확정) with a link to the edit surface. It has
// no inputs and no save/confirm buttons; the technical lens T1 and the banner read the same data.
//
// Brown Field bridge: until the S7 per-target surface ships (slice 2b) a Brown Field project keeps
// the previous editable behaviour through the shared editor, so judgements stay writable there.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { CapabilityJudgementEditor } from "./CapabilityJudgementEditor.tsx";
import {
  CapabilityJudgementTable, RemovedCapabilities, SummaryStrip, toJudgementDraft,
  type AttainabilityViewData,
} from "./CapabilityJudgementTable.tsx";

export function CapabilityAttainabilityPanel({ projectId, compact, onOpen }: { projectId: string; compact?: boolean; onOpen?: () => void }) {
  const [view, setView] = useState<AttainabilityViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/capability-attainability`;

  useEffect(() => {
    let alive = true;
    api.get<AttainabilityViewData>(base).then((res) => { if (alive) setView(res.data); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "달성 가능성을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [base]);

  if (error && !view) return <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성"><p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p></section>;
  if (!view) return <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성"><p className="text-[color:var(--muted-fg)]">불러오는 중…</p></section>;

  const oppId = view.opportunity_id;
  const s3Href = `/deals/${encodeURIComponent(oppId ?? "")}/s3`;
  const editAt = view.edit_at ?? "S5";
  const editHref = oppId ? (editAt === "S5" ? `/deals/${encodeURIComponent(oppId)}/s5` : `/deals/${encodeURIComponent(oppId)}/s7`) : null;

  if (compact) {
    return (
      <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성 요약">
        <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
        <SummaryStrip s={view.summary} />
        {onOpen && <button type="button" className="text-[color:var(--accent)] font-bold" onClick={onOpen}>달성 가능성 판정 보기 →</button>}
      </section>
    );
  }

  // Temporary Brown Field bridge (see header): editable through the legacy project routes.
  if (editAt === "S7") {
    return (
      <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성">
        <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
        <CapabilityJudgementEditor endpoint={base} s3Href={s3Href}
          intro="Brown Field는 대상별 판정을 S7에서 하도록 옮기는 중입니다 — S7 판정 화면이 제공되기 전까지는 여기서 판정합니다. 이 판정은 사람이 확정하며 사업성 수치에 자동 반영되지 않습니다." />
      </section>
    );
  }

  const drafts = Object.fromEntries(view.rows.map((r) => [r.id, toJudgementDraft(r)]));
  return (
    <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성">
      <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        읽기 전용 요약입니다 — 정의는 S3에서, 해소 방식·기대 수준·비용·기간·달성 가능성의 판정과 확정은 S5에서 합니다.
        {editHref && <> <a href={editHref} className="text-[color:var(--accent)] underline font-semibold">S5에서 판정</a></>}
      </p>
      <SummaryStrip s={view.summary} />
      {view.rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)]">S3 필요 역량 레지스터에 행이 없습니다. S3에서 필요 역량을 먼저 정리하세요.</p>
      ) : (
        <CapabilityJudgementTable rows={view.rows} drafts={drafts} editable={false} s3Href={s3Href} judgeHref={editHref} />
      )}
      <RemovedCapabilities removed={view.removed_capabilities ?? []} />
    </section>
  );
}
