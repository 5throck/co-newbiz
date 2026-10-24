"use client";

// Wave C-3 (pilot-009 D-6): manual S1 competitive-structure input. Saves a new
// analysis version whose matrix.competitive is what the S1 predicate reads.
import { useState } from "react";
import { api } from "../../../lib/api.ts";
import { useTranslations } from "next-intl";

interface PlayerDraft { name: string; share_pct: string; note: string }
const EMPTY: PlayerDraft = { name: "", share_pct: "", note: "" };

export function CompetitiveInputForm({ analysisId }: { analysisId: string }) {const t = useTranslations("stages.s1.competitiveInputForm"); const tc = useTranslations("common");
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
      setError(err instanceof Error ? err.message : t("failedToSaveTheCompetitive"));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" className="btn-ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("enterCompetitiveStructureDirectly")}
      </button>
      {open && (
        <form onSubmit={save} className="sizing-new-form mt-2" aria-label={t("enterCompetitiveStructureDirectly2")}>
          <label className="block text-[length:var(--fs-caption)] mb-2">
            <span className="block mb-1">{t("concentrationSummary")}</span>
            <textarea value={structure} onChange={(e) => setStructure(e.target.value)} required rows={2} className="sizing-new-input w-full" />
          </label>
          {players.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 mb-1">
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{t("keyCompanies")} {i + 1}</span>
                <input value={p.name} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="sizing-new-input sizing-new-input-sm" />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{t("share")}</span>
                <input type="number" min={0} max={100} value={p.share_pct} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, share_pct: e.target.value } : x)))} className="sizing-new-input sizing-new-input-sm" />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{t("evidenceAndNotes")}</span>
                <input value={p.note} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} className="sizing-new-input" />
              </label>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setPlayers([...players, { ...EMPTY }])}>{t("addCompany")}</button>
          {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
          <div className="mt-2">
            <button type="submit" className="btn-ghost" disabled={busy || !structure.trim() || filled.length === 0}>
              {busy ? tc("saving") : t("saveCompetitiveStructure")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
