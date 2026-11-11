"use client";

// Deal-board client-request intake modal (ADR-0197; design
// 2026-11-11-owner-decisions-intake-batch §3.5). Both board CTAs open this
// modal instead of navigating directly: source derives from WHICH CTA opened
// it (asking the user to re-state what they clicked is friction with zero
// information gain), the requester and note are optional, and Cancel closes
// with nothing written. There is deliberately no "skip recording" — creating
// the record IS the ruling (DEC-20261111-03 ruling 1). Submit creates the
// intake row and rides the original destination's query-carrier exemption as
// &intake=<id>; CarrierGate exemptions are untouched (the stages read the
// intake themselves).
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { api } from "../lib/api.ts";
import { useModalFocus } from "../lib/use-modal-focus.ts";

export type DealIntakeSource = "board_new_deal" | "board_known_target";

/** The original board-CTA destination each source rides (the exemption paths). */
const DESTINATION_BY_SOURCE: Record<DealIntakeSource, string> = {
  board_new_deal: "/market?new=1",
  board_known_target: "/opportunities?known_target=1",
};

export function DealIntakeModal({ source, onClose }: { source: DealIntakeSource; onClose: () => void }) {
  const t = useTranslations("pages.deals.intakeModal");
  const uid = useId();
  const [requester, setRequester] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { panelRef, onKeyDown } = useModalFocus(onClose);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>("/api/deal-intake", {
        source,
        requested_by: requester.trim() || undefined,
        note: note.trim() || undefined,
      });
      // Plain assign (same as OpportunityFunnelStage) — these exemption paths
      // have no redirect race, and the intake carrier survives as &intake=<id>.
      window.location.assign(`${DESTINATION_BY_SOURCE[source]}&intake=${encodeURIComponent(created.data.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setBusy(false);
    }
  }

  const titleId = `${uid}-title`;
  const errId = `${uid}-error`;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: modal-backdrop pattern shared with crud.tsx (Esc/Tab handled by useModalFocus)
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click only stops propagation to the backdrop; keyboard handled on the backdrop */}
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: "30rem", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId} style={{ fontSize: "0.95rem" }}>
            {t("title")}
          </h2>
        </div>
        <form onSubmit={submit} aria-label={t("title")}>
          <label className="block text-[length:var(--fs-caption)] mb-2" htmlFor={`${uid}-requester`}>
            <span className="block mb-1">{t("requester")}</span>
            <input
              id={`${uid}-requester`}
              type="text"
              value={requester}
              onChange={(e) => setRequester(e.target.value)}
              maxLength={120}
              className="sizing-new-input w-full"
            />
          </label>
          <label className="block text-[length:var(--fs-caption)] mb-2" htmlFor={`${uid}-note`}>
            <span className="block mb-1">{t("note")}</span>
            <textarea
              id={`${uid}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              className="sizing-new-input w-full"
            />
          </label>
          {error && (
            <p id={errId} role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 justify-end flex-wrap">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose} style={{ minHeight: "2.75rem" }}>
              {t("cancel")}
            </button>
            <button type="submit" className="btn-premium btn-sm" disabled={busy} style={{ minHeight: "2.75rem" }}>
              {t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
