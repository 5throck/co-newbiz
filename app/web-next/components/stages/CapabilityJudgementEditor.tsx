"use client";

// Required-capability judgement edit surface (ADR-0171 / ADR-0172). Mounted on S5 (Green Field) and,
// per shortlisted target, on S7 (Brown Field; components/brownfield-target/TargetCapabilityCheck.tsx
// with `endpoint` = /api/brownfield/targets/{id}/capability-judgements). Saves drafts (analyst+; AI may only draft) and confirms through a
// human-only route. Numbers are NOT pushed into the case model; S3-owned values are never sent.
// Optional `gap` wiring lets S5 keep saving its free-text 비고 through the S3 register route
// (which also carries 해소 방식, so a judgement save refreshes those rows locally).
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import type { CapabilityGapRow } from "../../lib/capability-gap.ts";
import { JUDGEMENT_ROW_CAP, mergeJudgementProposals, type AiMarks, type JudgementField, type JudgementProposal } from "../../lib/capability-judgement-ai-merge.ts";
import {
  CapabilityJudgementTable, RemovedCapabilities, SummaryStrip, judgementPatch, toJudgementDraft,
  type AiDraftResponse, type AiWiring, type AttainabilityViewData, type JudgementDraft,
} from "./CapabilityJudgementTable.tsx";

export interface GapWiring {
  opportunityId: string;
  rows: CapabilityGapRow[];
  setRows: Dispatch<SetStateAction<CapabilityGapRow[]>>;
}

export function CapabilityJudgementEditor({ endpoint, s3Href, gap, intro, aiDraft = false, onRowsChange, onEditorApi, onDirtyChange, refreshKey, startYearFor, onStartYearChange }: {
  /** Base URL of the judgement routes: GET/PUT here, POST `${endpoint}/confirm`. */
  endpoint: string;
  s3Href: string;
  gap?: GapWiring;
  intro?: string;
  /** S5 only (ADR-0171 amendment 2026-10-15): show "판정 제안 (AI)"; proposals fill empty draft fields, a person saves and confirms. */
  aiDraft?: boolean;
  /** ADR-0173: called with the SAVED server rows whenever the view (re)loads, so S5 can derive capability cost lines. */
  onRowsChange?: (rows: AttainabilityViewData["rows"]) => void;
  /** ADR-0173 amendment 2026-10-15: exposes patchDraft so the investment table's 분류 select can write the category into the row's judgement draft (marks it dirty; saved through the existing S5 judgement PUT). */
  onEditorApi?: (api: { patchDraft: (id: string, p: Partial<JudgementDraft>) => void; /** 투자비 저장 전 판정 PUT flush (2026-10-18 decider ask — 표의 분류/주기 변경을 판정에 반영). */ saveDirty: () => Promise<void> }) => void;
  /** Presentation only: reports whether the editor holds unsaved judgement drafts or notes (page-level unsaved indicator). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Change it to refetch the view (e.g. after the S7 criterion verdict or the criteria reconcile changed); unsaved drafts are kept. */
  refreshKey?: string | number;
  /** 2026-10-18 decider ask — threaded to the judgement dialog's editable 시작 연차 (cost-entry start-year override). */
  startYearFor?: (id: string) => number | null;
  onStartYearChange?: (id: string, v: number | null) => void;
}) {
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [view, setView] = useState<AttainabilityViewData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, JudgementDraft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [notesDirty, setNotesDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiMarks, setAiMarks] = useState<AiMarks>({});
  const [aiBasis, setAiBasis] = useState<Record<string, JudgementProposal["basis"]>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const setGapRows = gap?.setRows;
  useEffect(() => { if (view) onRowsChange?.(view.rows); }, [view, onRowsChange]);
  // Latest committed state for the async AI merge and the refetch guard (a refetch never wipes unsaved drafts).
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;

  const apply = useCallback((v: AttainabilityViewData, resetAll = true) => {
    setView(v);
    const keep = resetAll ? new Set<string>() : dirtyRef.current;
    setDrafts(Object.fromEntries(v.rows.map((r) => [r.id, keep.has(r.id) && draftsRef.current[r.id] ? draftsRef.current[r.id] : toJudgementDraft(r)])));
    setDirty(new Set([...keep].filter((id) => v.rows.some((r) => r.id === id))));
    if (resetAll) { setAiMarks({}); setAiBasis({}); }
    // The S3 register route rewrites rows as the client holds them, so keep its copy of the
    // judgement-owned 해소 방식 in step with what the server just stored.
    const byId = new Map(v.rows.map((r) => [r.id, r.resolution]));
    setGapRows?.((prev) => prev.map((g) => (byId.has(g.id) ? { ...g, resolution: byId.get(g.id) ?? null } : g)));
  }, [setGapRows]);

  useEffect(() => {
    let alive = true;
    api.get<AttainabilityViewData>(endpoint).then((res) => { if (alive) apply(res.data, dirtyRef.current.size === 0); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "달성 가능성을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [endpoint, apply, refreshKey]);

  const set = (id: string, patch: Partial<JudgementDraft>) => {
    // A human edit of an AI-drafted field clears its AI marker (only fields whose value actually changed).
    const before = draftsRef.current[id];
    const changed = (Object.keys(patch) as Array<keyof JudgementDraft>).filter((k) => before && patch[k] !== before[k]);
    if (changed.length > 0) {
      setAiMarks((m) => {
        const left = (m[id] ?? []).filter((f) => !(changed as string[]).includes(f));
        const { [id]: _drop, ...rest } = m;
        return left.length > 0 ? { ...rest, [id]: left } : rest;
      });
    }
    setDrafts((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    setDirty((p) => new Set(p).add(id));
  };
  // ADR-0173 amendment 2026-10-15: hand the patch API to the parent each render (set is recreated per render).
  useEffect(() => { onEditorApi?.({ patchDraft: set, saveDirty: () => save() }); });
  const unsavedNow = dirty.size > 0 || notesDirty;
  useEffect(() => { onDirtyChange?.(unsavedNow); }, [unsavedNow, onDirtyChange]);

  const fetchProposals = useCallback(async (rowIds: string[]): Promise<AiDraftResponse> => {
    const res = await api.post<AiDraftResponse>(`${endpoint}/ai-draft`, { rowIds });
    return res.data;
  }, [endpoint]);

  const markFields = useCallback((id: string, fields: JudgementField[], basis?: JudgementProposal["basis"]) => {
    setAiMarks((m) => ({ ...m, [id]: [...new Set([...(m[id] ?? []), ...fields])] }));
    if (basis) setAiBasis((b) => ({ ...b, [id]: basis }));
  }, []);

  /** Rows that still need judgement on the page: stale, ungraded, or lacking 해소 방식 / 기대 수준 (as drafted). */
  function judgementTargets(): string[] {
    if (!view) return [];
    return view.rows
      .filter((r) => { const d = drafts[r.id] ?? toJudgementDraft(r); return r.stale || !d.grade || !d.resolution || !d.expectedLevel.trim(); })
      .map((r) => r.id);
  }

  async function proposeAll() {
    if (!view || busy || aiBusy) return;
    const all = judgementTargets();
    const ids = all.slice(0, JUDGEMENT_ROW_CAP);
    if (ids.length === 0) { setAiNote("제안할 행이 없습니다 — 모든 행에 해소 방식·기대 수준·달성 가능성이 있습니다."); return; }
    setAiBusy(true); setError(null); setAiNote(null);
    try {
      const res = await fetchProposals(ids);
      const m = mergeJudgementProposals(draftsRef.current, res.drafts);
      setDrafts(m.drafts);
      setDirty((p) => new Set([...p, ...Object.keys(m.marks)]));
      setAiMarks((prev) => { const next = { ...prev }; for (const [id, f] of Object.entries(m.marks)) next[id] = [...new Set([...(next[id] ?? []), ...f])]; return next; });
      setAiBasis((prev) => ({ ...prev, ...Object.fromEntries(Object.keys(m.marks).map((id) => [id, res.drafts[id].basis])) }));
      const more = all.length - ids.length;
      const unfilledText = Object.entries(res.unfilled).slice(0, 3).map(([id, why]) => `${view.rows.find((r) => r.id === id)?.capability ?? id}: ${why}`).join(" / ");
      setAiNote([res.note, m.applied === 0 ? "반영된 칸이 없습니다(채울 빈 칸이 없거나 근거 부족)." : `${Object.keys(m.marks).length}개 행에 ${m.applied}칸을 AI 초안으로 채웠습니다.`, unfilledText ? `비운 칸 — ${unfilledText}` : "", more > 0 ? `${more}개 행은 한 번에 ${JUDGEMENT_ROW_CAP}개까지라 다음 제안에서 처리합니다.` : ""].filter(Boolean).join(" "));
    } catch (e) {
      setAiNote(`판정 제안에 실패했습니다 — ${e instanceof Error ? e.message : "원인을 알 수 없음"}. 다시 시도하세요.`);
    } finally { setAiBusy(false); }
  }

  function discardAi() {
    if (!view) return;
    const next = { ...draftsRef.current };
    const dirtyNext = new Set(dirtyRef.current);
    for (const [id, fields] of Object.entries(aiMarks)) {
      const base = toJudgementDraft(view.rows.find((r) => r.id === id)!);
      const d = { ...next[id] };
      for (const f of fields) (d as Record<string, string>)[f] = (base as unknown as Record<string, string>)[f];
      next[id] = d;
      if (JSON.stringify(d) === JSON.stringify(base)) dirtyNext.delete(id);
    }
    setDrafts(next); setDirty(dirtyNext); setAiMarks({}); setAiBasis({}); setAiNote(null);
  }

  async function save() {
    if (!view || busy || (dirty.size === 0 && !notesDirty)) return;
    setBusy(true); setError(null);
    try {
      // 비고 first (S3 register route, rows as loaded), then the judgement merge onto the live register.
      if (gap && notesDirty) {
        const res = await api.put<{ rows: CapabilityGapRow[] }>(`/api/opportunities/${encodeURIComponent(gap.opportunityId)}/capability-gap`, { rows: gap.rows });
        gap.setRows(res.data.rows);
        setNotesDirty(false);
      }
      if (dirty.size > 0) {
        const rows = [...dirty].map((id) => judgementPatch(id, drafts[id], view.rows.find((x) => x.id === id)?.s3_hash));
        const res = await api.put<AttainabilityViewData>(endpoint, { rows });
        apply({ ...res.data, edit_at: view.edit_at, track: view.track });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<AttainabilityViewData>(`${endpoint}/confirm`, {});
      apply({ ...res.data, edit_at: view?.edit_at, track: view?.track }, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "확정하지 못했습니다.");
    } finally { setBusy(false); }
  }

  const aiWiring: AiWiring | undefined = aiDraft && canAct ? { marks: aiMarks, basis: aiBasis, busy: aiBusy || busy, fetchProposals, markFields } : undefined;
  const aiRowCount = Object.keys(aiMarks).length;

  if (error && !view) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p>;
  if (!view) return <p className="text-[color:var(--muted-fg)]">불러오는 중…</p>;

  const awaiting = view.summary.awaitingConfirmation;
  const noteMap = gap ? new Map(gap.rows.map((g) => [g.id, g.note])) : null;
  const unsaved = dirty.size > 0 || notesDirty;
  return (
    <div aria-label="필요 역량 달성 가능성 판정">
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {intro ?? "S3에서 정의한 필요 역량을 확보할 수 있는지 사람이 판정합니다 — 행의 판정 버튼에서 입력하고, AI 초안은 제안일 뿐입니다."}{" "}
        <a href={s3Href} className="text-[color:var(--accent)] underline">S3에서 수정</a>
      </p>
      <SummaryStrip s={view.summary} />
      <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
        {canAct && view.rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="judgement-actions">
            {unsaved && <span className="status-chip status-amber" role="status"><span aria-hidden="true">!</span> 저장하지 않은 변경</span>}
            {aiRowCount > 0 && (
              <span className="flex items-center gap-1" data-testid="ai-unsaved">
                <span className="status-chip status-not-started" role="status"><span aria-hidden="true">✦</span> 저장하지 않은 AI 초안 {aiRowCount}건</span>
                <button type="button" className="btn-ghost btn-sm" disabled={busy || aiBusy} onClick={discardAi}>초안 버리기 (AI)</button>
              </span>
            )}
            {aiWiring && (
              <button type="button" className="btn-ghost btn-sm" disabled={busy || aiBusy} onClick={() => void proposeAll()}
                title="AI가 판정이 필요한 행의 빈 칸(해소 방식·기대 수준·비용·기간·달성 가능성·근거)을 초안으로 제안합니다 — 제안일 뿐이며 저장·확정은 사람이 합니다. 외부 웹 검색은 쓰지 않습니다.">
                {aiBusy ? "제안 중…" : "판정 제안 (AI)"}
              </button>
            )}
            <button type="button" className={unsaved ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={busy || aiBusy || !unsaved} onClick={() => void save()}>초안 저장</button>
            <button type="button" className="btn-ghost btn-sm" disabled={busy || unsaved || awaiting === 0} title={unsaved ? "저장 후 확정할 수 있습니다." : undefined} onClick={() => void confirm()}>
              판정 확정{awaiting > 0 ? ` (${awaiting}건)` : ""}
            </button>
          </div>
        )}
      </div>
      {aiNote && (
        <div className="legacy-model-notice mb-2 flex items-start justify-between gap-2" role="status" data-testid="ai-note">
          <p className="legacy-model-notice-text">{aiNote}</p>
          <button type="button" className="btn-ghost btn-sm" aria-label="AI 제안 결과 닫기" onClick={() => setAiNote(null)}>닫기</button>
        </div>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}
      {view.rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)]">S3 필요 역량 레지스터에 행이 없습니다. S3에서 필요 역량을 먼저 정리하세요.</p>
      ) : (
        <CapabilityJudgementTable rows={view.rows} drafts={drafts} editable={canAct} onSet={set} s3Href={s3Href} dirty={dirty} ai={aiWiring}
          note={noteMap ? { value: (id) => noteMap.get(id) ?? "", onChange: (id, v) => { gap!.setRows((prev) => prev.map((g) => (g.id === id ? { ...g, note: v } : g))); setNotesDirty(true); } } : undefined}  startYearFor={startYearFor} onStartYearChange={onStartYearChange} />
      )}
      <RemovedCapabilities removed={view.removed_capabilities ?? []} />
    </div>
  );
}
