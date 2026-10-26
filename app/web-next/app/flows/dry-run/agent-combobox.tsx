"use client";

// AgentCombobox — local ARIA 1.2 combobox (editable, list autocomplete) for the 40+ agent roster, grouped by
// domain (2026-10-26 dry-run UX design §5). Design-system ruling 2026-10-26: not catalogued (single
// consumer, roster-bound props; see design-components.md), so it stays local to the dry-run screens. Composed from existing input / menu styling (no new tokens).
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { BlueprintAgent } from "../flows-view-lib.ts";
import { agentGroupOf, groupAgents, type AgentDomainGroup } from "./dry-run-ui-lib.ts";

interface Flat {
  /** "" = the "unchanged" entry. */
  value: string;
  label: string;
  id: string;
}

export function AgentCombobox({
  agents,
  value,
  onChange,
  unchangedLabel,
  disabled,
}: {
  agents: BlueprintAgent[];
  value: string;
  onChange: (key: string) => void;
  /** Label of the leading "keep the current agent" entry (value ""). */
  unchangedLabel: string;
  disabled?: boolean;
}) {
  const t = useTranslations("pages.flows.dryRunSession");
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const groupLabel = (g: AgentDomainGroup): string => {
    switch (g) {
      case "functional": return t("agentGroupFunctional");
      case "technical": return t("agentGroupTechnical");
      case "industry": return t("agentGroupIndustry");
      case "region": return t("agentGroupRegion");
      default: return t("agentGroupOther");
    }
  };
  const groups = useMemo(() => groupAgents(agents, query), [agents, query]);
  // Flat option list in render order; the "unchanged" entry leads when the filter is empty.
  const flat: Flat[] = useMemo(() => {
    const out: Flat[] = [];
    if (query.trim() === "") out.push({ value: "", label: unchangedLabel, id: `${uid}-opt-unchanged` });
    for (const g of groups) for (const a of g.agents) out.push({ value: a.key, label: `${a.key} — ${a.name}`, id: `${uid}-opt-${a.key}` });
    return out;
  }, [groups, query, unchangedLabel, uid]);

  const selected = agents.find((a) => a.key === value);
  const display = value === "" ? unchangedLabel : selected ? `${selected.key} — ${selected.name}` : value;
  const selectedGroup = selected ? groupLabel(agentGroupOf(selected.domain)) : null;

  function commit(i: number) {
    const opt = flat[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setActive(Math.max(flat.length - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      commit(active);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  const activeId = open && flat[active] ? flat[active].id : undefined;

  return (
    <div
      className="agent-combobox"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        className="sizing-new-input w-full"
        aria-label={t("agentPickerLabel")}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        disabled={disabled}
        placeholder={display}
        value={open ? query : display}
        onFocus={() => { setOpen(true); setActive(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
      />
      {selectedGroup && !open && <span className="agent-combobox-group-tag">{selectedGroup}</span>}
      {open && (
        <div id={listId} role="listbox" aria-label={t("agentPickerLabel")} className="agent-combobox-list">
          {query.trim() === "" && (
            <div
              id={flat[0].id}
              role="option"
              aria-selected={value === ""}
              className={`agent-combobox-option${active === 0 ? " is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(0)}
            >
              {unchangedLabel}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.group} role="group" aria-label={groupLabel(g.group)}>
              <div className="agent-combobox-heading" aria-hidden="true">{groupLabel(g.group)}</div>
              {g.agents.map((a) => {
                const idx = flat.findIndex((f) => f.value === a.key);
                return (
                  <div
                    key={a.key}
                    id={flat[idx]?.id}
                    role="option"
                    aria-selected={value === a.key}
                    className={`agent-combobox-option${idx === active ? " is-active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(idx)}
                  >
                    <span>{a.key}</span> <span className="agent-combobox-name">— {a.name}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="agent-combobox-empty" role="status">{t("agentPickerEmpty")}</div>}
        </div>
      )}
    </div>
  );
}
