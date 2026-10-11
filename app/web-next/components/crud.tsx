"use client";

// 통합 CRUD 상호작용 프리미티브 (ADR-0082).
// 모든 페이지의 생성/수정/삭제는 이 모듈의 패턴을 사용한다:
//  - 생성: InlineCreateForm (섹션 헤더 "＋ ~ 등록" 토글 → sizing-new-form 인라인 폼, 제출 라벨 "등록")
//  - 수정: RowEdit (행 내 편집 모드 — 입력 + 저장/취소, Enter 저장)
//  - 삭제: useConfirm() + ConfirmDialog (대상명 표시 확인, 라벨 "삭제", btn-danger, 행 액션 맨 끝)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../lib/use-modal-focus.ts";

/* ── ConfirmDialog + useConfirm ── */

export interface ConfirmState {
  title: string;
  body?: string;
  confirmLabel?: string;
  /** "danger" (default) for destructive actions, "neutral" for ordinary confirmations (e.g. recording a GO). */
  tone?: "danger" | "neutral";
  onConfirm: () => void;
}

export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!state || !mounted) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={state.title}
        style={{ maxWidth: "26rem", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 style={{ fontSize: "0.95rem" }}>{state.title}</h2>
        </div>
        {state.body && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0">{state.body}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className={state.tone === "neutral" ? "btn-premium btn-sm" : "btn-danger btn-sm"}
            autoFocus
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            {state.confirmLabel ?? "확인"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const confirm = useCallback(
    (title: string, onConfirm: () => void, opts?: { body?: string; confirmLabel?: string; tone?: "danger" | "neutral" }) =>
      setState({ title, onConfirm, ...opts }),
    [],
  );
  const dialog = <ConfirmDialog state={state} onClose={() => setState(null)} />;
  return { confirm, confirmDialog: dialog };
}

/* ── InlineCreateForm: 표준 생성 폼 ── */

export function InlineCreateForm({
  open,
  onSubmit,
  onCancel,
  children,
  submitLabel = "등록",
  disabled = false,
  ariaLabel,
}: {
  open: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  children: React.ReactNode;
  submitLabel?: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  if (!open) return null;
  return (
    <form onSubmit={onSubmit} aria-label={ariaLabel} className="sizing-new-form mb-3">
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <button type="submit" className="btn-ghost btn-sm" disabled={disabled}>
          {submitLabel}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}

/* ── RowEdit: 행 내 편집 셀 ── */

export function RowEdit({
  editing,
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  ariaLabel,
  width = "10rem",
  placeholder,
}: {
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  ariaLabel: string;
  width?: string;
  placeholder?: string;
}) {
  if (!editing) return null;
  return (
    <span className="row-edit-cell">
      <input
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="sizing-new-input sizing-new-input-sm"
        style={{ width }}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={onSave}>
        {saving ? "저장 중..." : "저장"}
      </button>
      <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
        취소
      </button>
    </span>
  );
}


/* ── RowMenu: overflow ("more actions") menu for rows and toolbars ──
   Same role="menu" / role="menuitem" pattern as StageTabs' More menu. Arrows/Home/End move,
   Escape closes and returns focus to the trigger, Tab and outside click close. The panel is
   position: fixed so a .table-scroll ancestor never clips it. */

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** render a separator line above this item */
  separatorBefore?: boolean;
}

export function RowMenu({ label, items, triggerClassName = "btn-ghost btn-sm" }: { label: string; items: RowMenuItem[]; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number | "auto"; bottom: number | "auto"; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const itemEls = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    const h = menuRef.current?.offsetHeight ?? 0;
    setPos(r.bottom + h + 8 > window.innerHeight && r.top > h ? { top: "auto", bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, bottom: "auto", right });
  }, [open]);

  // Focus the first item once the panel is positioned (opacity:0 while unpositioned; visibility:hidden would block focus).
  useEffect(() => {
    if (open && pos) itemEls()[0]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };
    const onDismiss = () => close(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const els = itemEls();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus({ preventScroll: true }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus({ preventScroll: true }); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus({ preventScroll: true }); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus({ preventScroll: true }); }
  }

  return (
    <span className="row-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerClassName} row-menu-trigger`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setPos(null); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setPos(null); setOpen(true); } }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="stage-tab-menu row-menu"
          style={{ ...(pos ?? { top: 0, bottom: "auto", right: 0, opacity: 0 }) }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((it) => (
            <div key={it.key} role="none">
              {it.separatorBefore && <div role="separator" className="row-menu-sep" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={`stage-tab-menu-item row-menu-item${it.danger ? " row-menu-item-danger" : ""}`}
                onClick={() => { close(true); it.onSelect(); }}
              >
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
