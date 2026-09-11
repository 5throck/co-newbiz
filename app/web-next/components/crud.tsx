"use client";

// 통합 CRUD 상호작용 프리미티브 (ADR-0082).
// 모든 페이지의 생성/수정/삭제는 이 모듈의 패턴을 사용한다:
//  - 생성: InlineCreateForm (섹션 헤더 "＋ ~ 등록" 토글 → sizing-new-form 인라인 폼, 제출 라벨 "등록")
//  - 수정: RowEdit (행 내 편집 모드 — 입력 + 저장/취소, Enter 저장)
//  - 삭제: useConfirm() + ConfirmDialog (대상명 표시 확인, 라벨 "삭제", btn-danger, 행 액션 맨 끝)

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../lib/use-modal-focus.ts";

/* ── ConfirmDialog + useConfirm ── */

export interface ConfirmState {
  title: string;
  body?: string;
  confirmLabel?: string;
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
          <p className="text-[0.82rem] text-[color:var(--muted-fg)] mt-2 mb-0">{state.body}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn-danger btn-sm"
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
    (title: string, onConfirm: () => void, opts?: { body?: string; confirmLabel?: string }) =>
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
