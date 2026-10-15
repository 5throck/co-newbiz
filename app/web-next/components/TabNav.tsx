// Shared in-page tab bar — formalizes the `.tab-nav` pattern first hand-rolled
// in app/projects/[id]/dd/page.tsx (design-guide.md Component Standard table:
// "Tabs | .tab-nav / .stage-stepper"). Distinct from components/ui.tsx's
// `Tabs` (URL-synced, anchor-based `.tabs`/`.tab` markup) — this one is for
// in-page (non-navigational) tab panels with page-local active-tab state.
import { useCallback } from "react";

export interface TabNavItem {
  key: string;
  label: string;
  count?: number;
  /** Optional DOM id of the tab button (pairs with the panel's aria-labelledby). */
  id?: string;
  /** Optional id of the controlled panel (aria-controls). */
  panelId?: string;
  /** Optional status marker rendered after the label (icon + text, never colour-only). */
  marker?: React.ReactNode;
}

export function TabNav({
  tabs,
  active,
  onSelect,
  label,
  className,
}: {
  tabs: TabNavItem[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
  className?: string;
}) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      onSelect(next.key);
    },
    [tabs, onSelect],
  );

  return (
    <div className={`tab-nav${className ? ` ${className}` : ""}`} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          id={t.id}
          aria-controls={t.panelId}
          type="button"
          className="tab-nav-item"
          role="tab"
          aria-current={t.key === active}
          aria-selected={t.key === active}
          onClick={() => onSelect(t.key)}
          onKeyDown={(e) => handleKeyDown(e, i)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="library-tab-count">{t.count}</span>}
          {t.marker}
        </button>
      ))}
    </div>
  );
}
