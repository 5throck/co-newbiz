"use client";

// Shared focus management for `.modal-backdrop` dialogs (ADR-0082 companion).
// On mount: moves focus into the panel (first focusable element, else the
// panel itself). On Tab/Shift+Tab: cycles focus within the panel. On Escape:
// invokes the close callback. On unmount: restores focus to the element that
// was focused before the modal opened.
//
// Usage:
//   const { panelRef, onKeyDown } = useModalFocus(() => setOpen(false));
//   <div className="modal-backdrop" onKeyDown={onKeyDown} ...>
//     <div ref={panelRef} className="modal-panel" ...>

import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useModalFocus(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Initial focus + focus restoration.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.tabIndex = -1;
    const focusables = focusableElements(panel);
    (focusables[0] ?? panel).focus();
    return () => {
      previous?.focus();
    };
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = focusableElements(panel);
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === panel) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return { panelRef, onKeyDown };
}
