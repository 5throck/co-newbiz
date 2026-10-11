"use client";

// Shared UI primitives (ADR-0121) — the component layer between the Onyx token
// registry and the screen patterns. No new dependencies; thin React over the
// existing vocabulary. ADR-0119 governs the button/chip semantics.

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useAuth } from "../lib/auth-client.tsx";
import { VIEWER_READONLY_TEXT } from "../lib/labels.ts";

/* ── ColGroup — percentage column widths for .table-fixed-pct tables ──
   Numbers only: there is no way to express `auto`, so no single column can absorb
   the width change. Presets live next to the screen as `X_COL_PCT = [..] as const`. */

export function ColGroup({ widths }: { widths: readonly number[] }) {
  if (process.env.NODE_ENV !== "production") {
    if (widths.some((w) => typeof w !== "number" || !Number.isFinite(w) || w <= 0)) {
      throw new Error("ColGroup: every column needs a positive percentage");
    }
    const sum = widths.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.01) throw new Error(`ColGroup: widths sum to ${sum}, expected 100`);
  }
  return <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>;
}

/* ── Button — btn-primary (ONE per screen/section) / btn-ghost / btn-danger ── */

export function Button({
  variant = "ghost",
  size,
  primary,
  danger,
  children,
  ...rest
}: {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm";
  primary?: boolean;
  danger?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = variant === "primary" || primary ? "btn-primary" : danger || variant === "danger" ? "btn-danger" : "btn-ghost";
  return (
    <button type="button" {...rest} className={`${v}${size === "sm" ? " btn-sm" : ""} ${rest.className ?? ""}`.trim()}>
      {children}
    </button>
  );
}

/* ── PrimaryAction — the ONE filled action of a screen (Wave U design §5) ──
   StageFrame renders <PrimarySlot/> in the page header (top right); a screen
   declares its primary action with <PrimaryAction/> from anywhere in its body
   (it keeps access to local state) and the button is portalled into the slot.
   A disabled primary always shows its reason as text beside the button. */

let primarySlotEl: HTMLElement | null = null;
const primarySlotListeners = new Set<() => void>();
function setPrimarySlot(el: HTMLElement | null) {
  if (primarySlotEl === el) return;
  primarySlotEl = el;
  primarySlotListeners.forEach((l) => l());
}
function subscribePrimarySlot(l: () => void) {
  primarySlotListeners.add(l);
  return () => { primarySlotListeners.delete(l); };
}

/** Header slot for the screen's primary action. Rendered once by StageFrame. */
export function PrimarySlot() {
  return <div ref={setPrimarySlot} className="primary-slot" />;
}

export interface PrimaryActionProps {
  label: string;
  /** Button handler (mutually exclusive with href). */
  onClick?: () => void;
  /** Navigation target (renders a link styled as the primary button). */
  href?: string;
  /** Submit the form with this id from the header (button form attribute). */
  form?: string;
  disabled?: boolean;
  /** Required whenever disabled: shown as text beside the button, not only as a tooltip. */
  disabledReason?: string;
  /** Render in place instead of the header slot (screens without StageFrame). */
  inline?: boolean;
  /** Reads or navigates only (no write): stays enabled for the read-only viewer role. */
  readOnly?: boolean;
}

export function PrimaryAction({ label, onClick, href, form, disabled, disabledReason: reasonIn, inline, readOnly }: PrimaryActionProps) {
  const slot = useSyncExternalStore(subscribePrimarySlot, () => primarySlotEl, () => null);
  const reasonId = useId();
  const { me } = useAuth();
  // R2-C 9: a viewer sees the action but cannot use it, and is told why (the server rejects viewer writes too).
  const viewerBlocked = me?.role === "viewer" && !readOnly;
  const blocked = !!disabled || viewerBlocked;
  const disabledReason = viewerBlocked ? VIEWER_READONLY_TEXT : reasonIn;
  const control = href && !blocked ? (
    <Link href={href} className="btn-primary">{label}</Link>
  ) : (
    <button
      type={form && !blocked ? "submit" : "button"}
      form={form}
      className="btn-primary"
      disabled={blocked}
      aria-describedby={blocked && disabledReason ? reasonId : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const node = (
    <>
      {blocked && disabledReason && <span id={reasonId} className="primary-reason">{disabledReason}</span>}
      {control}
    </>
  );
  if (inline) return <span className="primary-inline">{node}</span>;
  if (!slot) return null;
  return createPortal(node, slot);
}

/* ── ParamTable — label / value / unit / source in separate columns (Wave U-2, design §6) ── */

export interface ParamRow {
  label: string;
  value: ReactNode;
  unit?: string;
  source?: ReactNode;
}

export function ParamTable({
  rows,
  caption,
  labelHeader = "항목",
  valueAlign = "end",
}: {
  rows: ParamRow[];
  caption?: string;
  labelHeader?: string;
  /** "end" for numbers (right-aligned, tabular); "start" for text facts. */
  valueAlign?: "end" | "start";
}) {
  // Unit and source columns only appear when at least one row carries them, so
  // plain fact tables (label + value) do not show empty columns.
  const hasUnit = rows.some((r) => r.unit);
  const hasSource = rows.some((r) => r.source);
  const valueCls = `param-value${valueAlign === "start" ? " param-value-start" : ""}`;
  return (
    <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
      <table className="param-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            <th scope="col" className="param-label">{labelHeader}</th>
            <th scope="col" className={valueCls}>값</th>
            {hasUnit && <th scope="col" className="param-unit">단위</th>}
            {hasSource && <th scope="col" className="param-source">출처</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="param-label">{r.label}</th>
              <td className={valueCls}>{r.value}</td>
              {hasUnit && <td className="param-unit">{r.unit ?? ""}</td>}
              {hasSource && <td className="param-source">{r.source}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── FilterChip — the ONE interactive filter/sort chip (NOT a status chip) ──
   Selected = filled, unselected = outline; the state is exposed with aria-pressed and
   the filled state also bolds the label, so it never relies on color alone. */

export function FilterChip({
  selected,
  children,
  className,
  ...rest
}: { selected: boolean; children: ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed">) {
  return (
    <button type="button" {...rest} aria-pressed={selected} className={`control-chip ${className ?? ""}`.trim()}>
      {children}
    </button>
  );
}

/** @deprecated use FilterChip — kept so existing imports keep compiling. */
export const ControlChip = FilterChip;

/* ── Tabs — URL query-synced tab strip (3-depth navigation ceiling, ui-spec §1) ── */

export function Tabs({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map((t) => (
        <a
          key={t.key}
          role="tab"
          aria-current={active === t.key ? "page" : undefined}
          className="tab"
          href={`#${t.key}`}
          onClick={(e) => {
            e.preventDefault();
            onSelect(t.key);
          }}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}

/* ── DevRef — ADR/spec references live in a collapsed developer disclosure, never in reader-facing copy (R2-C 8) ── */

export function DevRef({ refs }: { refs: string }) {
  return (
    <details className="review-dev">
      <summary>개발자 참고</summary>
      <span>{refs}</span>
    </details>
  );
}

/* ── PageState — loading skeleton / empty / error (one surface, ADR-0121) ── */

export function PageState({
  state,
  emptyText,
  emptyAction,
  errorText,
  onRetry,
  rows = 3,
}: {
  state: "loading" | "empty" | "error";
  emptyText?: ReactNode;
  emptyAction?: ReactNode;
  errorText?: string;
  onRetry?: () => void;
  rows?: number;
}) {
  if (state === "loading") {
    return (
      <div role="status" aria-busy="true" aria-label="불러오는 중">
        <div className="skeleton" style={{ width: "45%" }} />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: `${88 - i * 12}%` }} />
        ))}
      </div>
    );
  }
  if (state === "error") {
    return (
      <div>
        <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
          ✕ {errorText ?? "데이터를 불러오지 못했습니다"}
        </p>
        {onRetry && (
          <button type="button" className="btn-ghost btn-sm" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
      {emptyText ?? "데이터가 없습니다."} {emptyAction}
    </div>
  );
}

/* ── Toast — mutation outcome queue (success role=status, failure role=alert) ── */

interface ToastItem {
  id: number;
  kind: "status" | "alert";
  message: string;
}

const ToastContext = createContext<{ toast: (message: string, kind?: "status" | "alert") => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((message: string, kind: "status" | "alert" = "status") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" role={t.kind}>
            <span>{t.kind === "alert" ? "✕" : "✓"}</span>
            <span>{t.message}</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label="닫기"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? { toast: () => undefined };
}

/* ── useToastOnMount helper for pages to confirm recorded decisions ── */
export function useMountedToast() {
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (pending) {
      toast(pending);
      setPending(null);
    }
  }, [pending, toast]);
  return setPending;
}
