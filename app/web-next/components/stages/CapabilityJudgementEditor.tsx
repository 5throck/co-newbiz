"use client";

// Required-capability judgement edit surface (ADR-0171 / ADR-0172). Mounted on S5 (Green Field);
// the S8 summary reuses it only as a temporary Brown Field bridge until the S7 per-target
// surface ships (slice 2b). Saves drafts (analyst+; AI may only draft) and confirms through a
// human-only route. Numbers are NOT pushed into the case model; S3-owned values are never sent.
// Optional `gap` wiring lets S5 keep saving its free-text 비고 through the S3 register route
// (which also carries 해소 방식, so a judgement save refreshes those rows locally).
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import type { CapabilityGapRow } from "../../lib/capability-gap.ts";
import {
  CapabilityJudgementTable, RemovedCapabilities, SummaryStrip, judgementPatch, toJudgementDraft,
  type AttainabilityViewData, type JudgementDraft,
} from "./CapabilityJudgementTable.tsx";

export interface GapWiring {
  opportunityId: string;
  rows: CapabilityGapRow[];
  setRows: Dispatch<SetStateAction<CapabilityGapRow[]>>;
}

export function CapabilityJudgementEditor({ endpoint, s3Href, gap, intro }: {
  /** Base URL of the judgement routes: GET/PUT here, POST `${endpoint}/confirm`. */
  endpoint: string;
  s3Href: string;
  gap?: GapWiring;
  intro?: string;
}) {
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [view, setView] = useState<AttainabilityViewData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, JudgementDraft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [notesDirty, setNotesDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setGapRows = gap?.setRows;

  const apply = useCallback((v: AttainabilityViewData) => {
    setView(v);
    setDrafts(Object.fromEntries(v.rows.map((r) => [r.id, toJudgementDraft(r)])));
    setDirty(new Set());
    // The S3 register route rewrites rows as the client holds them, so keep its copy of the
    // judgement-owned 해소 방식 in step with what the server just stored.
    const byId = new Map(v.rows.map((r) => [r.id, r.resolution]));
    setGapRows?.((prev) => prev.map((g) => (byId.has(g.id) ? { ...g, resolution: byId.get(g.id) ?? null } : g)));
  }, [setGapRows]);

  useEffect(() => {
    let alive = true;
    api.get<AttainabilityViewData>(endpoint).then((res) => { if (alive) apply(res.data); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "달성 가능성을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [endpoint, apply]);

  const set = (id: string, patch: Partial<JudgementDraft>) => {
    setDrafts((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    setDirty((p) => new Set(p).add(id));
  };

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
      apply({ ...res.data, edit_at: view?.edit_at, track: view?.track });
    } catch (e) {
      setError(e instanceof Error ? e.message : "확정하지 못했습니다.");
    } finally { setBusy(false); }
  }

  if (error && !view) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p>;
  if (!view) return <p className="text-[color:var(--muted-fg)]">불러오는 중…</p>;

  const awaiting = view.summary.awaitingConfirmation;
  const noteMap = gap ? new Map(gap.rows.map((g) => [g.id, g.note])) : null;
  return (
    <div aria-label="필요 역량 달성 가능성 판정">
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {intro ?? "S3에서 정의한 필요 역량을 확보할 수 있는지 사람이 판정합니다. AI는 초안만 제안하며, 여기 입력한 비용·기간은 사업성 수치에 자동 반영되지 않습니다."}{" "}
        필요도·필요 수준·보유 판정·보유 수준·보유 근거는 S3에서 정의한 값이며 여기서는 읽기 전용입니다 — <a href={s3Href} className="text-[color:var(--accent)] underline">S3에서 수정</a>.
        S3 내용이 바뀐 행은 재판정이 필요하며, 이전 판정은 이력으로 남습니다.
      </p>
      <SummaryStrip s={view.summary} />
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}
      {view.rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)]">S3 필요 역량 레지스터에 행이 없습니다. S3에서 필요 역량을 먼저 정리하세요.</p>
      ) : (
        <CapabilityJudgementTable rows={view.rows} drafts={drafts} editable={canAct} onSet={set} s3Href={s3Href}
          note={noteMap ? { value: (id) => noteMap.get(id) ?? "", onChange: (id, v) => { gap!.setRows((prev) => prev.map((g) => (g.id === id ? { ...g, note: v } : g))); setNotesDirty(true); } } : undefined} />
      )}
      <RemovedCapabilities removed={view.removed_capabilities ?? []} />
      {canAct && view.rows.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={busy || (dirty.size === 0 && !notesDirty)} onClick={() => void save()}>초안 저장</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || dirty.size > 0 || notesDirty || awaiting === 0} onClick={() => void confirm()}>
            판정 확정{awaiting > 0 ? ` (${awaiting}건)` : ""}
          </button>
          {(dirty.size > 0 || notesDirty) && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] self-center">저장하지 않은 변경이 있습니다 — 저장 후 확정할 수 있습니다.</span>}
        </div>
      )}
    </div>
  );
}
