"use client";

// Shared UI primitives (ADR-0121) — the component layer between the Onyx token
// registry and the screen patterns. No new dependencies; thin React over the
// existing vocabulary. ADR-0119 governs the button/chip semantics.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

/* ── ControlChip — interactive filter/sort/score control (NOT a status chip) ── */

export function ControlChip({
  selected,
  children,
  ...rest
}: { selected?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-pressed={selected} {...rest} className={`control-chip ${rest.className ?? ""}`.trim()}>
      {children}
    </button>
  );
}

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
      <div aria-busy="true" aria-label="불러오는 중">
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
        <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">
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
    <div className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
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
