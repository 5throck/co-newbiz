"use client";

// S8 `기술적 타당성` (ADR-0169): the six items as TABS (2026-10-20 decider round 4).
// T1 (required-capability attainability) is derived from the capability judgement and
// shows the ADR-0168 panel; T2-T5 are DERIVED from the S9 실사·검증 verdicts a person
// records on the technical DD tab (migration 0157 sidecar) — this surface only reflects
// them; T6 shows how far the S8↔S9 pairing has progressed. Warning only: nothing here
// caps a grade or blocks a gate.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { LENS_VIEW } from "../../lib/s8-lens-status.ts";
import type { S8LensSummary } from "../../lib/s8-lens-summary.ts";
import type { LensItemView } from "../../lib/technical-lens.ts";
import { CapabilityAttainabilityPanel } from "./CapabilityAttainabilityPanel.tsx";

const S9_ITEM_KEYS = new Set(["T2", "T3", "T4", "T5"]);

export function TechnicalLensPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<S8LensSummary | null>(null);
  const [tab, setTab] = useState("T1");
  useEffect(() => {
    let alive = true;
    api.get<S8LensSummary>(`/api/projects/${encodeURIComponent(projectId)}/s8-lens-summary`).then((r) => { if (alive) setData(r.data); }).catch(() => { /* the items list is additive */ });
    return () => { alive = false; };
  }, [projectId]);
  const items = data?.technical.items ?? [];
  const active = items.find((i) => i.key === tab) ?? items[0];
  const s9Href = `/projects/${encodeURIComponent(projectId)}/dd`;
  return (
    <section className="market-section sizing-step mb-3" aria-label="기술적 타당성 항목">
      <h3 className="sizing-step-title">기술적 타당성 항목 <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">(6개)</span></h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        항목별 판정은 사람이 합니다. T1은 필요 역량 판정에서 자동 도출되고, T2~T5는 S9 실사·검증 기술 탭에서 기록한 판정을 읽어 반영합니다. 수치나 등급에는 자동 반영되지 않습니다.
      </p>
      {items.length === 0 ? (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">항목을 불러오는 중…</p>
      ) : (
        <>
          <div role="tablist" aria-label="기술적 타당성 항목 탭" className="flex flex-wrap gap-1 mb-2" data-testid="tech-item-tabs">
            {items.map((it) => {
              const v = LENS_VIEW[it.status];
              const selected = active?.key === it.key;
              return (
                <button key={it.key} type="button" role="tab" id={`tech-tab-${it.key}`} aria-selected={selected} aria-controls={`tech-item-${it.key}`}
                  className={selected ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setTab(it.key)}>
                  <span className="font-bold">{it.key}</span> {it.label} <span className={`status-chip ${v.cls}`}><span aria-hidden="true">{v.icon}</span> {v.label}</span>
                </button>
              );
            })}
          </div>
          {active && (
            <div role="tabpanel" id={`tech-item-${active.key}`} aria-labelledby={`tech-tab-${active.key}`} data-testid="tech-item-panel">
              {active.key === "T1" && (
                <>
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">사업 역량 판정에서 자동 도출 — {active.note}</p>
                  <div id="capability-attainability"><CapabilityAttainabilityPanel projectId={projectId} /></div>
                </>
              )}
              {S9_ITEM_KEYS.has(active.key) && <TechItemVerdictView item={active} s9Href={s9Href} />}
              {active.key === "T6" && <PairingView items={items} note={active.note} mismatchCount={data?.technical.mismatchCount ?? 0} s9Href={s9Href} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** T2-T5: the S9-derived verdict (read-only) or a pointer to where a person records it. */
function TechItemVerdictView({ item, s9Href }: { item: LensItemView; s9Href: string }) {
  const v = LENS_VIEW[item.status];
  return (
    <div className="grid gap-1" data-testid={`tech-item-verdict-${item.key}`}>
      <p className="text-[length:var(--fs-body)]">
        <span className={`status-chip ${v.cls} mr-1`}><span aria-hidden="true">{v.icon}</span> {v.label}</span>
        {item.judged ? item.note : <span className="text-[color:var(--muted-fg)]">{item.note}</span>}
      </p>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        판정 기록은 S9 실사·검증의 기술 탭에서 사람이 합니다 (근거는 조사내역 인용) —{" "}
        <a href={s9Href} className="text-[color:var(--accent)] font-bold">S9 기술 탭에서 {item.judged ? "수정" : "판정 기록"} →</a>
      </p>
    </div>
  );
}

/** T6: how the S8 items pair with their S9 basis. */
function PairingView({ items, note, mismatchCount, s9Href }: { items: LensItemView[]; note: string; mismatchCount: number; s9Href: string }) {
  const basis = (it: LensItemView) =>
    it.key === "T1" ? "필요 역량 판정에서 자동 도출" : it.judged ? "S9 판정 기록됨" : "S9 판정 미기록";
  return (
    <div className="grid gap-1" data-testid="tech-item-pairing">
      <p className="text-[length:var(--fs-body)]">{note}</p>
      <ul className="sizing-note-list" aria-label="항목별 S9 짝 검증 근거">
        {items.filter((it) => it.key !== "T6").map((it) => (
          <li key={it.key}>
            <span className="font-bold mr-1">{it.key}</span>{it.label} — <span className={it.judged ? "" : "text-[color:var(--muted-fg)]"}>{basis(it)}</span>
          </li>
        ))}
      </ul>
      {mismatchCount > 0 && <p className="status-chip status-amber inline-block" role="note">실사와 다름 {mismatchCount}건 — 기록된 검증 결과가 S8 항목과 어긋납니다.</p>}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        짝 검증은 S9에서 T2~T5 판정이 기록될 때 채워집니다 — <a href={s9Href} className="text-[color:var(--accent)] font-bold">S9 기술 탭 →</a>
      </p>
    </div>
  );
}
