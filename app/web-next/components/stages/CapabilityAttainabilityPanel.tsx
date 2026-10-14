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
import { CapabilityHeldDialog, evidencePreview, holdersPreview } from "./CapabilityHeldDialog.tsx";
import { ATTAINABILITY_GRADE_LABEL, HELD_STATUS_CHIP, HELD_STATUS_LABEL, RESOLUTION_LABEL, type GapResolution } from "../../lib/capability-gap.ts";
import type { AttainabilityRowView, AttainabilitySummary } from "../../lib/capability-attainability.ts";
import type { RemovedCapability } from "../../lib/capability-gap.ts";

interface View {
  opportunity_id: string | null;
  stored: boolean;
  rows: AttainabilityRowView[];
  summary: AttainabilitySummary;
  removed_capabilities?: RemovedCapability[];
}

// ADR-0170: required/current level, held judgement, holders and evidence are S3-owned and
// read-only here; the draft carries only what S8 owns (resolution + attainability).
interface Draft {
  resolution: string;
  cost: string; months: string; grade: string; rationale: string;
}

const COL_PCT = [16, 18, 18, 8, 8, 8, 10, 10, 4] as const;
const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
const GRADE_OPTIONS = [
  { value: "", text: "미판정" }, { value: "high", text: "높음" },
  { value: "medium", text: "중간" }, { value: "low", text: "낮음" },
] as const;

const toDraft = (r: AttainabilityRowView): Draft => ({
  resolution: r.resolution ?? "",
  cost: r.closing_cost_krw_m === null ? "" : String(r.closing_cost_krw_m),
  months: r.months_to_attain === null ? "" : String(r.months_to_attain),
  grade: r.grade ?? "", rationale: r.rationale,
});

const levelText = (v: string) => (v.trim() === "" ? "미정" : v);
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
        {s.stale > 0 && <span className="status-chip status-amber"><span aria-hidden="true">!</span> 재판정 필요 {s.stale}</span>}
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
  const [heldViewing, setHeldViewing] = useState<string | null>(null);
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
        // Only S8-owned fields go out, plus the S3 hash this page was showing so the server
        // can tell if S3 changed meanwhile (S3 values themselves are never sent).
        return {
          id, s3Hash: view.rows.find((x) => x.id === id)?.s3_hash, resolution: d.resolution || null,
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

  const s3Href = `/deals/${encodeURIComponent(view.opportunity_id ?? "")}/s3`;
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
  const removed = view.removed_capabilities ?? [];
  return (
    <section className="market-section sizing-step mb-3" aria-label="필요 역량 달성 가능성">
      <h3 className="sizing-step-title">필요 역량 달성 가능성</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S3 필요 역량 레지스터의 필요 내용을 확보할 수 있는지 사람이 판정합니다. AI는 초안만 제안하며, 여기 입력한 비용·기간은 사업성 수치에 자동 반영되지 않습니다.
        필요 내용·보유 판정·보유 주체·근거는 S3에서 정의한 값이며 여기서는 읽기 전용입니다{view.opportunity_id ? <> — <a href={s3Href} className="text-[color:var(--accent)] underline">S3에서 수정</a></> : ""}.
        S3 내용이 바뀐 행은 재판정이 필요하며, 이전 판정은 이력으로 남습니다.
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
                <th scope="col">필요 역량</th><th scope="col">필요 내용 (S3)</th><th scope="col">보유 판정 (S3)</th><th scope="col">해소 방식</th>
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
                      {(r.required_level.trim() !== "" || r.current_level.trim() !== "") && (
                        <span className="block text-[color:var(--muted-fg)]">S5 수준: 필요 {levelText(r.required_level)} / 보유 {levelText(r.current_level)}</span>
                      )}
                      {r.stale && (
                        <div className="mt-1" role="status">
                          <span className="status-chip status-amber"><span aria-hidden="true">!</span> S3 변경 — 재판정 필요</span>
                          {r.s3_changes.length > 0 ? (
                            <ul className="m-0 pl-4 text-[color:var(--muted-fg)]">
                              {r.s3_changes.map((c) => <li key={c.field}>{c.label}: {c.before} → {c.after}</li>)}
                            </ul>
                          ) : <span className="block text-[color:var(--muted-fg)]">변경 내용: S3 항목이 바뀌었습니다(상세 비교 없음).</span>}
                          <span className="block text-[color:var(--muted-fg)]">
                            이전 판정 {r.grade_label}{r.rationale ? ` — ${r.rationale.length > PREVIEW_LEN ? `${r.rationale.slice(0, PREVIEW_LEN)}…` : r.rationale}` : ""} (아래 값에 그대로 채워 두었습니다)
                          </span>
                          {canAct && <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${r.capability} 이전 판정으로 재판정`} onClick={() => set(r.id, {})}>이전 판정 그대로 재판정</button>}
                        </div>
                      )}
                      {!r.stale && r.prior && (
                        <span className="block text-[color:var(--muted-fg)]">
                          이전 판정: {r.prior.grade ? ATTAINABILITY_GRADE_LABEL[r.prior.grade] : "미판정"}{r.prior.confirmedBy ? ` (확정 ${r.prior.confirmedBy}, ${(r.prior.confirmedAt ?? "").slice(0, 10)})` : ""} · {r.prior.invalidatedAt.slice(0, 10)} S3 변경으로 무효화
                        </span>
                      )}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      <span className="block whitespace-pre-wrap break-words">{r.required_note.trim() ? r.required_note : <span className="text-[color:var(--muted-fg)]">미입력</span>}</span>
                      <a href={s3Href} className="block text-[color:var(--accent)] underline" aria-label={`${r.capability} 필요 내용은 S3에서 수정`}>S3에서 수정</a>
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      <span className={`status-chip ${HELD_STATUS_CHIP[r.held_status]}`}>{HELD_STATUS_LABEL[r.held_status]}</span>
                      <span className="block mt-1"><span className="text-[color:var(--muted-fg)]">주체</span> {holdersPreview(r.held_holders)}</span>
                      <span className="block"><span className="text-[color:var(--muted-fg)]">근거</span> {evidencePreview(r.held_evidence)}</span>
                      <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${r.capability} S3 보유 판정 보기`} onClick={() => setHeldViewing(r.id)}>보기</button>
                      <a href={s3Href} className="block text-[color:var(--accent)] underline" aria-label={`${r.capability} 보유 판정은 S3에서 수정`}>S3에서 수정</a>
                    </td>
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
      {heldViewing && (() => {
        const row = view.rows.find((x) => x.id === heldViewing);
        if (!row) return null;
        return <CapabilityHeldDialog capability={row.capability} holders={row.held_holders} evidence={row.held_evidence} readOnly onClose={() => setHeldViewing(null)} />;
      })()}
      {removed.length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-[length:var(--fs-caption)]">삭제된 역량 (판정 이력) {removed.length}건</summary>
          <ul className="m-0 pl-4 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {removed.map((x, i) => (
              <li key={`${x.rowId}-${i}`}>
                {x.capability} — 필요 {levelText(x.requiredLevel)} / 보유 {levelText(x.currentLevel)}, 마지막 판정 {x.attainability?.grade ? ATTAINABILITY_GRADE_LABEL[x.attainability.grade] : "미판정"}{x.attainability?.confirmedBy ? ` (확정 ${x.attainability.confirmedBy})` : ""} · {x.removedAt.slice(0, 10)} S3에서 삭제({x.removedBy})
              </li>
            ))}
          </ul>
        </details>
      )}
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
