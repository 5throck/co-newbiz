"use client";

// InboxList (Wave U-1, design §4.2) — list pane of /inbox. Rows are real list
// items; selection is exposed with aria-current, Up/Down moves selection.
// Kind and severity use icon + text, never colour alone.
import { useRef, type KeyboardEvent } from "react";
import { AlertTriangle, CircleAlert, CircleDot, FileCheck2, Hourglass, Bell } from "lucide-react";
import { KIND_LABEL, SEVERITY_LABEL, type InboxItem, type InboxKind } from "../lib/inbox.ts";

const KIND_ICON: Record<InboxKind, React.ReactNode> = {
  gate_proposal: <FileCheck2 size={16} aria-hidden="true" />,
  decision_proposal: <FileCheck2 size={16} aria-hidden="true" />,
  gate_hold: <Hourglass size={16} aria-hidden="true" />,
  closure_precondition: <CircleAlert size={16} aria-hidden="true" />,
  notification: <Bell size={16} aria-hidden="true" />,
};

const SEVERITY_CLASS = { high: "status-red", medium: "status-amber", low: "status-not-started" } as const;
const SEVERITY_ICON = {
  high: <AlertTriangle size={12} aria-hidden="true" />,
  medium: <CircleDot size={12} aria-hidden="true" />,
  low: <CircleDot size={12} aria-hidden="true" />,
} as const;

export function InboxList({
  items,
  selectedId,
  onSelect,
}: {
  items: InboxItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button.inbox-row") ?? []);
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    next.focus();
    onSelect(next.dataset.itemId!);
  }

  return (
    <ul className="inbox-list" ref={listRef} onKeyDown={onKeyDown} aria-label="결정 대기 항목">
      {items.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            className="inbox-row"
            data-item-id={it.id}
            aria-current={it.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(it.id)}
          >
            <span className="inbox-row-kind">{KIND_ICON[it.kind]} {KIND_LABEL[it.kind]}</span>
            <span className="inbox-row-title">{it.title}</span>
            <span className="inbox-row-meta">
              <span className="inbox-chip">{it.dealName}{it.stage ? ` · ${it.stage}` : ""}</span>
              <span className="inbox-age">{it.ageDays}일 경과</span>
              <span className={`status-chip ${SEVERITY_CLASS[it.severity]}`}>{SEVERITY_ICON[it.severity]} {SEVERITY_LABEL[it.severity]}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
