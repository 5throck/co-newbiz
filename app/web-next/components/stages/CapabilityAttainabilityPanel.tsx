"use client";

// S8 `필요 역량 달성 가능성` (ADR-0168, slices 1-2). Per S3 register row: required /
// current level (shared 5-step scale), resolution route, closing cost (KRW million),
// months to attain and a HUMAN attainability judgement (높음/중간/낮음; 미판정 until
// someone judges). Saving a draft is open to analyst+ members; confirming is a
// human-only act (cookie session). Numbers are NOT pushed into the case model —
// Evidence is no longer edited here (one 근거·증빙 field = rationale, edited in a modal); the save payload omits
// the `evidence` key so stored lines are never wiped, and they show read-only.
// the banner states that the figures assume the capabilities can be secured.
import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { ColGroup } from "../ui.tsx";
import { LevelSelect } from "./LevelSelect.tsx";
import { HELD_STATUS_CHIP, HELD_STATUS_LABEL, RESOLUTION_LABEL, type GapResolution } from "../../lib/capability-gap.ts";
import type { AttainabilityRowView, AttainabilitySummary } from "../../lib/capability-attainability.ts";

interface View {
  opportunity_id: string | null;
  stored: boolean;
  rows: AttainabilityRowView[];
  summary: AttainabilitySummary;
}

interface Draft {
  requiredLevel: string; currentLevel: string; resolution: string;
  cost: string; months: string; grade: string; rationale: string;
}

const COL_PCT = [23, 7, 7, 9, 9, 9, 12, 16, 8] as const;
const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
const GRADE_OPTIONS = [
  { value: "", text: "미판정" }, { value: "high", text: "높음" },
  { value: "medium", text: "중간" }, { value: "low", text: "낮음" },
] as const;

const toDraft = (r: AttainabilityRowView): Draft => ({
  requiredLevel: r.required_level, currentLevel: r.current_level, resolution: r.resolution ?? "",
  cost: r.closing_cost_krw_m === null ? "" : String(r.closing_cost_krw_m),
  months: r.months_to_attain === null ? "" : String(r.months_to_attain),
  grade: r.grade ?? "", rationale: r.rationale,
});

const RATIONALE_MAX = 600; // mirrors the server cap in lib/capability-attainability.ts
const PREVIEW_LEN = 60;

function RationaleDialog({ capability, initial, readOnly, onSave, onClose }: {
  capability: string; initial: string; readOnly: boolean; onSave: (text: string) => void; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState(initial);
  const fieldId = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const title = `${capability} 근거·증빙`;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "36rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>
        <label className="sr-only" htmlFor={fieldId}>{title}</label>
        <textarea id={fieldId} className="sizing-new-input w-full mt-2" rows={10} maxLength={RATIONALE_MAX} autoFocus readOnly={readOnly}
          placeholder="근거·증빙 (높음·낮음은 근거 필수)" value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" aria-live="polite">{text.length} / {RATIONALE_MAX}자</p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{readOnly ? "닫기" : "취소"}</button>
          {!readOnly && <button type="button" className="btn-ghost btn-sm" onClick={() => onSave(text)}>저장</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SummaryStrip({ s }: { s: AttainabilitySummary }) {
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-2" aria-label="필요 역량 요약">
        <span className="status-chip status-green">{HELD_STATUS_LABEL.met} {s.held.met}</span>
        <span className="status-chip status-amber">부분 {s.held.partial}</span>
        <span className="status-chip status-red">{HELD_STATUS_LABEL.unmet} {s.held.unmet}</span>
        <span className="status-chip status-not-started">{HELD_STATUS_LABEL.unevaluated} {s.held.unevaluated}</span>
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          달성 가능성 — 높음 {s.grades.high} · 중간 {s.grades.medium} · 낮음 {s.grades.low} · 미판정 {s.grades.unjudged} (사람 확정 {s.confirmed}건)
        </span>
      </div>
      {s.banner && s.bannerText && <div className="legacy-model-notice mb-2" role="alert"><p className="legacy-model-notice-text">{s.bannerText}</p></div>}
    </>
  );
}

export function CapabilityAttainabilityPanel({ projectId, compact, onOpen }: { projectId: string; compact?: boolean; onOpen?: () => void }) {
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [view, setView] = useState<View | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/capability-attainability`;

  const apply = useCallback((v: View) => {
    setView(v);
    setDrafts(Object.fromEntries(v.rows.map((r) => [r.id, toDraft(r)])));
    setDirty(new Set());
  }, []);

  useEffect(() => {
    let alive = true;
    api.get<View>(base).then((res) => { if (alive) apply(res.data); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "달성 가능성을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [base, apply]);

  const set = (id: string, patch: Partial<Draft>) => {
    setDrafts((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    setDirty((p) => new Set(p).add(id));
  };

  async function save() {
    if (!view || busy || dirty.size === 0) return;
    setBusy(true); setError(null);
    try {
      const rows = [...dirty].map((id) => {
        const d = drafts[id];
        return {
          id, requiredLevel: d.requiredLevel, currentLevel: d.currentLevel, resolution: d.resolution || null,
          closingCostKrwM: d.cost.trim() === "" ? null : Number(d.cost), monthsToAttain: d.months.trim() === "" ? null : Number(d.months),
          grade: d.grade || null, rationale: d.rationale,
        };
      });
      const res = await api.put<View>(base, { rows });
      apply(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<View>(`${base}/confirm`, {});
      apply(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "확정하지 못했습니다.");
    } finally { setBusy(false); }
  }

  if (error && !view) return <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성"><p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p></section>;
  if (!view) return <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성"><p className="text-[color:var(--muted-fg)]">불러오는 중…</p></section>;

  if (compact) {
    return (
      <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성 요약">
        <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
        <SummaryStrip s={view.summary} />
        {onOpen && <button type="button" className="text-[color:var(--accent)] font-bold" onClick={onOpen}>달성 가능성 판정 보기 →</button>}
      </section>
    );
  }

  const awaiting = view.summary.awaitingConfirmation;
  return (
    <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성">
      <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S3 필요 역량 레지스터의 필요 수준을 확보할 수 있는지 사람이 판정합니다. AI는 초안만 제안하며, 여기 입력한 비용·기간은 사업성 수치에 자동 반영되지 않습니다.
      </p>
      <SummaryStrip s={view.summary} />
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}
      {view.rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)]">S3 필요 역량 레지스터에 행이 없습니다. S3에서 필요 역량을 먼저 정리하세요.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table mb-2 table-fixed-pct tmin-64" aria-label="필요 역량 달성 가능성 표">
            <caption className="sr-only">필요 역량 달성 가능성</caption>
            <ColGroup widths={COL_PCT} />
            <thead>
              <tr>
                <th scope="col">필요 역량</th><th scope="col">필요 수준</th><th scope="col">보유 수준</th><th scope="col">해소 방식</th>
                <th scope="col">해소 비용(백만원)</th><th scope="col">달성 기간(개월)</th><th scope="col">달성 가능성</th>
                <th scope="col">근거·증빙</th><th scope="col">확정</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => {
                const d = drafts[r.id] ?? toDraft(r);
                return (
                  <tr key={r.id}>
                    <td className="text-[length:var(--fs-caption)]">
                      <span className="font-semibold">{r.capability}</span>
                      <span className={`status-chip ${HELD_STATUS_CHIP[r.held_status]} block`}>{HELD_STATUS_LABEL[r.held_status]}</span>
                      {r.level_gap !== null && <span className="block text-[color:var(--muted-fg)]">수준 차이 {r.level_gap}단계</span>}
                    </td>
                    <td><LevelSelect ariaLabel={`${r.capability} 필요 수준`} value={d.requiredLevel} disabled={!canAct} onChange={(v) => set(r.id, { requiredLevel: v })} /></td>
                    <td><LevelSelect ariaLabel={`${r.capability} 보유 수준`} value={d.currentLevel} disabled={!canAct} onChange={(v) => set(r.id, { currentLevel: v })} /></td>
                    <td>
                      <select aria-label={`${r.capability} 해소 방식`} value={d.resolution} disabled={!canAct} onChange={(e) => set(r.id, { resolution: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                        <option value="">미정</option>
                        {RESOLUTIONS.map((x) => <option key={x} value={x}>{RESOLUTION_LABEL[x]}</option>)}
                      </select>
                    </td>
                    <td><input type="number" min={0} aria-label={`${r.capability} 해소 비용(백만원)`} value={d.cost} disabled={!canAct} onChange={(e) => set(r.id, { cost: e.target.value })} className="sizing-new-input sizing-new-input-sm" /></td>
                    <td><input type="number" min={0} aria-label={`${r.capability} 달성 기간(개월)`} value={d.months} disabled={!canAct} onChange={(e) => set(r.id, { months: e.target.value })} className="sizing-new-input sizing-new-input-sm" /></td>
                    <td>
                      <select aria-label={`${r.capability} 달성 가능성`} value={d.grade} disabled={!canAct} onChange={(e) => set(r.id, { grade: e.target.value })} className="sizing-new-input sizing-new-input-sm mb-1">
                        {GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.text}</option>)}
                      </select>
                      {r.drafted_by === "ai" && <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">AI 초안</div>}
                    </td>
                    <td>
                      {(() => {
                        const txt = d.rationale.trim();
                        const missing = !txt && (d.grade === "high" || d.grade === "low");
                        return (
                          <>
                            <div className="text-[length:var(--fs-caption)] mb-1">
                              {txt ? <span>{txt.length > PREVIEW_LEN ? `${txt.slice(0, PREVIEW_LEN)}…` : txt}</span> : <span className="text-[color:var(--muted-fg)]">미입력</span>}
                              {missing && <span className="status-chip status-red block mt-1">✕ 근거 필수</span>}
                            </div>
                            <button type="button" className="btn-ghost btn-sm" aria-label={`${r.capability} 근거·증빙 ${canAct ? "입력" : "보기"}`} onClick={() => setEditing(r.id)}>
                              {canAct ? (txt ? "수정" : "입력") : "보기"}
                            </button>
                          </>
                        );
                      })()}
                      {r.evidence.length > 0 && (
                        <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                          기존 증빙
                          <ul className="m-0 pl-4">{r.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul>
                        </div>
                      )}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {r.confirmed_at ? <>확정<span className="block text-[color:var(--muted-fg)]">{r.confirmed_by} · {r.confirmed_at.slice(0, 10)}</span></> : r.grade ? "확정 전" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (() => {
        const row = view.rows.find((x) => x.id === editing);
        if (!row) return null;
        return <RationaleDialog capability={row.capability} initial={(drafts[row.id] ?? toDraft(row)).rationale} readOnly={!canAct}
          onSave={(t) => { set(row.id, { rationale: t }); setEditing(null); }} onClose={() => setEditing(null)} />;
      })()}
      {canAct && view.rows.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={busy || dirty.size === 0} onClick={() => void save()}>초안 저장</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || dirty.size > 0 || awaiting === 0} onClick={() => void confirm()}>
            판정 확정{awaiting > 0 ? ` (${awaiting}건)` : ""}
          </button>
          {dirty.size > 0 && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] self-center">저장하지 않은 변경이 있습니다 — 저장 후 확정할 수 있습니다.</span>}
        </div>
      )}
    </section>
  );
}
