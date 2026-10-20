"use client";

// S8 `필요 역량 달성 가능성` — READ-ONLY summary (ADR-0171). The judgement is edited on S5
// (Green Field) and, per target, on S7 (Brown Field); this panel shows the S3 definition and
// the S5 judgement in the canonical column order (필요도, 필요 수준, 보유 판정, 보유 수준,
// 해소 방식, 기대 수준, 비용, 기간, 달성 가능성, 확정) with a link to the edit surface. It has
// no inputs and no save/confirm buttons; the technical lens T1 and the banner read the same data.
//
// Brown Field (ADR-0171 slice 2): the rows are the SELECTED target's S7 judgements (read-only); the
// edit link points at that target's `필요 역량 점검` on the target detail page.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import {
  CapabilityJudgementTable, RemovedCapabilities, SummaryStrip, toJudgementDraft,
  type AttainabilityViewData,
} from "./CapabilityJudgementTable.tsx";

export function CapabilityAttainabilityPanel({ projectId, compact, onOpen }: { projectId: string; compact?: boolean; onOpen?: () => void }) {
  const [view, setView] = useState<AttainabilityViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/capability-attainability`;
  // 2026-10-19 decider: S9 실사·검증의 필요 역량 검증 결과(브라운필드 대상 기준 판정)를
  // 이 패널에 반영합니다 — 읽기 전용이며, 판정 기록은 S9 필요 역량 검증 탭(사람 전용)입니다.
  const [ddVerdicts, setDdVerdicts] = useState<Array<{ rowId: string; capability: string; coverage: string; note: string; by: string; at: string }> | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<AttainabilityViewData>(base).then((res) => { if (alive) setView(res.data); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "달성 가능성을 불러오지 못했습니다."); });
    api.get<{ rows: Array<{ id: string; capability: string; verdict: { coverage: string; note: string; by: string; at: string } | null }> }>(
      `/api/projects/${encodeURIComponent(projectId)}/capability-dd`,
    ).then((res) => {
      if (!alive) return;
      const withVerdict = (res.data.rows ?? []).filter((r) => r.verdict);
      setDdVerdicts(withVerdict.map((r) => ({ rowId: r.id, capability: r.capability, coverage: r.verdict!.coverage, note: r.verdict!.note, by: r.verdict!.by, at: r.verdict!.at })));
    }).catch(() => { if (alive) setDdVerdicts([]); });
    return () => { alive = false; };
  }, [base]);

  if (error && !view) return <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성"><p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p></section>;
  if (!view) return <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성"><p className="text-[color:var(--muted-fg)]">불러오는 중…</p></section>;

  const oppId = view.opportunity_id;
  const s3Href = `/deals/${encodeURIComponent(oppId ?? "")}/s3`;
  const editAt = view.edit_at ?? "S5";
  const editHref = view.edit_href !== undefined ? view.edit_href : oppId ? (editAt === "S5" ? `/deals/${encodeURIComponent(oppId)}/s5` : `/deals/${encodeURIComponent(oppId)}/s7`) : null;

  if (compact) {
    return (
      <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성 요약">
        <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
        <SummaryStrip s={view.summary} />
        {onOpen && <button type="button" className="text-[color:var(--accent)] font-bold" onClick={onOpen}>달성 가능성 판정 보기 →</button>}
      </section>
    );
  }

  const drafts = Object.fromEntries(view.rows.map((r) => [r.id, toJudgementDraft(r)]));
  const isBrownfield = view.track === "brownfield";
  const s9Href = `/projects/${encodeURIComponent(projectId)}/dd`;
  const coverageKo: Record<string, string> = { resolved: "해소 (대상 보유)", partial: "부분 해소", unresolved: "미해소 (자체 투자 필요)" };
  return (
    <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성">
      <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
      {/* 2026-10-19 decider: S9 실사·검증의 필요 역량 검증 결과를 이 패널에 반영합니다 —
          읽기 전용이며, 판정 기록은 S9 필요 역량 검증 탭(사람 전용)입니다. */}
      {ddVerdicts && ddVerdicts.length > 0 && (
        <section className="market-section mt-2" aria-label="S9 필요 역량 검증 결과" data-testid="s9-capability-dd-results">
          <h4 className="text-[0.9rem] font-semibold mb-1">S9 필요 역량 검증 결과 (브라운필드 대상 기준)</h4>
          <table className="data-table" aria-label="S9 필요 역량 검증 결과">
            <thead><tr><th scope="col">필요 역량</th><th scope="col">판정</th><th scope="col">근거</th><th scope="col">기록</th></tr></thead>
            <tbody>
              {ddVerdicts.map((v) => (
                <tr key={v.rowId}>
                  <td className="font-semibold">{v.capability}</td>
                  <td><span className={`status-chip ${v.coverage === "resolved" ? "status-green" : v.coverage === "partial" ? "status-amber" : "status-red"}`}>{coverageKo[v.coverage] ?? v.coverage}</span></td>
                  <td className="text-[length:var(--fs-caption)]">{v.note || "—"}</td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{v.by} · {v.at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {isBrownfield
          ? <>브라운필드 필요 역량 판정 주전장은 S9 실사·검증 — <a href={s9Href} className="text-[color:var(--accent)] underline font-semibold">필요 역량 검증 탭에서</a> 판정을 기록하며, 그 결과는 이 패널에 반영됩니다.</>
          : editAt === "S7"
          ? <>읽기 전용 요약입니다 — 정의는 S3에서, 해소 방식·기대 수준·비용·기간·달성 가능성의 판정과 확정은 S7 대상별 필요 역량 점검에서 합니다{view.selected_target ? ` (선정 대상: ${view.selected_target.company_name})` : " — 선정된 대상이 없어 아직 판정이 없습니다"}.
            {editHref && <> <a href={editHref} className="text-[color:var(--accent)] underline font-semibold">S7에서 판정</a></>}</>
          : <>읽기 전용 요약입니다 — 정의는 S3에서, 해소 방식·기대 수준·비용·기간·달성 가능성의 판정과 확정은 S5에서 합니다.
            {editHref && <> <a href={editHref} className="text-[color:var(--accent)] underline font-semibold">S5에서 판정</a></>}</>}
      </p>
      <SummaryStrip s={view.summary} />
      {view.rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)]">S3 필요 역량 레지스터에 행이 없습니다. S3에서 필요 역량을 먼저 정리하세요.</p>
      ) : (
        <CapabilityJudgementTable rows={view.rows} drafts={drafts} editable={false} s3Href={s3Href} judgeHref={isBrownfield ? s9Href : editHref} judgeLabel={isBrownfield ? "S9에서 판정" : editAt === "S7" ? "S7에서 판정" : "S5에서 판정"} />
      )}
      <RemovedCapabilities removed={view.removed_capabilities ?? []} />
    </section>
  );
}
