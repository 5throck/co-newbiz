"use client";

// Wave C-3 (pilot-009 D-6): manual S1 competitive-structure input. Saves a new
// analysis version whose matrix.competitive is what the S1 predicate reads.
import { useState } from "react";
import { api } from "../../../lib/api.ts";

interface PlayerDraft { name: string; share_pct: string; note: string }
const EMPTY: PlayerDraft = { name: "", share_pct: "", note: "" };

export function CompetitiveInputForm({ analysisId }: { analysisId: string }) {
  const [open, setOpen] = useState(false);
  const [structure, setStructure] = useState("");
  const [players, setPlayers] = useState<PlayerDraft[]>([{ ...EMPTY }, { ...EMPTY }, { ...EMPTY }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = players.filter((p) => p.name.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}/competitive`, {
        structure,
        players: filled.map((p, i) => ({
          name: p.name.trim(),
          tier: i === 0 ? "leader" : "challenger",
          share_pct: p.share_pct ? Number(p.share_pct) : undefined,
          note: p.note.trim() || undefined,
        })),
      });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "경쟁 구조 저장 실패");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" className="btn-ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ＋ 경쟁 구조 직접 입력
      </button>
      {open && (
        <form onSubmit={save} className="sizing-new-form mt-2" aria-label="경쟁 구조 직접 입력">
          <label className="block text-[length:var(--fs-caption)] mb-2">
            <span className="block mb-1">집중도 요약 *</span>
            <textarea value={structure} onChange={(e) => setStructure(e.target.value)} required rows={2} className="sizing-new-input w-full" />
          </label>
          {players.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 mb-1">
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">주요 기업 {i + 1}</span>
                <input value={p.name} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="sizing-new-input sizing-new-input-sm" />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">점유율(%)</span>
                <input type="number" min={0} max={100} value={p.share_pct} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, share_pct: e.target.value } : x)))} className="sizing-new-input sizing-new-input-sm" />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">근거·비고</span>
                <input value={p.note} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} className="sizing-new-input" />
              </label>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setPlayers([...players, { ...EMPTY }])}>＋ 기업 추가</button>
          {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
          <div className="mt-2">
            <button type="submit" className="btn-ghost" disabled={busy || !structure.trim() || filled.length === 0}>
              {busy ? "저장 중..." : "경쟁 구조 저장"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
